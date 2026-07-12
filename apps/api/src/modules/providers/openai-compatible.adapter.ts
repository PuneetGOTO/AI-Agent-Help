import { Injectable } from '@nestjs/common';
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

interface OpenAiResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ProviderToolCall[] };
    finish_reason?: string;
  }>;
  usage?: unknown;
  data?: Array<{ embedding?: number[] }>;
}

const MAX_REQUEST_BYTES = 5_000_000;
const MAX_MESSAGES = 1_000;
const MAX_EMBEDDING_INPUTS = 128;
const MAX_EMBEDDING_INPUT_BYTES = 1_000_000;

@Injectable()
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  async validateCredential(config: ProviderRuntimeConfig): Promise<boolean> {
    await this.listModels(config);
    return true;
  }

  async listModels(config: ProviderRuntimeConfig): Promise<ProviderModel[]> {
    if (config.type === 'AZURE_OPENAI') {
      const configured = config.config?.models;
      return Array.isArray(configured)
        ? configured
            .filter((model): model is string => typeof model === 'string')
            .map((id) => ({ id, name: id }))
        : [];
    }
    const response = await this.request(
      config,
      this.url(config, 'models'),
      { method: 'GET' },
      15_000,
    );
    const json = await readJsonLimited<{ data?: Array<{ id?: string }> }>(response);
    return (json.data ?? []).flatMap((model) =>
      model.id
        ? [{ id: model.id, name: model.id, capabilities: this.capabilityDetection(model.id) }]
        : [],
    );
  }

  async chat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): Promise<ProviderChatResponse> {
    const response = await this.request(
      config,
      this.url(config, 'chat/completions', request.model),
      {
        method: 'POST',
        body: JSON.stringify(this.chatBody(request, false, config.type === 'AZURE_OPENAI')),
      },
      request.timeoutMs,
      request.signal,
    );
    const json = await readJsonLimited<OpenAiResponse>(response);
    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      toolCalls: choice?.message?.tool_calls ?? [],
      usage: this.normalizeUsage(json.usage),
      model: json.model ?? request.model,
      finishReason: choice?.finish_reason,
    };
  }

  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncGenerator<ProviderStreamChunk> {
    const response = await this.request(
      config,
      this.url(config, 'chat/completions', request.model),
      {
        method: 'POST',
        body: JSON.stringify(this.chatBody(request, true, config.type === 'AZURE_OPENAI')),
      },
      request.timeoutMs,
      request.signal,
    );
    if (!response.body) throw new Error('Provider returned an empty stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ProviderToolCall>();
    let buffer = '';
    let finishReason: string | undefined;
    let receivedBytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      receivedBytes += value?.byteLength ?? 0;
      if (receivedBytes > 10_000_000) {
        await reader.cancel();
        throw new Error('Provider stream exceeded the response size limit');
      }
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) {
        await reader.cancel();
        throw new Error('Provider stream event exceeded the size limit');
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        if (payload.length > 1_000_000) {
          throw new Error('Provider stream event exceeded the size limit');
        }
        const event = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string;
          }>;
          usage?: unknown;
        };
        if (event.usage) yield { type: 'usage', usage: this.normalizeUsage(event.usage) };
        const choice = event.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (choice?.delta?.content) yield { type: 'token', content: choice.delta.content };
        for (const delta of choice?.delta?.tool_calls ?? []) {
          const current = toolCalls.get(delta.index) ?? {
            id: delta.id ?? `call_${delta.index}`,
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };
          if (delta.id) current.id = delta.id;
          current.function.name += delta.function?.name ?? '';
          current.function.arguments += delta.function?.arguments ?? '';
          toolCalls.set(delta.index, current);
        }
      }
      if (done) break;
    }
    for (const toolCall of toolCalls.values()) yield { type: 'tool_call', toolCall };
    yield { type: 'done', finishReason };
  }

  async embeddings(
    config: ProviderRuntimeConfig,
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    if (!request.input.length || request.input.length > MAX_EMBEDDING_INPUTS) {
      throw new Error(`Embedding input count must be between 1 and ${MAX_EMBEDDING_INPUTS}`);
    }
    if (
      request.input.some((value) => Buffer.byteLength(value, 'utf8') > MAX_EMBEDDING_INPUT_BYTES)
    ) {
      throw new Error('Embedding input exceeds the size limit');
    }
    const body = JSON.stringify({ model: request.model, input: request.input });
    assertBodySize(body);
    const response = await this.request(
      config,
      this.url(config, 'embeddings', request.model),
      {
        method: 'POST',
        body,
      },
      request.timeoutMs,
    );
    const json = await readJsonLimited<OpenAiResponse>(response);
    return {
      embeddings: (json.data ?? []).map((item) => item.embedding ?? []),
      usage: this.normalizeUsage(json.usage),
    };
  }

  toolCalling(request: ProviderChatRequest, tools: ProviderToolDefinition[]): ProviderChatRequest {
    return { ...request, tools };
  }

  structuredOutput(
    request: ProviderChatRequest,
    schema: Record<string, unknown>,
  ): ProviderChatRequest {
    return { ...request, responseSchema: schema };
  }

  normalizeUsage(raw: unknown): NormalizedUsage {
    const usage = (raw ?? {}) as Record<string, unknown>;
    const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens);
    const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens);
    return {
      inputTokens,
      outputTokens,
      totalTokens: numberValue(usage.total_tokens) || inputTokens + outputTokens,
    };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    if (error instanceof ProviderHttpError) {
      return {
        code: error.code,
        message: error.safeMessage,
        statusCode: error.statusCode,
        retryable: error.statusCode === 429 || error.statusCode >= 500,
      };
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { code: 'PROVIDER_TIMEOUT', message: 'Provider request timed out', retryable: true };
    }
    return { code: 'PROVIDER_ERROR', message: 'Provider request failed', retryable: false };
  }

  capabilityDetection(model?: string): ProviderCapabilities {
    const legacy = model?.includes('instruct') || model?.startsWith('text-');
    return {
      chat: true,
      streaming: true,
      embeddings: model?.includes('embedding') ?? true,
      toolCalling: !legacy,
      structuredOutput: !legacy,
      vision: Boolean(model && /(vision|gpt-4o|gpt-4\.1)/i.test(model)),
      modelListing: true,
    };
  }

  private chatBody(
    request: ProviderChatRequest,
    stream: boolean,
    omitModel: boolean,
  ): Record<string, unknown> {
    if (!request.messages.length || request.messages.length > MAX_MESSAGES) {
      throw new Error(`Provider requests support between 1 and ${MAX_MESSAGES} messages`);
    }
    const body = {
      ...(!omitModel ? { model: request.model } : {}),
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}),
      ...(request.responseSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'agent_response', strict: true, schema: request.responseSchema },
            },
          }
        : {}),
    };
    assertBodySize(JSON.stringify(body));
    return body;
  }

  private url(config: ProviderRuntimeConfig, path: string, model?: string): string {
    const base = (config.baseUrl || defaultBaseUrl(config.type)).replace(/\/$/, '');
    if (config.type === 'AZURE_OPENAI') {
      const version = encodeURIComponent(
        String(config.credentials.azureApiVersion || '2024-10-21'),
      );
      return `${base}/openai/deployments/${encodeURIComponent(model ?? '')}/${path}?api-version=${version}`;
    }
    return `${base}/${path}`;
  }

  private async request(
    config: ProviderRuntimeConfig,
    url: string,
    init: RequestInit,
    timeoutMs = 30_000,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    await assertSafeProviderDestination(url, config.allowPrivateNetwork === true);
    const timeoutSignal = AbortSignal.timeout(Math.max(1_000, Math.min(timeoutMs, 300_000)));
    const signal = externalSignal
      ? AbortSignal.any([timeoutSignal, externalSignal])
      : timeoutSignal;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.credentials.apiKey) {
      if (config.type === 'AZURE_OPENAI') headers['api-key'] = config.credentials.apiKey;
      else headers.Authorization = `Bearer ${config.credentials.apiKey}`;
    }
    if (config.credentials.organization)
      headers['OpenAI-Organization'] = String(config.credentials.organization);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new DOMException('Provider request timeout', 'AbortError');
      }
      throw error;
    }
    if (!response.ok) {
      // Deliberately do not expose the provider response body; vendors sometimes echo request headers.
      throw new ProviderHttpError(
        response.status,
        response.headers.get('x-request-id') ?? undefined,
      );
    }
    return response;
  }
}

class ProviderHttpError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(
    readonly statusCode: number,
    requestId?: string,
  ) {
    super(`Provider request returned HTTP ${statusCode}`);
    this.name = 'ProviderHttpError';
    this.code =
      statusCode === 401 || statusCode === 403
        ? 'PROVIDER_AUTH_FAILED'
        : `PROVIDER_HTTP_${statusCode}`;
    this.safeMessage = `Provider request failed with HTTP ${statusCode}${requestId ? ` (request ${requestId.slice(0, 100)})` : ''}`;
  }
}

function defaultBaseUrl(type: string): string {
  if (type === 'OLLAMA') return 'http://localhost:11434/v1';
  return 'https://api.openai.com/v1';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function assertBodySize(body: string): void {
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    throw new Error('Provider request exceeded the size limit');
  }
}

async function readJsonLimited<T>(response: Response, limit = 5_000_000): Promise<T> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > limit) throw new Error('Provider response exceeded the size limit');
  if (!response.body) throw new Error('Provider returned an empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Provider response exceeded the size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Provider returned invalid JSON');
  }
}
