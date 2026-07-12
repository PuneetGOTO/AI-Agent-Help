import type { ProviderCapabilities, ProviderType } from '@agent-platform/shared';

export interface ProviderCredentials {
  apiKey?: string;
  organization?: string;
  azureApiVersion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  project?: string;
  projectId?: string;
  location?: string;
  apiVersion?: string;
  [key: string]: unknown;
}

export interface ProviderRuntimeConfig {
  id: string;
  type: ProviderType;
  baseUrl?: string | null;
  credentials: ProviderCredentials;
  config?: Record<string, unknown> | null;
  /** Set only by the server after an exact deployment allowlist match. */
  allowPrivateNetwork?: boolean;
  /** Set only by the server after an exact Bedrock endpoint allowlist match. */
  allowCustomAwsEndpoint?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ProviderChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ProviderToolDefinition[];
  responseSchema?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderChatResponse {
  content: string;
  toolCalls: ProviderToolCall[];
  usage: NormalizedUsage;
  model: string;
  finishReason?: string;
}

export type ProviderStreamChunk =
  | { type: 'token'; content: string }
  | { type: 'tool_call'; toolCall: ProviderToolCall }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'done'; finishReason?: string };

export interface EmbeddingRequest {
  model: string;
  input: string[];
  timeoutMs?: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  usage: NormalizedUsage;
}

export interface ProviderModel {
  id: string;
  name: string;
  capabilities?: Partial<ProviderCapabilities>;
}

export interface NormalizedProviderError {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

export interface ProviderAdapter {
  validateCredential(config: ProviderRuntimeConfig): Promise<boolean>;
  listModels(config: ProviderRuntimeConfig): Promise<ProviderModel[]>;
  chat(config: ProviderRuntimeConfig, request: ProviderChatRequest): Promise<ProviderChatResponse>;
  streamChat(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncGenerator<ProviderStreamChunk>;
  embeddings(config: ProviderRuntimeConfig, request: EmbeddingRequest): Promise<EmbeddingResponse>;
  toolCalling(request: ProviderChatRequest, tools: ProviderToolDefinition[]): ProviderChatRequest;
  structuredOutput(
    request: ProviderChatRequest,
    schema: Record<string, unknown>,
  ): ProviderChatRequest;
  normalizeUsage(raw: unknown): NormalizedUsage;
  normalizeError(error: unknown): NormalizedProviderError;
  capabilityDetection(model?: string): ProviderCapabilities;
}
