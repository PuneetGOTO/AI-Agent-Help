export type Id = string;

export interface User {
  id: Id;
  email: string;
  name: string;
  avatarUrl?: string | null;
  createdAt?: string;
}

export interface Organization {
  id: Id;
  name: string;
  slug?: string;
  role?: string;
  permissions?: string[];
  workspaces?: Workspace[];
}

export interface Workspace {
  id: Id;
  organizationId: Id;
  name: string;
  slug?: string;
  role?: string;
  description?: string | null;
  monthlyBudgetUsd?: number | null;
  rateLimitPerMinute?: number;
  concurrencyLimit?: number;
  dataRetentionDays?: number;
  allowedToolDomains?: string[];
  piiMaskingEnabled?: boolean;
}

export interface AuthSession {
  accessToken?: string;
  user: User;
  organizations?: Organization[];
  workspaces?: Workspace[];
  activeOrganizationId?: Id;
  activeWorkspaceId?: Id;
  permissions?: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type AgentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'draft' | 'published' | 'archived';

export interface AgentVersion {
  id: Id;
  version: number;
  versionNumber?: number;
  status?: string;
  providerConnectionId: Id;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retryCount?: number;
  streamEnabled?: boolean;
  structuredOutputSchema?: Record<string, unknown> | null;
  toolIds?: Id[];
  knowledgeBaseIds?: Id[];
  memoryMode?: string;
  budgetUsd?: number | null;
  changeNote?: string | null;
  createdAt?: string;
  createdBy?: Pick<User, 'id' | 'name'>;
}

export interface Agent {
  id: Id;
  name: string;
  description?: string | null;
  icon?: string | null;
  tags?: string[];
  status: AgentStatus;
  currentVersion?: AgentVersion | null;
  publishedVersion?: AgentVersion | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  runCount?: number;
}

export type ProviderType =
  | 'OPENAI'
  | 'AZURE_OPENAI'
  | 'ANTHROPIC'
  | 'GOOGLE_GEMINI'
  | 'AWS_BEDROCK'
  | 'OLLAMA'
  | 'OPENAI_COMPATIBLE';

export interface ProviderConnection {
  id: Id;
  name: string;
  type: ProviderType | string;
  baseUrl?: string | null;
  config?: Record<string, unknown> | null;
  status?: 'ACTIVE' | 'INVALID' | 'UNVERIFIED' | string;
  maskedCredential?: string;
  credentialFingerprint?: string;
  capabilities?: string[] | Record<string, boolean>;
  isEnabled?: boolean;
  lastValidatedAt?: string | null;
  lastValidationError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  contextWindow?: number;
  capabilities?: string[] | Record<string, boolean>;
}

export interface Conversation {
  id: Id;
  title?: string | null;
  agentId: Id;
  agent?: Pick<Agent, 'id' | 'name' | 'icon'>;
  messageCount?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt?: string;
  messages?: ChatMessage[];
  runs?: Run[];
}

export interface ChatMessage {
  id?: Id;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface Run {
  id: Id;
  agentId?: Id;
  conversationId?: Id;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string | null;
  trace?: TraceEvent[];
  startedAt?: string;
  completedAt?: string | null;
  createdAt?: string;
}

export interface TraceEvent {
  id?: Id;
  type: string;
  name?: string;
  status?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  createdAt?: string;
  requiresApproval?: boolean;
  canApprove?: boolean;
}

export interface Tool {
  id: Id;
  name: string;
  description?: string | null;
  type: 'HTTP_REQUEST' | 'WEBHOOK' | 'DATABASE_QUERY' | 'CUSTOM_FUNCTION' | string;
  status?: string;
  requiresApproval?: boolean;
  timeoutMs?: number;
  schema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
  retryCount?: number;
  isEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Member {
  id?: Id;
  membershipId?: Id;
  userId?: Id;
  user?: User;
  name?: string;
  email?: string;
  role?: string | { id: Id; name: string };
  status?: string;
  joinedAt?: string;
  createdAt?: string;
}

export interface Invitation {
  id: Id;
  email: string;
  role?: string | { id: Id; name: string };
  status?: string;
  expiresAt?: string;
  createdAt?: string;
  token?: string;
}

export interface Role {
  id: Id;
  name: string;
  description?: string;
  permissions?: string[];
  system?: boolean;
  memberCount?: number;
}

export interface ApiKey {
  id: Id;
  name: string;
  prefix?: string;
  token?: string;
  type?: 'PLATFORM' | 'AGENT' | string;
  agentId?: Id | null;
  agent?: { id: Id; name: string } | null;
  scopes?: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  revokedAt?: string | null;
}

export interface AuditLog {
  id: Id;
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  actor?: Pick<User, 'id' | 'name' | 'email'> | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSummary {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  requestCount?: number;
  errorCount?: number;
  averageLatencyMs?: number;
  budgetUsd?: number | null;
  series?: UsagePoint[];
  byModel?: UsageBreakdown[];
  byAgent?: UsageBreakdown[];
}

export interface UsagePoint {
  date: string;
  tokens?: number;
  costUsd?: number;
  requests?: number;
}

export interface UsageBreakdown {
  name: string;
  tokens?: number;
  costUsd?: number;
  requests?: number;
}

export interface WorkspaceSettings {
  name?: string;
  dataRetentionDays?: number;
  monthlyBudgetUsd?: number | null;
  concurrencyLimit?: number;
  allowedToolDomains?: string[];
  piiMaskingEnabled?: boolean;
}

export interface KnowledgeDocument {
  id: Id;
  name?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  status?: string;
  chunkCount?: number;
  createdAt?: string;
}

export interface KnowledgeBase {
  id: Id;
  name: string;
  description?: string | null;
  embeddingProviderConnectionId?: Id | null;
  embeddingModel?: string | null;
  documentCount?: number;
  chunkCount?: number;
  documents?: KnowledgeDocument[];
  _count?: { documents?: number };
  createdAt?: string;
  updatedAt?: string;
}

export interface StreamEvent {
  type: 'meta' | 'token' | 'tool_call' | 'usage' | 'done' | 'error' | string;
  data: Record<string, unknown>;
}
