import { Injectable } from '@nestjs/common';
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import type { ProviderCapabilities } from '@agent-platform/shared';
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
import { assertSafeProviderDestination } from './ssrf-protection';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MAX_TOKENS = 1_024;
const MAX_MAX_TOKENS = 200_000;
const MAX_MESSAGES = 1_000;
const MAX_TOOLS = 64;
const MAX_CONTENT_BLOCKS = 256;
const MAX_REQUEST_BYTES = 5_000_000;
const MAX_RESPONSE_BYTES = 10_000_000;
const MAX_TEXT_BYTES = 5_000_000;
const MAX_TOOL_ARGUMENT_BYTES = 256_000;
const MAX_SCHEMA_BYTES = 512_000;
const MAX_STREAM_EVENTS = 100_000;
const MAX_MODELS = 1_000;

type AnthropicClient = Pick<Anthropic, 'messages' | 'models'>;

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class AnthropicUnsupportedCapabilityError extends Error {
  readonly code = 'UNSUPPORTED_CAPABILITY';

  constructor(readonly capability: string) {
    super(`Anthropic does not support ${capability}`);
    this.name = 'AnthropicUnsupportedCapabilityError';
  }
}

class AnthropicInputError extends Error {
  readonly code = 'PROVIDER_REQUEST_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AnthropicInputError';
  }
}

class AnthropicResponseLimitError extends Error {
  readonly code = 'PROVIDER_RESPONSE_LIMIT';

  constructor(message = 'Anthropic response exceeded the configured limit') {
    super(message);
    this.name = 'AnthropicResponseLimitError';
  }
}

@Injectable()
export class AnthropicAdapter implements ProviderAdapter {
  async validateCredential(config: ProviderRuntimeConfig): Promise<boolean> {
    await this.listModels(config);
    return true;
  }

  async listModels(config: ProviderRuntimeConfig): Promise<ProviderModel[]> {
    const client = await this.client(config);
    const models: ProviderModel[] = [];
    let page = await client.models.list({ limit: 100 }, { maxRetries: 0, timeout: 15_000 });

    while (true) {
      for (const model of page.data) {
        if (models.length >= MAX_MODELS) return models;
        if (!model.id || model.id.length > 512) continue;
        const detected = this.capabilityDetection(model.id);
        models.push({
          id: model.id,
          name: boundedString(model.display_name || model.id, 512),
          capabilities: {
            ...detected,
            structuredOutput:
              model.capabilities?.structured_outputs?.supported ?? detected.structuredOutput,
            vision: model.capabilities?.image_input?.supported ?? detected.vision,
          },
        });
      }
      if (!page.hasNextPage()) break;
      page = await page.getNextPage();
    }

    return models;
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): Promise<ProviderChatResponse> {
    const client = await this.client(config);
    const body = this.chatBody(request);
    const response = await client.messages.create(
      { ...body, stream: false },
      this.requestOptions(request),
    );
    assertJsonSize(response, MAX_RESPONSE_BYTES, 'Anthropic response');
    if (response.content.length > MAX_CONTENT_BLOCKS) {
      throw new AnthropicResponseLimitError('Anthropic returned too many content blocks');
    }

    const toolCalls: ProviderToolCall[] = [];
    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content = appendBounded(content, block.text, MAX_TEXT_BYTES, 'Anthropic response text');
      } else if (block.type === 'tool_use') {
        if (toolCalls.length >= MAX_TOOLS) {
          throw new AnthropicResponseLimitError('Anthropic returned too many tool calls');
        }
        toolCalls.push(toProviderToolCall(block.id, block.name, block.input));
      }
    }

    return {
      content,
      toolCalls,
      usage: this.normalizeUsage(response.usage),
      model: response.model || request.model,
      finishReason: response.stop_reason ?? undefined,
    };
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncGenerator<ProviderStreamChunk> {
    const client = await this.client(config);
    const stream = await client.messages.create(
      { ...this.chatBody(request), stream: true },
      this.requestOptions(request),
    );
    const pendingTools = new Map<number, PendingToolCall>();
    let eventCount = 0;
    let receivedBytes = 0;
    let textBytes = 0;
    let contentBlocks = 0;
    let usage: NormalizedUsage | undefined;
    let finishReason: string | undefined;

    try {
      for await (const event of stream) {
        eventCount += 1;
        if (eventCount > MAX_STREAM_EVENTS) {
          throw new AnthropicResponseLimitError('Anthropic stream returned too many events');
        }
        receivedBytes += jsonByteLength(event);
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          throw new AnthropicResponseLimitError();
        }

        if (event.type === 'message_start') {
          usage = mergeUsage(usage, this.normalizeUsage(event.message.usage));
          continue;
        }
        if (event.type === 'message_delta') {
          finishReason = event.delta.stop_reason ?? finishReason;
          usage = mergeUsage(usage, this.normalizeUsage(event.usage));
          continue;
        }
        if (event.type === 'content_block_start') {
          contentBlocks += 1;
          if (contentBlocks > MAX_CONTENT_BLOCKS) {
            throw new AnthropicResponseLimitError('Anthropic returned too many content blocks');
          }
          if (event.content_block.type === 'tool_use') {
            if (pendingTools.size >= MAX_TOOLS) {
              throw new AnthropicResponseLimitError('Anthropic returned too many tool calls');
            }
            pendingTools.set(event.index, {
              id: boundedIdentifier(event.content_block.id, 'tool call id'),
              name: boundedIdentifier(event.content_block.name, 'tool name'),
              arguments: initialToolInput(event.content_block.input),
            });
          }
          continue;
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            textBytes += Buffer.byteLength(event.delta.text, 'utf8');
            if (textBytes > MAX_TEXT_BYTES) {
              throw new AnthropicResponseLimitError('Anthropic response text exceeded the limit');
            }
            if (event.delta.text) yield { type: 'token', content: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const pending = pendingTools.get(event.index);
            if (pending) {
              pending.arguments += event.delta.partial_json;
              if (Buffer.byteLength(pending.arguments, 'utf8') > MAX_TOOL_ARGUMENT_BYTES) {
                throw new AnthropicResponseLimitError(
                  'Anthropic tool arguments exceeded the limit',
                );
              }
            }
          }
          continue;
        }
        if (event.type === 'content_block_stop') {
          const toolCall = pendingTools.get(event.index);
          if (toolCall) {
            pendingTools.delete(event.index);
            yield { type: 'tool_call', toolCall: finalizeStreamToolCall(toolCall) };
          }
        }
      }
    } catch (error) {
      stream.controller?.abort();
      throw error;
    }

    for (const toolCall of pendingTools.values()) {
      yield { type: 'tool_call', toolCall: finalizeStreamToolCall(toolCall) };
    }
    if (usage) yield { type: 'usage', usage };
    yield { type: 'done', finishReason };
  }

  embeddings(config: ProviderRuntimeConfig, request: EmbeddingRequest): Promise<EmbeddingResponse> {
    void config;
    void request;
    return Promise.reject(new AnthropicUnsupportedCapabilityError('embeddings'));
  }

  toolCalling(request: ProviderChatRequest, tools: ProviderToolDefinition[]): ProviderChatRequest {
    validateToolDefinitions(tools);
    return { ...request, tools: [...tools] };
  }

  structuredOutput(
    request: ProviderChatRequest,
    schema: Record<string, unknown>,
  ): ProviderChatRequest {
    validateSchema(schema, 'structured output schema');
    return { ...request, responseSchema: { ...schema } };
  }

  normalizeUsage(raw: unknown): NormalizedUsage {
    const record = objectValue(raw);
    const uncachedInput = tokenValue(record.input_tokens);
    const cacheCreation = tokenValue(record.cache_creation_input_tokens);
    const cacheRead = tokenValue(record.cache_read_input_tokens);
    const inputTokens = uncachedInput + cacheCreation + cacheRead;
    const outputTokens = tokenValue(record.output_tokens);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    if (error instanceof AnthropicUnsupportedCapabilityError) {
      return {
        code: error.code,
        message: `Anthropic does not support ${boundedString(error.capability, 100)}`,
        retryable: false,
      };
    }
    if (error instanceof AnthropicInputError) {
      return { code: error.code, message: error.message, retryable: false };
    }
    if (error instanceof AnthropicResponseLimitError) {
      return { code: error.code, message: error.message, retryable: false };
    }
    if (error instanceof APIConnectionTimeoutError || isTimeoutError(error)) {
      return {
        code: 'PROVIDER_TIMEOUT',
        message: 'Anthropic request timed out',
        retryable: true,
      };
    }
    if (error instanceof APIUserAbortError || isAbortError(error)) {
      return {
        code: 'PROVIDER_ABORTED',
        message: 'Anthropic request was cancelled',
        retryable: false,
      };
    }
    if (error instanceof APIConnectionError) {
      return {
        code: 'PROVIDER_CONNECTION_ERROR',
        message: 'Unable to connect to Anthropic',
        retryable: true,
      };
    }
    if (error instanceof APIError) return normalizeApiError(error);
    return {
      code: 'PROVIDER_ERROR',
      message: 'Anthropic request failed',
      retryable: false,
    };
  }

  capabilityDetection(model?: string): ProviderCapabilities {
    const normalized = model?.toLowerCase() ?? '';
    const legacy = /^claude-(?:instant|1|2)(?:[.-]|$)/.test(normalized);
    const multimodal = /^(?:claude-3|claude-(?:haiku|sonnet|opus|fable|mythos)-(?:4|5))/.test(
      normalized,
    );
    return {
      chat: true,
      streaming: true,
      embeddings: false,
      toolCalling: !legacy,
      structuredOutput: !legacy,
      vision: multimodal,
      modelListing: true,
    };
  }

  protected createClient(config: ProviderRuntimeConfig): AnthropicClient {
    return new Anthropic({
      apiKey: requiredApiKey(config),
      baseURL: normalizedBaseUrl(config.baseUrl),
      maxRetries: 0,
      timeout: 30_000,
      fetchOptions: { redirect: 'error' },
      logLevel: 'off',
    });
  }

  private async client(config: ProviderRuntimeConfig): Promise<AnthropicClient> {
    assertAnthropicConfig(config);
    const rawBaseUrl = config.baseUrl || DEFAULT_BASE_URL;
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(rawBaseUrl);
    } catch {
      throw new AnthropicInputError('Anthropic base URL must be a valid URL');
    }
    if (
      parsedBaseUrl.username ||
      parsedBaseUrl.password ||
      parsedBaseUrl.search ||
      parsedBaseUrl.hash
    ) {
      throw new AnthropicInputError(
        'Anthropic base URL cannot contain credentials, query, or fragment',
      );
    }
    await assertSafeProviderDestination(rawBaseUrl, false);
    return this.createClient(config);
  }

  private chatBody(
    request: ProviderChatRequest,
  ): Omit<Anthropic.MessageCreateParamsNonStreaming, 'stream'> {
    validateChatRequest(request);
    const { messages, system } = mapMessages(request.messages);
    const body: Omit<Anthropic.MessageCreateParamsNonStreaming, 'stream'> = {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(system ? { system } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.tools?.length
        ? { tools: request.tools.map(toAnthropicTool), tool_choice: { type: 'auto' } }
        : {}),
      ...(request.responseSchema
        ? {
            output_config: {
              format: { type: 'json_schema', schema: request.responseSchema },
            },
          }
        : {}),
    };
    assertJsonSize(body, MAX_REQUEST_BYTES, 'Anthropic request');
    return body;
  }

  private requestOptions(request: ProviderChatRequest): Anthropic.RequestOptions {
    return {
      maxRetries: 0,
      timeout: boundedTimeout(request.timeoutMs),
      signal: request.signal,
    };
  }
}

function mapMessages(input: ProviderChatRequest['messages']): {
  messages: Anthropic.MessageParam[];
  system: string;
} {
  const messages: Anthropic.MessageParam[] = [];
  const systemParts: string[] = [];

  for (const message of input) {
    const content = message.content ?? '';
    assertTextSize(content, MAX_TEXT_BYTES, 'Anthropic message');
    if (message.role === 'system') {
      if (content) systemParts.push(content);
      continue;
    }
    if (message.role === 'tool') {
      if (!message.toolCallId) {
        throw new AnthropicInputError('Anthropic tool result is missing toolCallId');
      }
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: boundedIdentifier(message.toolCallId, 'tool call id'),
            content,
          },
        ],
      });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.toolCalls.length > MAX_TOOLS) {
        throw new AnthropicInputError('Anthropic request contains too many tool calls');
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (content) blocks.push({ type: 'text', text: content });
      for (const toolCall of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: boundedIdentifier(toolCall.id, 'tool call id'),
          name: boundedIdentifier(toolCall.function.name, 'tool name'),
          input: parseToolArguments(toolCall.function.arguments),
        });
      }
      messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    messages.push({ role: message.role, content });
  }

  if (!messages.length) throw new AnthropicInputError('Anthropic request requires a user message');
  const system = systemParts.join('\n\n');
  assertTextSize(system, MAX_TEXT_BYTES, 'Anthropic system prompt');
  return { messages, system };
}

function toAnthropicTool(tool: ProviderToolDefinition): Anthropic.Tool {
  const parameters = tool.function.parameters;
  if (parameters.type !== undefined && parameters.type !== 'object') {
    throw new AnthropicInputError(`Tool ${tool.function.name} must use an object input schema`);
  }
  return {
    name: boundedIdentifier(tool.function.name, 'tool name'),
    description:
      typeof tool.function.description === 'string'
        ? boundedString(tool.function.description, 50_000)
        : '',
    input_schema: { type: 'object', ...parameters },
  };
}

function validateChatRequest(request: ProviderChatRequest): void {
  if (typeof request.model !== 'string' || !request.model || request.model.length > 512) {
    throw new AnthropicInputError('Anthropic model must be between 1 and 512 characters');
  }
  if (!request.messages.length || request.messages.length > MAX_MESSAGES) {
    throw new AnthropicInputError(
      `Anthropic requests support between 1 and ${MAX_MESSAGES} messages`,
    );
  }
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_MAX_TOKENS) {
    throw new AnthropicInputError(`maxTokens must be between 1 and ${MAX_MAX_TOKENS}`);
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 1)
  ) {
    throw new AnthropicInputError('temperature must be between 0 and 1');
  }
  if (request.tools) validateToolDefinitions(request.tools);
  if (request.responseSchema) validateSchema(request.responseSchema, 'structured output schema');
}

function validateToolDefinitions(tools: ProviderToolDefinition[]): void {
  if (tools.length > MAX_TOOLS) {
    throw new AnthropicInputError(`Anthropic supports at most ${MAX_TOOLS} tools per request`);
  }
  const names = new Set<string>();
  for (const tool of tools) {
    const name = boundedIdentifier(tool.function.name, 'tool name');
    if (names.has(name)) throw new AnthropicInputError(`Duplicate Anthropic tool name: ${name}`);
    names.add(name);
    validateSchema(tool.function.parameters, `schema for tool ${name}`);
    if (tool.function.parameters.type !== undefined && tool.function.parameters.type !== 'object') {
      throw new AnthropicInputError(`Tool ${name} must use an object input schema`);
    }
  }
}

function validateSchema(schema: Record<string, unknown>, label: string): void {
  if (!schema || Array.isArray(schema) || typeof schema !== 'object') {
    throw new AnthropicInputError(`${label} must be a JSON object`);
  }
  assertJsonSize(schema, MAX_SCHEMA_BYTES, label);
}

function parseToolArguments(value: string): unknown {
  assertTextSize(value, MAX_TOOL_ARGUMENT_BYTES, 'Anthropic tool arguments');
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new AnthropicInputError('Anthropic tool arguments must be a valid JSON object');
  }
}

function initialToolInput(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) {
    return '';
  }
  return jsonStringifyBounded(value ?? {}, MAX_TOOL_ARGUMENT_BYTES, 'Anthropic tool arguments');
}

function finalizeStreamToolCall(toolCall: PendingToolCall): ProviderToolCall {
  const input = parseToolArguments(toolCall.arguments || '{}');
  return {
    id: toolCall.id,
    type: 'function',
    function: { name: toolCall.name, arguments: JSON.stringify(input) },
  };
}

function toProviderToolCall(id: string, name: string, input: unknown): ProviderToolCall {
  return {
    id: boundedIdentifier(id, 'tool call id'),
    type: 'function',
    function: {
      name: boundedIdentifier(name, 'tool name'),
      arguments: jsonStringifyBounded(
        input ?? {},
        MAX_TOOL_ARGUMENT_BYTES,
        'Anthropic tool arguments',
      ),
    },
  };
}

function assertAnthropicConfig(config: ProviderRuntimeConfig): void {
  if (config.type !== 'ANTHROPIC') {
    throw new AnthropicInputError('Anthropic adapter requires an ANTHROPIC provider connection');
  }
  requiredApiKey(config);
}

function requiredApiKey(config: ProviderRuntimeConfig): string {
  const apiKey = config.credentials.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4_096) {
    throw new AnthropicInputError('Anthropic API key is required');
  }
  return apiKey;
}

function normalizedBaseUrl(value: string | null | undefined): string {
  const url = new URL(value || DEFAULT_BASE_URL);
  url.pathname = url.pathname.replace(/\/v1\/?$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 30_000;
  return Math.max(1_000, Math.min(Math.trunc(value), 300_000));
}

function normalizeApiError(error: APIError): NormalizedProviderError {
  const status = typeof error.status === 'number' ? error.status : undefined;
  const requestId = safeRequestId(error.requestID);
  const suffix = requestId ? ` (request ${requestId})` : '';
  if (status === 401 || status === 403) {
    return {
      code: 'PROVIDER_AUTH_FAILED',
      message: `Anthropic credential was rejected${suffix}`,
      retryable: false,
      statusCode: status,
    };
  }
  if (status === 429) {
    return {
      code: 'PROVIDER_RATE_LIMITED',
      message: `Anthropic rate limit was exceeded${suffix}`,
      retryable: true,
      statusCode: status,
    };
  }
  if (status === undefined) {
    return {
      code: 'PROVIDER_ERROR',
      message: 'Anthropic request failed',
      retryable: false,
    };
  }
  return {
    code: `PROVIDER_HTTP_${status}`,
    message: `Anthropic request failed with HTTP ${status}${suffix}`,
    retryable: status === 408 || status === 409 || status >= 500,
    statusCode: status,
  };
}

function safeRequestId(value: string | null | undefined): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : '';
}

function mergeUsage(current: NormalizedUsage | undefined, next: NormalizedUsage): NormalizedUsage {
  const inputTokens = Math.max(current?.inputTokens ?? 0, next.inputTokens);
  const outputTokens = Math.max(current?.outputTokens ?? 0, next.outputTokens);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tokenValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function boundedIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 512 || hasControlCharacter(value)) {
    throw new AnthropicInputError(`${label} must be between 1 and 512 safe characters`);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function boundedString(value: string, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function appendBounded(current: string, value: string, limit: number, label: string): string {
  const next = current + value;
  assertTextSize(next, limit, label);
  return next;
}

function assertTextSize(value: string, limit: number, label: string): void {
  if (typeof value !== 'string') throw new AnthropicInputError(`${label} must be text`);
  if (Buffer.byteLength(value, 'utf8') > limit) {
    throw new AnthropicInputError(`${label} exceeded the size limit`);
  }
}

function assertJsonSize(value: unknown, limit: number, label: string): void {
  const size = jsonByteLength(value, label.startsWith('Anthropic response') ? 'response' : 'input');
  if (size > limit) {
    if (label.startsWith('Anthropic response')) {
      throw new AnthropicResponseLimitError(`${label} exceeded the size limit`);
    }
    throw new AnthropicInputError(`${label} exceeded the size limit`);
  }
}

function jsonStringifyBounded(value: unknown, limit: number, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AnthropicInputError(`${label} must be JSON serializable`);
  }
  const result = serialized ?? '{}';
  assertTextSize(result, limit, label);
  return result;
}

function jsonByteLength(value: unknown, kind: 'input' | 'response' = 'response'): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    if (kind === 'input')
      throw new AnthropicInputError('Anthropic payload must be JSON serializable');
    throw new AnthropicResponseLimitError('Anthropic returned a non-serializable response');
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'APIConnectionTimeoutError')
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
