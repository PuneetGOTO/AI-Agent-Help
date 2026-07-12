import { NotImplementedException } from '@nestjs/common';
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
  ProviderToolDefinition,
} from './provider.types';

export class UnsupportedAdapter implements ProviderAdapter {
  constructor(private readonly capabilities: ProviderCapabilities) {}

  validateCredential(config: ProviderRuntimeConfig): Promise<boolean> {
    void config;
    return Promise.reject(this.unsupported());
  }
  listModels(config: ProviderRuntimeConfig): Promise<ProviderModel[]> {
    void config;
    return Promise.reject(this.unsupported());
  }
  chat(config: ProviderRuntimeConfig, request: ProviderChatRequest): Promise<ProviderChatResponse> {
    void config;
    void request;
    return Promise.reject(this.unsupported());
  }
  async *streamChat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncGenerator<ProviderStreamChunk> {
    void config;
    void request;
    yield await Promise.reject<ProviderStreamChunk>(this.unsupported());
  }
  embeddings(config: ProviderRuntimeConfig, request: EmbeddingRequest): Promise<EmbeddingResponse> {
    void config;
    void request;
    return Promise.reject(this.unsupported());
  }
  toolCalling(request: ProviderChatRequest, tools: ProviderToolDefinition[]): ProviderChatRequest {
    if (!this.capabilities.toolCalling) throw this.unsupported('Tool calling');
    return { ...request, tools };
  }
  structuredOutput(
    request: ProviderChatRequest,
    schema: Record<string, unknown>,
  ): ProviderChatRequest {
    if (!this.capabilities.structuredOutput) throw this.unsupported('Structured output');
    return { ...request, responseSchema: schema };
  }
  normalizeUsage(raw: unknown): NormalizedUsage {
    void raw;
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  normalizeError(error: unknown): NormalizedProviderError {
    void error;
    return {
      code: 'PROVIDER_ADAPTER_UNAVAILABLE',
      message: 'Provider adapter is not enabled',
      retryable: false,
    };
  }
  capabilityDetection(): ProviderCapabilities {
    return this.capabilities;
  }
  private unsupported(feature = 'Provider adapter'): NotImplementedException {
    return new NotImplementedException(`${feature} is not available for this provider connection`);
  }
}
