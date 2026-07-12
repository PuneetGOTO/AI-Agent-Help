export const PROVIDER_TYPES = [
  'OPENAI',
  'AZURE_OPENAI',
  'ANTHROPIC',
  'GOOGLE_GEMINI',
  'AWS_BEDROCK',
  'OLLAMA',
  'OPENAI_COMPATIBLE',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  embeddings: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  vision: boolean;
  modelListing: boolean;
}

export const PERMISSIONS = {
  WORKSPACE_READ: 'workspace:read',
  WORKSPACE_UPDATE: 'workspace:update',
  MEMBER_READ: 'member:read',
  MEMBER_MANAGE: 'member:manage',
  PROVIDER_READ: 'provider:read',
  PROVIDER_MANAGE: 'provider:manage',
  AGENT_READ: 'agent:read',
  AGENT_WRITE: 'agent:write',
  AGENT_PUBLISH: 'agent:publish',
  AGENT_RUN: 'agent:run',
  AGENT_DEBUG: 'agent:debug',
  TOOL_READ: 'tool:read',
  TOOL_MANAGE: 'tool:manage',
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_MANAGE: 'knowledge:manage',
  USAGE_READ: 'usage:read',
  AUDIT_READ: 'audit:read',
  API_KEY_MANAGE: 'api-key:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PRESET_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: Object.values(PERMISSIONS),
  ADMIN: Object.values(PERMISSIONS).filter(
    (permission) => permission !== PERMISSIONS.WORKSPACE_UPDATE,
  ),
  DEVELOPER: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.PROVIDER_READ,
    PERMISSIONS.AGENT_READ,
    PERMISSIONS.AGENT_WRITE,
    PERMISSIONS.AGENT_PUBLISH,
    PERMISSIONS.AGENT_RUN,
    PERMISSIONS.AGENT_DEBUG,
    PERMISSIONS.TOOL_READ,
    PERMISSIONS.TOOL_MANAGE,
    PERMISSIONS.KNOWLEDGE_READ,
    PERMISSIONS.KNOWLEDGE_MANAGE,
    PERMISSIONS.USAGE_READ,
  ],
  OPERATOR: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.PROVIDER_READ,
    PERMISSIONS.AGENT_READ,
    PERMISSIONS.AGENT_RUN,
    PERMISSIONS.TOOL_READ,
    PERMISSIONS.USAGE_READ,
  ],
  VIEWER: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.PROVIDER_READ,
    PERMISSIONS.AGENT_READ,
    PERMISSIONS.TOOL_READ,
    PERMISSIONS.KNOWLEDGE_READ,
    PERMISSIONS.USAGE_READ,
  ],
};

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  path?: string;
  requestId?: string;
  timestamp: string;
}

export interface StreamEvent<T = unknown> {
  type: 'meta' | 'token' | 'tool_call' | 'usage' | 'done' | 'error';
  data: T;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}
