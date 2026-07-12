import type { StreamEvent } from './types';
import { unwrapData } from './utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
const ACCESS_TOKEN_KEY = 'agent-platform.access-token';
const ORGANIZATION_KEY = 'agent-platform.organization-id';
const WORKSPACE_KEY = 'agent-platform.workspace-id';

let memoryToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

function browserStorage() {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function getAccessToken() {
  if (memoryToken) return memoryToken;
  memoryToken = browserStorage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
  return memoryToken;
}

export function setAccessToken(token?: string | null) {
  memoryToken = token ?? null;
  const storage = browserStorage();
  if (!storage) return;
  if (token) storage.setItem(ACCESS_TOKEN_KEY, token);
  else storage.removeItem(ACCESS_TOKEN_KEY);
}

export function setTenantContext(organizationId?: string | null, workspaceId?: string | null) {
  const storage = browserStorage();
  if (!storage) return;
  if (organizationId) storage.setItem(ORGANIZATION_KEY, organizationId);
  else storage.removeItem(ORGANIZATION_KEY);
  if (workspaceId) storage.setItem(WORKSPACE_KEY, workspaceId);
  else storage.removeItem(WORKSPACE_KEY);
}

export function getTenantContext() {
  const storage = browserStorage();
  return {
    organizationId: storage?.getItem(ORGANIZATION_KEY) ?? null,
    workspaceId: storage?.getItem(WORKSPACE_KEY) ?? null,
  };
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return text || undefined;
}

async function toApiError(response: Response) {
  const body = await parseResponse(response).catch(() => undefined);
  const object = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const rawMessage = object?.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.join('；')
    : typeof rawMessage === 'string'
      ? rawMessage
      : typeof body === 'string' && body.length < 300
        ? body
        : `請求失敗 (${response.status})`;
  return new ApiClientError(
    message,
    response.status,
    typeof object?.error === 'string' ? object.error : undefined,
    typeof object?.requestId === 'string'
      ? object.requestId
      : (response.headers.get('x-request-id') ?? undefined),
    object,
  );
}

function buildHeaders(headers?: HeadersInit, body?: BodyInit | null) {
  const result = new Headers(headers);
  if (body && typeof body === 'string' && !result.has('content-type'))
    result.set('content-type', 'application/json');
  result.set('accept', 'application/json');
  const token = getAccessToken();
  if (token) result.set('authorization', `Bearer ${token}`);
  const tenant = getTenantContext();
  if (tenant.organizationId) result.set('x-organization-id', tenant.organizationId);
  if (tenant.workspaceId) result.set('x-workspace-id', tenant.workspaceId);
  return result;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      setAccessToken(null);
      return null;
    }
    const body = unwrapData<{ accessToken?: string }>(await parseResponse(response));
    const token = body?.accessToken ?? null;
    setAccessToken(token);
    return token;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuthRefresh?: boolean;
  rawBody?: BodyInit;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const response = await fetch(url, {
    ...options,
    body,
    credentials: 'include',
    headers: buildHeaders(options.headers, body),
  });

  if (response.status === 401 && !options.skipAuthRefresh && !path.startsWith('/auth/')) {
    const token = await refreshAccessToken();
    if (token) {
      return apiRequest<T>(path, { ...options, skipAuthRefresh: true });
    }
  }

  if (!response.ok) throw await toApiError(response);
  return unwrapData<T>(await parseResponse(response));
}

export async function streamAgentChat(
  agentId: string,
  payload: { message: string; conversationId?: string; debug?: boolean },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const path = `/agents/${encodeURIComponent(agentId)}/chat/stream`;
  let response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(
      { accept: 'text/event-stream', 'content-type': 'application/json' },
      'body',
    ),
    body: JSON.stringify(payload),
    signal,
  });
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(
        { accept: 'text/event-stream', 'content-type': 'application/json' },
        'body',
      ),
      body: JSON.stringify(payload),
      signal,
    });
  }
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiClientError('瀏覽器未收到串流內容', 502);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitBlock = (block: string) => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Providers may emit a raw token as a valid SSE data field.
    }
    const object =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : { content: parsed };
    const type = typeof object.type === 'string' ? object.type : eventName;
    onEvent({ type, data: object });
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(emitBlock);
    if (done) break;
  }
  if (buffer.trim()) emitBlock(buffer);
}
