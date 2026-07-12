import { Injectable, Optional } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { ProviderCapabilities } from '@agent-platform/shared';
import { assertSafeProviderDestination } from './ssrf-protection';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  NormalizedProviderError,
  NormalizedUsage,
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse,
  ProviderModel,
  ProviderRuntimeConfig,
  ProviderStreamChunk,
  ProviderToolCall,
  ProviderToolDefinition,
} from './provider.types';

/**
 * A deliberately small structural surface around the official SDK. Keeping the
 * SDK behind this boundary makes the adapter straightforward to test without a
 * network call, and prevents the rest of the application from depending on SDK
 * response classes.
 */
export interface GeminiClient {
  models: {
    generateContent(params: Record<string, unknown>): Promise<unknown>;
    generateContentStream(params: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
    embedContent(params: Record<string, unknown>): Promise<unknown>;
    list(params?: Record<string, unknown>): Promise<unknown>;
  };
}

export type GeminiClientFactory = (config: ProviderRuntimeConfig) => GeminiClient;
export type GeminiDestinationGuard = (url: string, allowPrivateNetwork: boolean) => Promise<void>;

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_REQUEST_BYTES = 2_000_000;
const MAX_RESPONSE_BYTES = 10_000_000;
const MAX_TEXT_BYTES = 5_000_000;
const MAX_TOOL_CALLS = 16;
const MAX_TOOLS = 128;
const MAX_TOOL_SCHEMA_BYTES = 512_000;
const MAX_TOOL_ARGUMENT_BYTES = 256_000;
const MAX_EMBEDDING_INPUTS = 128;
const MAX_EMBEDDING_TEXT_BYTES = 100_000;

interface RawResponse {
  text?: unknown;
  functionCalls?: unknown;
  candidates?: unknown;
  usageMetadata?: unknown;
  modelVersion?: unknown;
}

@Injectable()
export class GeminiAdapter implements ProviderAdapter {
  constructor(
    @Optional() private readonly clientFactory?: GeminiClientFactory,
    @Optional() private readonly destinationGuard?: GeminiDestinationGuard,
  ) {}

  async validateCredential(config: ProviderRuntimeConfig): Promise<boolean> {
    this.assertCredential(config);
    await this.listModels(config);
    return true;
  }

  async listModels(config: ProviderRuntimeConfig): Promise<ProviderModel[]> {
    const client = await this.clientFor(config);
    const abortSignal = this.requestSignal(undefined, 15_000);
    const result = await client.models.list({
      config: { pageSize: 100, abortSignal, httpOptions: { timeout: 15_000 } },
    });
    const models: ProviderModel[] = [];
    for await (const item of iterateModels(result)) {
      if (models.length >= 200) break;
      const model = asRecord(item);
      const rawName = stringValue(model.name);
      if (!rawName) continue;
      const id = rawName.replace(/^models\//, '');
      const displayName = stringValue(model.displayName) || id;
      models.push({
        id,
        name: displayName,
        capabilities: this.capabilityDetection(id),
      });
    }
    return models;
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): Promise<ProviderChatResponse> {
    const client = await this.clientFor(config);
    const params = this.buildGenerateParams(config, request);
    const response = (await client.models.generateContent(params)) as RawResponse;
    return this.normalizeResponse(response, request.model);
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncGenerator<ProviderStreamChunk> {
    const client = await this.clientFor(config);
    const params = this.buildGenerateParams(config, request);
    const stream = await client.models.generateContentStream(params);
    const calls = new Map<string, ProviderToolCall>();
    let outputBytes = 0;
    let finishReason: string | undefined;
    let lastUsage: NormalizedUsage | undefined;
    let callIndex = 0;

    for await (const rawChunk of stream) {
      const chunk = asRecord(rawChunk) as RawResponse;
      const chunkBytes = byteLength(safeJson(chunk, 'Provider stream chunk is invalid'));
      outputBytes += chunkBytes;
      if (outputBytes > MAX_RESPONSE_BYTES) {
        throw new Error('Provider stream exceeded the response size limit');
      }

      const text = extractText(chunk);
      if (text) {
        if (byteLength(text) > MAX_TEXT_BYTES || outputBytes > MAX_RESPONSE_BYTES) {
          throw new Error('Provider response exceeded the size limit');
        }
        yield { type: 'token', content: text };
      }

      const rawCalls = extractFunctionCalls(chunk);
      if (rawCalls.length + callIndex > MAX_TOOL_CALLS) {
        throw new Error('Provider returned too many tool calls');
      }
      for (const rawCall of rawCalls) {
        const call = normalizeFunctionCall(rawCall, callIndex++);
        const key = call.id || `${call.function.name}:${callIndex}`;
        const previous = calls.get(key);
        calls.set(key, previous ? mergeFunctionCall(previous, call) : call);
      }

      const candidateReason = extractFinishReason(chunk);
      if (candidateReason) finishReason = candidateReason;

      if (hasUsage(chunk.usageMetadata)) {
        const usage = this.normalizeUsage(chunk.usageMetadata);
        if (!lastUsage || !sameUsage(lastUsage, usage)) {
          lastUsage = usage;
          yield { type: 'usage', usage };
        }
      }
    }

    for (const toolCall of calls.values()) yield { type: 'tool_call', toolCall };
    yield { type: 'done', finishReason };
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    if (!request.input.length || request.input.length > MAX_EMBEDDING_INPUTS) {
      throw new Error(`Embedding input count must be between 1 and ${MAX_EMBEDDING_INPUTS}`);
    }
    for (const value of request.input) {
      if (byteLength(value) > MAX_EMBEDDING_TEXT_BYTES) {
        throw new Error('Embedding input exceeds the size limit');
      }
    }
    const client = await this.clientFor(config);
    const timeoutMs = boundedTimeout(request.timeoutMs);
    const abortSignal = this.requestSignal(undefined, timeoutMs);
    const batches = requiresSingleEmbeddingRequest(config, request.model)
      ? request.input.map((value) => [value])
      : [request.input];
    const embeddings: number[][] = [];
    let inputTokens = 0;
    let responseBytes = 0;

    for (const contents of batches) {
      const response = (await client.models.embedContent({
        model: request.model,
        contents,
        config: { abortSignal, httpOptions: { timeout: timeoutMs } },
      })) as Record<string, unknown>;
      const rawEmbeddings = Array.isArray(response.embeddings) ? response.embeddings : [];
      responseBytes += byteLength(safeJson(response, 'Provider embedding response is invalid'));
      if (responseBytes > MAX_RESPONSE_BYTES) {
        throw new Error('Provider response exceeded the size limit');
      }
      if (rawEmbeddings.length !== contents.length) {
        throw new Error('Provider returned an unexpected embedding count');
      }
      const normalized = this.normalizeUsage(response.usageMetadata ?? response.metadata);
      const statisticsTokens = embeddingStatisticsTokenCount(rawEmbeddings);
      inputTokens += normalized.inputTokens || statisticsTokens;
      embeddings.push(...rawEmbeddings.map(normalizeEmbedding));
    }

    return {
      embeddings,
      usage: { inputTokens, outputTokens: 0, totalTokens: inputTokens },
    };
  }

  toolCalling(request: ProviderChatRequest, tools: ProviderToolDefinition[]): ProviderChatRequest {
    if (request.model && !this.capabilityDetection(request.model).toolCalling) {
      throw new ProviderCapabilityError('Tool calling is not supported by this Gemini model');
    }
    validateTools(tools);
    return { ...request, tools: tools.slice(0, MAX_TOOLS) };
  }

  structuredOutput(
    request: ProviderChatRequest,
    schema: Record<string, unknown>,
  ): ProviderChatRequest {
    if (request.model && !this.capabilityDetection(request.model).structuredOutput) {
      throw new ProviderCapabilityError('Structured output is not supported by this Gemini model');
    }
    assertJsonSize(
      schema,
      MAX_TOOL_SCHEMA_BYTES,
      'Structured output schema exceeds the size limit',
    );
    return { ...request, responseSchema: schema };
  }

  normalizeUsage(raw: unknown): NormalizedUsage {
    const usage = asRecord(raw);
    const inputTokens =
      nonNegativeInt(
        usage.promptTokenCount ??
          usage.prompt_token_count ??
          usage.prompt_tokens ??
          usage.inputTokenCount ??
          usage.input_tokens,
      ) + nonNegativeInt(usage.toolUsePromptTokenCount ?? usage.tool_use_prompt_token_count);
    const outputTokens =
      nonNegativeInt(
        usage.candidatesTokenCount ??
          usage.candidates_token_count ??
          usage.completion_tokens ??
          usage.output_tokens,
      ) + nonNegativeInt(usage.thoughtsTokenCount ?? usage.thoughts_token_count);
    const totalTokens = nonNegativeInt(
      usage.totalTokenCount ?? usage.total_token_count ?? usage.total_tokens,
    );
    return {
      inputTokens,
      outputTokens,
      totalTokens: totalTokens || inputTokens + outputTokens,
    };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const value = asRecord(error);
    const name = stringValue(value.name).toLowerCase();
    if (name === 'aborterror' || name === 'timeouterror' || error instanceof DOMException) {
      return { code: 'PROVIDER_TIMEOUT', message: 'Provider request timed out', retryable: true };
    }
    const status = statusCode(value.status ?? value.statusCode ?? asRecord(value.response).status);
    if (status === 401 || status === 403) {
      return {
        code: 'PROVIDER_AUTH_FAILED',
        message: 'Gemini credential was rejected',
        retryable: false,
        statusCode: status,
      };
    }
    if (status === 429) {
      return {
        code: 'PROVIDER_RATE_LIMITED',
        message: 'Gemini provider rate limit exceeded',
        retryable: true,
        statusCode: status,
      };
    }
    if (status && status >= 500) {
      return {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Gemini provider is temporarily unavailable',
        retryable: true,
        statusCode: status,
      };
    }
    if (status === 408 || status === 409) {
      return {
        code: 'PROVIDER_RETRYABLE_ERROR',
        message: 'Gemini provider request should be retried',
        retryable: true,
        statusCode: status,
      };
    }
    if (error instanceof ProviderCapabilityError) {
      return { code: 'PROVIDER_CAPABILITY_UNSUPPORTED', message: error.message, retryable: false };
    }
    return {
      code: status ? `PROVIDER_HTTP_${status}` : 'PROVIDER_ERROR',
      message: status
        ? `Gemini provider request failed with HTTP ${status}`
        : 'Gemini provider request failed',
      retryable: false,
      ...(status ? { statusCode: status } : {}),
    };
  }

  capabilityDetection(model?: string): ProviderCapabilities {
    const normalized = (model ?? '').toLowerCase().replace(/^models\//, '');
    if (!normalized) {
      return {
        chat: true,
        streaming: true,
        embeddings: true,
        toolCalling: true,
        structuredOutput: true,
        vision: true,
        modelListing: true,
      };
    }
    const isGemini = normalized.startsWith('gemini-') || normalized.includes('/gemini-');
    const isEmbedding = normalized.includes('embedding');
    const modernGemini = isGemini && !/^gemini-1\.0(?:-|$)/.test(normalized);
    return {
      chat: isGemini && !isEmbedding,
      streaming: isGemini && !isEmbedding,
      embeddings: isEmbedding,
      toolCalling: modernGemini && !isEmbedding,
      structuredOutput: modernGemini && !isEmbedding,
      // ChatMessage intentionally carries text only; advertise vision only when
      // the model is explicitly known to be multimodal in its model id.
      vision: isGemini && /(vision|flash|pro)/i.test(normalized),
      modelListing: true,
    };
  }

  private async clientFor(config: ProviderRuntimeConfig): Promise<GeminiClient> {
    this.assertCredential(config);
    const baseUrl = this.baseUrl(config);
    await (this.destinationGuard ?? assertSafeProviderDestination)(baseUrl, false);
    return (this.clientFactory ?? defaultClientFactory)(config);
  }

  private assertCredential(config: ProviderRuntimeConfig): void {
    if (isEnterprise(config)) {
      const values = asRecord(config.config);
      const project = stringValue(
        config.credentials.project ??
          config.credentials.projectId ??
          values.project ??
          values.projectId,
      );
      const location = stringValue(config.credentials.location ?? values.location);
      if (!project) throw new Error('Gemini Vertex AI project is required for ADC authentication');
      if (!location)
        throw new Error('Gemini Vertex AI location is required for ADC authentication');
      return;
    }
    if (!stringValue(config.credentials.apiKey)) {
      throw new Error('Gemini Developer API key is missing');
    }
  }

  private baseUrl(config: ProviderRuntimeConfig): string {
    return resolvedBaseUrl(config);
  }

  private requestSignal(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(boundedTimeout(timeoutMs));
    return external ? AbortSignal.any([timeout, external]) : timeout;
  }

  private buildGenerateParams(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): Record<string, unknown> {
    const { systemInstruction, contents } = toGeminiContents(request.messages);
    const timeoutMs = boundedTimeout(request.timeoutMs);
    const generationConfig: Record<string, unknown> = {
      abortSignal: this.requestSignal(request.signal, timeoutMs),
      httpOptions: { timeout: timeoutMs },
    };
    if (request.temperature !== undefined) {
      generationConfig.temperature = Math.max(0, Math.min(2, request.temperature));
    }
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = Math.max(
        1,
        Math.min(65_536, Math.trunc(request.maxTokens)),
      );
    }
    if (systemInstruction)
      generationConfig.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (request.tools?.length) {
      if (request.model && !this.capabilityDetection(request.model).toolCalling) {
        throw new ProviderCapabilityError('Tool calling is not supported by this Gemini model');
      }
      validateTools(request.tools);
      generationConfig.tools = [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }];
      generationConfig.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }
    if (request.responseSchema) {
      if (request.model && !this.capabilityDetection(request.model).structuredOutput) {
        throw new ProviderCapabilityError(
          'Structured output is not supported by this Gemini model',
        );
      }
      assertJsonSize(
        request.responseSchema,
        MAX_TOOL_SCHEMA_BYTES,
        'Structured output schema exceeds the size limit',
      );
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = request.responseSchema;
    }
    const params = { model: request.model, contents, config: generationConfig };
    assertJsonSize(params, MAX_REQUEST_BYTES, 'Provider request exceeds the size limit');
    return params;
  }

  private normalizeResponse(raw: RawResponse, requestedModel: string): ProviderChatResponse {
    const serialized = safeJson(raw, 'Provider response is invalid');
    if (byteLength(serialized) > MAX_RESPONSE_BYTES) {
      throw new Error('Provider response exceeded the size limit');
    }
    const content = extractText(raw);
    if (byteLength(content) > MAX_TEXT_BYTES)
      throw new Error('Provider response exceeded the size limit');
    const rawCalls = extractFunctionCalls(raw);
    if (rawCalls.length > MAX_TOOL_CALLS) throw new Error('Provider returned too many tool calls');
    return {
      content,
      toolCalls: rawCalls.map((call, index) => normalizeFunctionCall(call, index)),
      usage: this.normalizeUsage(raw.usageMetadata),
      model: stringValue(raw.modelVersion) || requestedModel,
      finishReason: extractFinishReason(raw),
    };
  }
}

class ProviderCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderCapabilityError';
  }
}

function defaultClientFactory(config: ProviderRuntimeConfig): GeminiClient {
  const values = asRecord(config.config);
  const credentials = config.credentials;
  const enterprise = isEnterprise(config);
  const apiKey = stringValue(credentials.apiKey);
  const project = stringValue(
    credentials.project ?? credentials.projectId ?? values.project ?? values.projectId,
  );
  const location = stringValue(credentials.location ?? values.location);
  const apiVersion = stringValue(credentials.apiVersion ?? values.apiVersion);
  const options: Record<string, unknown> = {
    ...(enterprise
      ? {
          enterprise: true,
          project,
          location,
        }
      : { apiKey }),
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: { baseUrl: resolvedBaseUrl(config) },
  };
  return new GoogleGenAI(options) as unknown as GeminiClient;
}

function isEnterprise(config: ProviderRuntimeConfig): boolean {
  const values = asRecord(config.config);
  return values.enterprise === true || values.vertexai === true;
}

function requiresSingleEmbeddingRequest(config: ProviderRuntimeConfig, model: string): boolean {
  if (!isEnterprise(config)) return false;
  const normalized = model.toLowerCase();
  return (
    (normalized.includes('gemini') && normalized !== 'gemini-embedding-001') ||
    normalized.includes('maas')
  );
}

function normalizeEmbedding(value: unknown): number[] {
  const record = asRecord(value);
  const values = Array.isArray(record.values) ? record.values : [];
  const embedding = values.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item),
  );
  if (!embedding.length) throw new Error('Provider returned an empty embedding');
  return embedding;
}

function embeddingStatisticsTokenCount(values: unknown[]): number {
  return values.reduce<number>(
    (total, value) => total + nonNegativeInt(asRecord(asRecord(value).statistics).tokenCount),
    0,
  );
}

function resolvedBaseUrl(config: ProviderRuntimeConfig): string {
  const configured = stringValue(config.baseUrl);
  if (configured) return configured;
  if (!isEnterprise(config)) return DEFAULT_BASE_URL;
  const values = asRecord(config.config);
  const location = stringValue(config.credentials.location ?? values.location).toLowerCase();
  if (!location || location === 'global') return 'https://aiplatform.googleapis.com';
  if (!/^[a-z0-9-]{1,63}$/.test(location)) throw new Error('Gemini location is invalid');
  if (location === 'us' || location === 'eu') {
    return `https://aiplatform.${location}.rep.googleapis.com`;
  }
  return `https://${location}-aiplatform.googleapis.com`;
}

function toGeminiContents(messages: ProviderChatRequest['messages']): {
  systemInstruction?: string;
  contents: Array<Record<string, unknown>>;
} {
  const system: string[] = [];
  const contents: Array<Record<string, unknown>> = [];
  messages.forEach((message, index) => {
    if (message.role === 'system') {
      if (message.content) system.push(message.content);
      return;
    }
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      for (const [callIndex, call] of (message.toolCalls ?? []).entries()) {
        const args = parseArguments(call.function.arguments);
        parts.push({
          functionCall: {
            id: call.id || `call_${index}_${callIndex}`,
            name: call.function.name,
            args,
          },
        });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      return;
    }
    if (message.role === 'tool') {
      const name = message.name || findToolName(messages, index, message.toolCallId);
      const response = parseToolResponse(message.content);
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: message.toolCallId,
              name: validFunctionName(name) ? name : 'tool_result',
              response,
            },
          },
        ],
      });
      return;
    }
    contents.push({ role: 'user', parts: [{ text: message.content ?? '' }] });
  });
  return { ...(system.length ? { systemInstruction: system.join('\n\n') } : {}), contents };
}

function findToolName(
  messages: ProviderChatRequest['messages'],
  index: number,
  callId: string | undefined,
): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor];
    if (candidate?.role !== 'assistant') continue;
    const match = candidate.toolCalls?.find((call) => call.id === callId);
    if (match) return match.function.name;
  }
  return 'tool_result';
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: value.slice(0, MAX_TOOL_ARGUMENT_BYTES) };
  }
}

function parseToolResponse(value: string | null): Record<string, unknown> {
  if (!value) return { output: '' };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { output: parsed };
  } catch {
    return { output: value.slice(0, MAX_TOOL_ARGUMENT_BYTES) };
  }
}

function validateTools(tools: ProviderToolDefinition[]): void {
  if (tools.length > MAX_TOOLS)
    throw new Error(`Provider supports at most ${MAX_TOOLS} tools per request`);
  assertJsonSize(tools, MAX_TOOL_SCHEMA_BYTES, 'Tool declarations exceed the size limit');
  for (const tool of tools) {
    if (tool.type !== 'function' || !validFunctionName(tool.function.name)) {
      throw new Error('Provider tool declaration has an invalid function name');
    }
    if (byteLength(tool.function.description) > 4_096) {
      throw new Error('Provider tool description exceeds the size limit');
    }
  }
}

function toFunctionDeclaration(tool: ProviderToolDefinition): Record<string, unknown> {
  return {
    name: tool.function.name,
    description: tool.function.description.slice(0, 4_096),
    parametersJsonSchema: tool.function.parameters,
  };
}

function normalizeFunctionCall(raw: unknown, index: number): ProviderToolCall {
  const value = asRecord(raw);
  const name = stringValue(value.name);
  if (!name || !validFunctionName(name))
    throw new Error('Provider returned an invalid function call');
  const args =
    typeof value.args === 'string'
      ? parseArguments(value.args)
      : value.args && typeof value.args === 'object'
        ? value.args
        : {};
  const argumentsJson = safeJson(args, 'Provider returned invalid function arguments');
  if (byteLength(argumentsJson) > MAX_TOOL_ARGUMENT_BYTES) {
    throw new Error('Provider function arguments exceed the size limit');
  }
  return {
    id: stringValue(value.id) || `call_${index}`,
    type: 'function',
    function: { name, arguments: argumentsJson },
  };
}

function mergeFunctionCall(previous: ProviderToolCall, next: ProviderToolCall): ProviderToolCall {
  if (previous.function.arguments === next.function.arguments) return previous;
  try {
    const previousArgs: unknown = JSON.parse(previous.function.arguments);
    const nextArgs: unknown = JSON.parse(next.function.arguments);
    if (
      previousArgs &&
      nextArgs &&
      typeof previousArgs === 'object' &&
      typeof nextArgs === 'object'
    ) {
      return {
        ...next,
        function: {
          ...next.function,
          arguments: JSON.stringify({ ...previousArgs, ...nextArgs }),
        },
      };
    }
  } catch {
    // Keep the latest complete SDK function call when the stream contains a partial value.
  }
  return next;
}

function extractText(response: RawResponse): string {
  if (typeof response.text === 'string') return response.text;
  const candidate = firstCandidate(response);
  const content = asRecord(candidate?.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts
    .filter((part) => !asRecord(part).thought)
    .map((part) => stringValue(asRecord(part).text))
    .filter(Boolean)
    .join('');
}

function extractFunctionCalls(response: RawResponse): unknown[] {
  if (Array.isArray(response.functionCalls)) return response.functionCalls;
  const candidate = firstCandidate(response);
  const content = asRecord(candidate?.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts.map((part) => asRecord(part).functionCall).filter(Boolean);
}

function extractFinishReason(response: RawResponse): string | undefined {
  const candidate = asRecord(firstCandidate(response));
  return stringValue(candidate.finishReason) || stringValue(candidate.finish_reason);
}

function firstCandidate(response: RawResponse): Record<string, unknown> | undefined {
  return Array.isArray(response.candidates) ? asRecord(response.candidates[0]) : undefined;
}

async function* iterateModels(value: unknown): AsyncGenerator<unknown> {
  if (isAsyncIterable(value)) {
    for await (const item of value) yield item;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield item;
    return;
  }
  const record = asRecord(value);
  if (Array.isArray(record.page)) {
    for (const item of record.page) yield item;
    return;
  }
  if (Array.isArray(record.models)) {
    for (const item of record.models) yield item;
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function',
  );
}

function sameUsage(left: NormalizedUsage, right: NormalizedUsage): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalTokens === right.totalTokens
  );
}

function hasUsage(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

function validFunctionName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function boundedTimeout(value: number | undefined): number {
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.trunc(value ?? DEFAULT_TIMEOUT_MS)));
}

function statusCode(value: unknown): number | undefined {
  const status = nonNegativeInt(value);
  return status >= 100 && status <= 599 ? status : undefined;
}

function nonNegativeInt(value: unknown): number {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number)
    ? Math.max(0, Math.trunc(number))
    : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeJson(value: unknown, message: string): string {
  try {
    const result = JSON.stringify(value);
    if (typeof result !== 'string') throw new Error(message);
    return result;
  } catch {
    throw new Error(message);
  }
}

function assertJsonSize(value: unknown, limit: number, message: string): void {
  if (byteLength(safeJson(value, message)) > limit) throw new Error(message);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

// Keep a descriptive alias for registries that name adapters after providers.
export { GeminiAdapter as GoogleGeminiAdapter };
