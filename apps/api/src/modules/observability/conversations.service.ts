import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import type { PageQueryDto } from './dto/query.dto';

const RUN_INCLUDE = {
  agentVersion: { include: { agent: { select: { id: true, name: true, icon: true } } } },
  providerConnection: { select: { id: true, name: true, type: true } },
  usageRecords: true,
  toolExecutions: { include: { tool: { select: { id: true, name: true, type: true } } } },
} satisfies Prisma.AgentRunInclude;

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async conversations(tenant: TenantContext, query: PageQueryDto) {
    const workspaceId = workspace(tenant);
    const where = { workspaceId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, icon: true } },
          _count: { select: { messages: true } },
          messages: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          runs: { include: { usageRecords: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items = rows.map((row) => {
      const usage = row.runs.flatMap(({ usageRecords }) => usageRecords);
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        title: row.title,
        agent: row.agent,
        messageCount: row._count.messages,
        totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
        totalCostUsd: usage.reduce((sum, item) => sum + item.costUsd.toNumber(), 0),
        lastMessageAt: row.messages[0]?.createdAt ?? row.updatedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async conversation(tenant: TenantContext, id: string) {
    const row = await this.prisma.conversation.findFirst({
      where: { id, workspaceId: workspace(tenant) },
      include: {
        agent: { select: { id: true, name: true, icon: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        runs: { include: RUN_INCLUDE, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return {
      ...row,
      runs: row.runs.map(serializeRun),
    };
  }

  async runs(tenant: TenantContext, query: PageQueryDto) {
    const workspaceId = workspace(tenant);
    const where = { workspaceId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.agentRun.count({ where }),
      this.prisma.agentRun.findMany({
        where,
        include: RUN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(serializeRun),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async run(tenant: TenantContext, id: string) {
    const row = await this.prisma.agentRun.findFirst({
      where: { id, workspaceId: workspace(tenant) },
      include: RUN_INCLUDE,
    });
    if (!row) throw new NotFoundException('Run not found');
    return serializeRun(row);
  }
}

function serializeRun(run: Prisma.AgentRunGetPayload<{ include: typeof RUN_INCLUDE }>) {
  const inputTokens = run.usageRecords.reduce((sum, item) => sum + item.inputTokens, 0);
  const outputTokens = run.usageRecords.reduce((sum, item) => sum + item.outputTokens, 0);
  const totalTokens = run.usageRecords.reduce((sum, item) => sum + item.totalTokens, 0);
  const costUsd = run.usageRecords.reduce((sum, item) => sum + item.costUsd.toNumber(), 0);
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    conversationId: run.conversationId,
    agentId: run.agentVersion.agent.id,
    agent: run.agentVersion.agent,
    agentVersionId: run.agentVersionId,
    status: run.status,
    model: run.agentVersion.model,
    provider: run.providerConnection.type,
    providerName: run.providerConnection.name,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    latencyMs: run.latencyMs,
    error: run.errorMessage,
    errorCode: run.errorCode,
    inputPreview: run.inputPreview,
    outputPreview: run.outputPreview,
    trace: run.toolExecutions.map((execution) => ({
      id: execution.id,
      type: 'tool_call',
      name: execution.tool.name,
      toolType: execution.tool.type,
      status: execution.status,
      durationMs: execution.latencyMs,
      createdAt: execution.createdAt,
      completedAt: execution.completedAt,
      requiresApproval: execution.status === 'WAITING_APPROVAL' || execution.approvedById !== null,
      canApprove: execution.status === 'WAITING_APPROVAL',
    })),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
  };
}

function workspace(tenant: TenantContext): string {
  if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
  return tenant.workspaceId;
}
