import type { Tool } from '@prisma/client';

export function safeToolView(tool: Tool) {
  return {
    id: tool.id,
    workspaceId: tool.workspaceId,
    name: tool.name,
    slug: tool.slug,
    description: tool.description,
    type: tool.type,
    inputSchema: tool.inputSchema,
    requiresApproval: tool.requiresApproval,
    timeoutMs: tool.timeoutMs,
    retryCount: tool.retryCount,
    isEnabled: tool.isEnabled,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
    hasConfiguration: Object.keys(asObject(tool.config)).length > 0,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
