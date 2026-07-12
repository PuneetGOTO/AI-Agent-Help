import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  type FoundationModelSummary,
} from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ConverseCommandInput,
  type ConverseResponse,
  type ConverseStreamOutput,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolSpecification,
} from '@aws-sdk/client-bedrock-runtime';
import type { ProviderCapabilities } from '@agent-platform/shared';
import { assertSafeProviderDestination } from './ssrf-protection';
import { assertAllowedBedrockEndpoint } from './bedrock-endpoint-policy';
import type {
  ChatMessage,
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

const MAX_MESSAGES = 200;
const MAX_MESSAGE_BYTES = 2_000_000;
const MAX_TOOLS = 32;
const MAX_TOOL_SCHEMA_BYTES = 256_000;
const MAX_TOOL_ARGUMENT_BYTES = 256_000;
const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_STREAM_EVENTS = 100_000;
const MAX_EMBEDDING_INPUT_BYTES = 1_000_000;
const MAX_EMBEDDING_BATCH_BYTES = 5_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_RESPONSE_TOKENS = 131_072;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_LIST_MODELS = 500;

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
};

type RuntimeInput = ConverseCommandInput & {
  outputConfig?: Record<string, unknown>;
};

/**
 * AWS Bedrock's Converse protocol is deliberately kept in this adapter. The
 * rest of the application only sees the provider-neutral interfaces.
 */
@Injectable()
export class BedrockAdapter implements ProviderAdapter {
  async validateCredential(config: ProviderRuntimeConfig): Promise<boolean> {
    await this.listModels(config);
    return true;
  }

  async listModels(config: ProviderRuntimeConfig): Promise<ProviderModel[]> {
    const client = await this.createControlClient(config);
    const timeout = createTimeoutSignal(15_000);
    try {
      const response = await client.send(new ListFoundationModelsCommand({}), {
        abortSignal: timeout.signal,
      });
      return (response.modelSummaries ?? [])
        .slice(0, MAX_LIST_MODELS)
        .filter((summary) => summary.modelId)
        .map((summary) => this.modelFromSummary(summary));
    } catch (error) {
      throw toBedrockError(error);
    } finally {
      timeout.cleanup();
      client.destroy();
    }
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): Promise<ProviderChatResponse> {
    const input = this.converseInput(request);
    const client = await this.createRuntimeClient(config);
    const timeout = createTimeoutSignal(request.timeoutMs, request.signal);
    try {
      const response = await client.send(new ConverseCommand(input), {
        abortSignal: timeout.signal,
      });
      return this.parseChatResponse(response, request.model);
    } catch (error) {
      throw toBedrockError(error);
    } finally {
      timeout.cleanup();
      client.destroy();
    }
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncGenerator<ProviderStreamChunk> {
    const input = this.converseInput(request);
    const client = await this.createRuntimeClient(config);
    const timeout = createTimeoutSignal(request.timeoutMs, request.signal);
    const toolCalls = new Map<number, ProviderToolCall>();
    let outputBytes = 0;
    let eventCount = 0;
    let totalToolCalls = 0;
    let finishReason: string | undefined;
    let usageEmitted = false;

    try {
      const response = await client.send(new ConverseStreamCommand(input), {
        abortSignal: timeout.signal,
      });
      if (!response.stream)
        throw new BedrockAdapterError('PROVIDER_EMPTY_STREAM', 'Provider returned an empty stream');

      for await (const event of response.stream) {
        eventCount += 1;
        if (eventCount > MAX_STREAM_EVENTS) {
          throw new BedrockAdapterError(
            'PROVIDER_RESPONSE_TOO_LARGE',
            'Provider stream exceeded the event limit',
          );
        }

        const typed = event;
        if (typed.metadata) {
          if (typed.metadata.usage) {
            usageEmitted = true;
            yield { type: 'usage', usage: this.normalizeUsage(typed.metadata.usage) };
          }
          continue;
        }
        if (typed.messageStop) {
          finishReason = typed.messageStop.stopReason
            ? String(typed.messageStop.stopReason)
            : undefined;
          continue;
        }
        if (typed.contentBlockStart?.start?.toolUse) {
          const index = typed.contentBlockStart.contentBlockIndex ?? toolCalls.size;
          const start = typed.contentBlockStart.start.toolUse;
          const id = start.toolUseId;
          const name = start.name;
          if (!id || !name) {
            throw new BedrockAdapterError(
              'PROVIDER_INVALID_RESPONSE',
              'Provider returned an invalid tool call',
            );
          }
          totalToolCalls += 1;
          if (totalToolCalls > MAX_TOOLS) {
            throw new BedrockAdapterError(
              'PROVIDER_TOOL_LIMIT',
              'Provider returned too many tool calls',
            );
          }
          toolCalls.set(index, {
            id: limitString(id, 256),
            type: 'function',
            function: { name: limitString(name, 64), arguments: '' },
          });
          continue;
        }
        if (typed.contentBlockDelta?.delta) {
          const index = typed.contentBlockDelta.contentBlockIndex ?? -1;
          const delta = typed.contentBlockDelta.delta;
          if ('text' in delta && typeof delta.text === 'string') {
            outputBytes += byteLength(delta.text);
            if (outputBytes > MAX_OUTPUT_BYTES) {
              throw new BedrockAdapterError(
                'PROVIDER_RESPONSE_TOO_LARGE',
                'Provider output exceeded the size limit',
              );
            }
            if (delta.text) yield { type: 'token', content: delta.text };
          }
          if ('toolUse' in delta && delta.toolUse?.input) {
            const current = toolCalls.get(index);
            if (!current) {
              throw new BedrockAdapterError(
                'PROVIDER_INVALID_RESPONSE',
                'Provider returned a tool delta without a tool call',
              );
            }
            current.function.arguments += delta.toolUse.input;
            if (byteLength(current.function.arguments) > MAX_TOOL_ARGUMENT_BYTES) {
              throw new BedrockAdapterError(
                'PROVIDER_TOOL_LIMIT',
                'Provider tool arguments exceeded the size limit',
              );
            }
          }
          continue;
        }
        if (typed.contentBlockStop) {
          const index = typed.contentBlockStop.contentBlockIndex ?? -1;
          const current = toolCalls.get(index);
          if (current) {
            current.function.arguments = normalizeToolArguments(current.function.arguments);
            yield { type: 'tool_call', toolCall: current };
            toolCalls.delete(index);
          }
          continue;
        }

        const streamError = streamErrorEvent(typed);
        if (streamError) throw streamError;
      }

      for (const toolCall of toolCalls.values()) {
        toolCall.function.arguments = normalizeToolArguments(toolCall.function.arguments);
        yield { type: 'tool_call', toolCall };
      }
      if (!usageEmitted) {
        throw new BedrockAdapterError(
          'PROVIDER_INVALID_RESPONSE',
          'Bedrock stream did not include usage metadata',
        );
      }
      yield { type: 'done', finishReason };
    } catch (error) {
      throw toBedrockError(error);
    } finally {
      timeout.cleanup();
      client.destroy();
    }
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    const kind = embeddingKind(request.model);
    if (!kind) throw unsupported('Embeddings for this Bedrock model');
    if (request.input.length > 128) {
      throw new BadRequestException('Bedrock embedding batch is limited to 128 inputs');
    }
    const inputBytes = request.input.reduce((total, value) => total + byteLength(value), 0);
    if (request.input.some((value) => byteLength(value) > MAX_EMBEDDING_INPUT_BYTES)) {
      throw new BadRequestException('Bedrock embedding input exceeded the size limit');
    }
    if (inputBytes > MAX_EMBEDDING_BATCH_BYTES) {
      throw new BadRequestException('Bedrock embedding batch exceeded the size limit');
    }
    if (!request.input.length) {
      return { embeddings: [], usage: this.normalizeUsage(undefined) };
    }

    const client = await this.createRuntimeClient(config);
    const timeoutMs = boundedTimeout(request.timeoutMs);
    let inputTokens = 0;
    try {
      const embeddings: number[][] = [];
      if (kind === 'titan') {
        // Titan text embedding models accept one inputText per invocation.
        for (const text of request.input) {
          const payload = { inputText: text };
          const response = await this.invokeEmbedding(client, request.model, payload, timeoutMs);
          const vector = readNumberArray(response.embedding);
          if (!vector.length)
            throw new BedrockAdapterError(
              'PROVIDER_INVALID_RESPONSE',
              'Bedrock returned an empty embedding',
            );
          embeddings.push(vector);
          inputTokens += numberValue(response.inputTextTokenCount);
        }
      } else {
        const payload = { texts: request.input, input_type: 'search_document' };
        const response = await this.invokeEmbedding(client, request.model, payload, timeoutMs);
        const raw = response.embeddings;
        const vectors = Array.isArray(raw)
          ? raw
          : isRecord(raw) && Array.isArray(raw.float)
            ? raw.float
            : [];
        for (const vector of vectors) {
          const parsed = readNumberArray(vector);
          if (!parsed.length)
            throw new BedrockAdapterError(
              'PROVIDER_INVALID_RESPONSE',
              'Bedrock returned an empty embedding',
            );
          embeddings.push(parsed);
        }
        inputTokens = numberValue(response.inputTokens ?? response.input_tokens);
      }
      if (embeddings.length !== request.input.length) {
        throw new BedrockAdapterError(
          'PROVIDER_INVALID_RESPONSE',
          'Bedrock returned an unexpected embedding count',
        );
      }
      return {
        embeddings,
        usage: { inputTokens, outputTokens: 0, totalTokens: inputTokens },
      };
    } catch (error) {
      throw toBedrockError(error);
    } finally {
      client.destroy();
    }
  }

  toolCalling(request: ProviderChatRequest, tools: ProviderToolDefinition[]): ProviderChatRequest {
    if (!this.capabilityDetection(request.model).toolCalling) throw unsupported('Tool calling');
    validateTools(tools);
    return { ...request, tools };
  }

  structuredOutput(
    request: ProviderChatRequest,
    schema: Record<string, unknown>,
  ): ProviderChatRequest {
    if (!this.capabilityDetection(request.model).structuredOutput) {
      throw unsupported('Structured output for this Bedrock model');
    }
    validateSchema(schema);
    return { ...request, responseSchema: schema };
  }

  normalizeUsage(raw: unknown): NormalizedUsage {
    const usage = isRecord(raw) ? raw : {};
    const inputTokens = numberValue(
      usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTextTokenCount,
    );
    const outputTokens = numberValue(
      usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens,
    );
    const total = numberValue(usage.totalTokens ?? usage.total_tokens);
    return {
      inputTokens,
      outputTokens,
      totalTokens: total || inputTokens + outputTokens,
    };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    if (error instanceof BedrockAdapterError) {
      return {
        code: error.code,
        message: error.safeMessage,
        retryable: error.retryable,
        ...(error.statusCode ? { statusCode: error.statusCode } : {}),
      };
    }
    if (error instanceof NotImplementedException) {
      return {
        code: 'PROVIDER_UNSUPPORTED',
        message: 'Bedrock capability is not supported for this model',
        retryable: false,
      };
    }
    if (error instanceof BadRequestException) {
      return {
        code: 'PROVIDER_INVALID_REQUEST',
        message: 'Bedrock request is invalid',
        retryable: false,
        statusCode: 400,
      };
    }
    const record = isRecord(error) ? error : {};
    const name = typeof record.name === 'string' ? record.name : '';
    const metadata = isRecord(record.$metadata) ? record.$metadata : {};
    const statusCode = numberValue(record.statusCode ?? metadata.httpStatusCode);
    const requestId = typeof metadata.requestId === 'string' ? metadata.requestId : undefined;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { code: 'PROVIDER_TIMEOUT', message: 'Bedrock request timed out', retryable: true };
    }
    if (/AccessDenied|Unauthorized/i.test(name) || statusCode === 401 || statusCode === 403) {
      return {
        code: 'PROVIDER_AUTH_FAILED',
        message: safeProviderMessage('Bedrock authorization failed', requestId),
        retryable: false,
        statusCode: statusCode || 403,
      };
    }
    if (
      /Throttl|TooManyRequests|ServiceUnavailable|InternalServer|ModelNotReady/i.test(name) ||
      statusCode === 429 ||
      statusCode >= 500
    ) {
      return {
        code: 'PROVIDER_UNAVAILABLE',
        message: safeProviderMessage('Bedrock service is temporarily unavailable', requestId),
        retryable: true,
        ...(statusCode ? { statusCode } : {}),
      };
    }
    if (
      /Validation|ResourceNotFound|ModelError|Conflict/i.test(name) ||
      (statusCode >= 400 && statusCode < 500)
    ) {
      return {
        code: 'PROVIDER_INVALID_REQUEST',
        message: safeProviderMessage('Bedrock rejected the request', requestId),
        retryable: false,
        ...(statusCode ? { statusCode } : {}),
      };
    }
    return { code: 'PROVIDER_ERROR', message: 'Bedrock request failed', retryable: false };
  }

  capabilityDetection(model?: string): ProviderCapabilities {
    const id = model?.toLowerCase() ?? '';
    if (id && embeddingKind(id)) {
      return {
        chat: false,
        streaming: false,
        embeddings: true,
        toolCalling: false,
        structuredOutput: false,
        vision: false,
        modelListing: true,
      };
    }
    if (!id) {
      return {
        chat: true,
        streaming: true,
        embeddings: true,
        toolCalling: false,
        structuredOutput: false,
        vision: false,
        modelListing: true,
      };
    }
    const toolCalling =
      /(?:anthropic\.claude-3|amazon\.nova-|cohere\.command-r|mistral\.mistral-large|meta\.llama3-[123])/i.test(
        id,
      );
    const structuredOutput =
      /(?:amazon\.nova-(?:micro|lite|pro)|anthropic\.claude-(?:3-5-(?:sonnet|haiku)|3-7-sonnet|sonnet-4|opus-4|haiku-4))/i.test(
        id,
      );
    const vision = /(?:anthropic\.claude-3|amazon\.nova-pro|meta\.llama3-2)/i.test(id);
    return {
      chat: true,
      streaming: true,
      embeddings: false,
      toolCalling,
      structuredOutput,
      vision,
      modelListing: true,
    };
  }

  private async createControlClient(config: ProviderRuntimeConfig): Promise<BedrockClient> {
    const credentials = readCredentials(config);
    const endpoint = await this.endpoint(config, credentials.region);
    return new BedrockClient({
      region: credentials.region,
      credentials,
      maxAttempts: 2,
      ...(endpoint ? { endpoint } : {}),
    });
  }

  private async createRuntimeClient(config: ProviderRuntimeConfig): Promise<BedrockRuntimeClient> {
    const credentials = readCredentials(config);
    const endpoint = await this.endpoint(config, credentials.region);
    return new BedrockRuntimeClient({
      region: credentials.region,
      credentials,
      maxAttempts: 2,
      ...(endpoint ? { endpoint } : {}),
    });
  }

  private async endpoint(
    config: ProviderRuntimeConfig,
    region: string,
  ): Promise<string | undefined> {
    const configured = config.baseUrl ?? config.config?.endpoint;
    if (configured === undefined || configured === null || configured === '') return undefined;
    if (typeof configured !== 'string')
      throw new BadRequestException('Bedrock endpoint must be a URL');
    assertAllowedBedrockEndpoint(configured, {
      allowCustom: config.allowCustomAwsEndpoint === true,
      region,
    });
    await assertSafeProviderDestination(configured, false);
    return configured;
  }

  private converseInput(request: ProviderChatRequest): RuntimeInput {
    const capabilities = this.capabilityDetection(request.model);
    if (!capabilities.chat) throw unsupported('Chat for this Bedrock model');
    const { system, messages } = convertMessages(request.messages);
    const input: RuntimeInput = {
      modelId: request.model,
      messages,
      ...(system.length ? { system } : {}),
      inferenceConfig: {
        ...(request.temperature === undefined
          ? {}
          : { temperature: boundedTemperature(request.temperature) }),
        ...(request.maxTokens === undefined ? {} : { maxTokens: boundedTokens(request.maxTokens) }),
      },
    };
    if (request.tools?.length) {
      if (!capabilities.toolCalling) throw unsupported('Tool calling for this Bedrock model');
      validateTools(request.tools);
      input.toolConfig = {
        tools: request.tools.map((tool) => toBedrockTool(tool, capabilities.structuredOutput)),
        toolChoice: { auto: {} },
      };
    }
    if (request.responseSchema) {
      if (!capabilities.structuredOutput)
        throw unsupported('Structured output for this Bedrock model');
      validateSchema(request.responseSchema);
      input.outputConfig = {
        textFormat: {
          type: 'json_schema',
          structure: {
            jsonSchema: {
              name: 'agent_response',
              schema: JSON.stringify(request.responseSchema),
            },
          },
        },
      };
    }
    return input;
  }

  private parseChatResponse(
    response: ConverseResponse,
    requestedModel: string,
  ): ProviderChatResponse {
    const message =
      response.output && 'message' in response.output ? response.output.message : undefined;
    let content = '';
    const toolCalls: ProviderToolCall[] = [];
    for (const block of message?.content ?? []) {
      if ('text' in block && typeof block.text === 'string') {
        content += block.text;
        if (byteLength(content) > MAX_OUTPUT_BYTES)
          throw new BedrockAdapterError(
            'PROVIDER_RESPONSE_TOO_LARGE',
            'Provider output exceeded the size limit',
          );
      }
      if ('toolUse' in block && block.toolUse) {
        if (toolCalls.length >= MAX_TOOLS)
          throw new BedrockAdapterError(
            'PROVIDER_TOOL_LIMIT',
            'Provider returned too many tool calls',
          );
        const tool = block.toolUse;
        if (!tool.toolUseId || !tool.name)
          throw new BedrockAdapterError(
            'PROVIDER_INVALID_RESPONSE',
            'Provider returned an invalid tool call',
          );
        const args = normalizeToolArguments(safeJsonStringify(tool.input ?? {}));
        toolCalls.push({
          id: limitString(tool.toolUseId, 256),
          type: 'function',
          function: { name: limitString(tool.name, 64), arguments: args },
        });
      }
    }
    return {
      content,
      toolCalls,
      usage: this.normalizeUsage(response.usage),
      model: requestedModel,
      finishReason: response.stopReason ? String(response.stopReason) : undefined,
    };
  }

  private async invokeEmbedding(
    client: BedrockRuntimeClient,
    modelId: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const response = await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: Buffer.from(JSON.stringify(payload), 'utf8'),
        }),
        { abortSignal: timeout.signal },
      );
      const body = await readResponseBody(response.body);
      if (body.length > MAX_RESPONSE_BYTES)
        throw new BedrockAdapterError(
          'PROVIDER_RESPONSE_TOO_LARGE',
          'Provider response exceeded the size limit',
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new BedrockAdapterError('PROVIDER_INVALID_RESPONSE', 'Bedrock returned invalid JSON');
      }
      if (!isRecord(parsed))
        throw new BedrockAdapterError(
          'PROVIDER_INVALID_RESPONSE',
          'Bedrock returned an invalid response',
        );
      return parsed;
    } finally {
      timeout.cleanup();
    }
  }

  private modelFromSummary(summary: FoundationModelSummary): ProviderModel {
    const id = summary.modelId ?? '';
    const detected = this.capabilityDetection(id);
    const inputModalities = summary.inputModalities ?? [];
    const outputModalities = summary.outputModalities ?? [];
    return {
      id,
      name: summary.modelName || id,
      capabilities: {
        ...detected,
        chat: inputModalities.includes('TEXT') && outputModalities.includes('TEXT'),
        embeddings: outputModalities.includes('EMBEDDING'),
        streaming: summary.responseStreamingSupported === true && detected.streaming,
      },
    };
  }
}

class BedrockAdapterError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly retryable = false,
    readonly statusCode?: number,
  ) {
    super(safeMessage);
    this.name = 'BedrockAdapterError';
  }
}

function readCredentials(config: ProviderRuntimeConfig): AwsCredentials {
  const credentials = config.credentials as Record<string, unknown>;
  const accessKeyId = stringValue(credentials.accessKeyId);
  const secretAccessKey = stringValue(credentials.secretAccessKey);
  const sessionToken = stringValue(credentials.sessionToken);
  const region = stringValue(credentials.region);
  if (!accessKeyId || !secretAccessKey || !region) {
    throw new BadRequestException(
      'Bedrock credentials require accessKeyId, secretAccessKey and region',
    );
  }
  if (accessKeyId.length > 256 || secretAccessKey.length > 512 || region.length > 64) {
    throw new BadRequestException('Bedrock credentials are invalid');
  }
  return { accessKeyId, secretAccessKey, region, ...(sessionToken ? { sessionToken } : {}) };
}

function convertMessages(messages: ChatMessage[]): {
  system: Array<{ text: string }>;
  messages: Message[];
} {
  if (messages.length > MAX_MESSAGES)
    throw new BadRequestException('Bedrock message count exceeded the limit');
  const system: Array<{ text: string }> = [];
  const converted: Message[] = [];
  let totalBytes = 0;
  for (const message of messages) {
    const text = message.content ?? '';
    totalBytes += byteLength(text);
    if (totalBytes > MAX_MESSAGE_BYTES)
      throw new BadRequestException('Bedrock messages exceeded the size limit');
    if (message.role === 'system') {
      if (text) system.push({ text: limitString(text, MAX_MESSAGE_BYTES) });
      continue;
    }
    if (message.role === 'tool') {
      if (!message.toolCallId)
        throw new BadRequestException('Bedrock tool messages require toolCallId');
      converted.push({
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: limitString(message.toolCallId, 256),
              content: [{ text: limitString(text, MAX_TOOL_ARGUMENT_BYTES) }],
            },
          },
        ],
      });
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new BadRequestException('Bedrock message role is invalid');
    }
    const content: ContentBlock[] = [];
    if (text) content.push({ text });
    for (const call of message.toolCalls ?? []) {
      if (!call.id || !call.function?.name)
        throw new BadRequestException('Bedrock assistant tool call is invalid');
      const args = parseToolArguments(call.function.arguments);
      content.push({
        toolUse: {
          toolUseId: limitString(call.id, 256),
          name: limitString(call.function.name, 64),
          input: args as never,
        },
      });
    }
    if (!content.length) content.push({ text: '' });
    converted.push({ role: message.role, content });
  }
  if (!converted.length)
    throw new BadRequestException('Bedrock requires at least one non-system message');
  return { system, messages: converted };
}

function validateTools(tools: ProviderToolDefinition[]): void {
  if (tools.length > MAX_TOOLS)
    throw new BadRequestException('Bedrock tool count exceeded the limit');
  let totalBytes = 0;
  for (const tool of tools) {
    const name = tool.function?.name;
    if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      throw new BadRequestException('Bedrock tool name is invalid');
    }
    if (
      !tool.function.parameters ||
      typeof tool.function.parameters !== 'object' ||
      Array.isArray(tool.function.parameters)
    ) {
      throw new BadRequestException('Bedrock tool parameters must be a JSON object');
    }
    totalBytes += byteLength(safeJsonStringify(tool.function.parameters));
    if (totalBytes > MAX_TOOL_SCHEMA_BYTES)
      throw new BadRequestException('Bedrock tool schemas exceeded the size limit');
  }
}

function toBedrockTool(tool: ProviderToolDefinition, strict: boolean): Tool {
  const specification: ToolSpecification = {
    name: tool.function.name,
    description: limitString(tool.function.description || '', 4_000),
    inputSchema: { json: tool.function.parameters as never },
    ...(strict ? { strict: true } : {}),
  };
  return { toolSpec: specification };
}

function validateSchema(schema: Record<string, unknown>): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new BadRequestException('Bedrock response schema must be an object');
  if (byteLength(safeJsonStringify(schema)) > MAX_TOOL_SCHEMA_BYTES)
    throw new BadRequestException('Bedrock response schema exceeded the size limit');
}

function parseToolArguments(value: string): Record<string, unknown> {
  if (byteLength(value) > MAX_TOOL_ARGUMENT_BYTES)
    throw new BadRequestException('Bedrock tool arguments exceeded the size limit');
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    if (!isRecord(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new BadRequestException('Bedrock tool arguments must be valid JSON');
  }
}

function normalizeToolArguments(value: string): string {
  if (!value) return '{}';
  if (byteLength(value) > MAX_TOOL_ARGUMENT_BYTES)
    throw new BedrockAdapterError(
      'PROVIDER_TOOL_LIMIT',
      'Provider tool arguments exceeded the size limit',
    );
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? JSON.stringify(parsed) : '{}';
  } catch {
    // Streaming deltas may finish at a non-JSON boundary. Preserve the value
    // for the execution layer to reject instead of silently changing it.
    return value;
  }
}

function embeddingKind(model: string): 'titan' | 'cohere' | undefined {
  if (/^amazon\.titan-embed-text(?:-[a-z0-9-]+)?(?::\d+)?$/i.test(model)) return 'titan';
  if (/^cohere\.embed-(?:english|multilingual)-v\d+(?::\d+)?$/i.test(model)) return 'cohere';
  return undefined;
}

function streamErrorEvent(event: ConverseStreamOutput): BedrockAdapterError | undefined {
  const candidate = event as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(candidate)) {
    if (!/Exception$/.test(key) || !isRecord(value)) continue;
    const name = key.replace(/Exception$/, '');
    const retryable = /^(?:throttling|serviceUnavailable|internalServer|modelStreamError)$/i.test(
      name,
    );
    return new BedrockAdapterError(
      `PROVIDER_${name.toUpperCase()}`,
      retryable ? 'Bedrock stream failed temporarily' : 'Bedrock stream failed',
      retryable,
    );
  }
  return undefined;
}

function toBedrockError(error: unknown): Error {
  if (
    error instanceof BedrockAdapterError ||
    error instanceof BadRequestException ||
    error instanceof NotImplementedException
  )
    return error;
  const normalized = normalizeAwsError(error);
  return new BedrockAdapterError(
    normalized.code,
    normalized.message,
    normalized.retryable,
    normalized.statusCode,
  );
}

function normalizeAwsError(error: unknown): NormalizedProviderError {
  const record = isRecord(error) ? error : {};
  const name = typeof record.name === 'string' ? record.name : '';
  const metadata = isRecord(record.$metadata) ? record.$metadata : {};
  const statusCode = numberValue(record.statusCode ?? metadata.httpStatusCode);
  const requestId = typeof metadata.requestId === 'string' ? metadata.requestId : undefined;
  if (name === 'AbortError' || name === 'TimeoutError')
    return { code: 'PROVIDER_TIMEOUT', message: 'Bedrock request timed out', retryable: true };
  if (/AccessDenied|Unauthorized/i.test(name) || statusCode === 401 || statusCode === 403)
    return {
      code: 'PROVIDER_AUTH_FAILED',
      message: safeProviderMessage('Bedrock authorization failed', requestId),
      retryable: false,
      statusCode: statusCode || 403,
    };
  if (
    /Throttl|TooManyRequests|ServiceUnavailable|InternalServer|ModelNotReady/i.test(name) ||
    statusCode === 429 ||
    statusCode >= 500
  )
    return {
      code: 'PROVIDER_UNAVAILABLE',
      message: safeProviderMessage('Bedrock service is temporarily unavailable', requestId),
      retryable: true,
      ...(statusCode ? { statusCode } : {}),
    };
  return {
    code: 'PROVIDER_ERROR',
    message: 'Bedrock request failed',
    retryable: false,
    ...(statusCode ? { statusCode } : {}),
  };
}

function safeProviderMessage(message: string, requestId?: string): string {
  return requestId
    ? `${message} (request ${requestId.slice(0, 100).replace(/[^A-Za-z0-9._:-]/g, '')})`
    : message;
}

function unsupported(feature: string): NotImplementedException {
  return new NotImplementedException(`${feature} is not available for this Bedrock model`);
}

function createTimeoutSignal(
  timeoutMs = DEFAULT_TIMEOUT_MS,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Provider request timeout', 'TimeoutError')),
    boundedTimeout(timeoutMs),
  );
  const abortExternal = () => controller.abort(external?.reason);
  external?.addEventListener('abort', abortExternal, { once: true });
  if (external?.aborted) abortExternal();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      external?.removeEventListener('abort', abortExternal);
    },
  };
}

function boundedTimeout(value?: number): number {
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, numberValue(value) || DEFAULT_TIMEOUT_MS));
}

function boundedTemperature(value: number): number {
  if (!Number.isFinite(value)) throw new BadRequestException('Bedrock temperature is invalid');
  return Math.max(0, Math.min(2, value));
}

function boundedTokens(value: number): number {
  if (!Number.isFinite(value) || value < 1)
    throw new BadRequestException('Bedrock maxTokens is invalid');
  return Math.min(MAX_RESPONSE_TOKENS, Math.trunc(value));
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized : '{}';
  } catch {
    throw new BadRequestException('Bedrock payload must be JSON serializable');
  }
}

function readNumberArray(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    return [];
  }
  return value as number[];
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function limitString(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8');
}

async function readResponseBody(body: unknown): Promise<string> {
  if (
    body &&
    typeof body === 'object' &&
    'transformToString' in body &&
    typeof body.transformToString === 'function'
  ) {
    return String(await (body as { transformToString: () => Promise<string> }).transformToString());
  }
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  throw new BedrockAdapterError('PROVIDER_INVALID_RESPONSE', 'Bedrock returned an empty response');
}
