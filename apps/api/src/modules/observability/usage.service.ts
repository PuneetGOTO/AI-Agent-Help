import { BadRequestException, Injectable } from '@nestjs/common';
import { RunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import type { UsageQueryDto } from './dto/query.dto';

interface Bucket {
  name: string;
  tokens: number;
  costUsd: number;
  requests: Set<string>;
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(tenant: TenantContext, query: UsageQueryDto) {
    const workspaceId = workspace(tenant);
    const days = Number(query.period.slice(0, -1));
    const from = new Date(Date.now() - (days - 1) * 86_400_000);
    from.setUTCHours(0, 0, 0, 0);
    const [workspaceRow, records, runs] = await Promise.all([
      this.prisma.workspace.findFirstOrThrow({
        where: { id: workspaceId, organizationId: tenant.organizationId },
      }),
      this.prisma.usageRecord.findMany({
        where: { workspaceId, createdAt: { gte: from } },
        include: {
          agentRun: {
            include: { agentVersion: { include: { agent: { select: { id: true, name: true } } } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.agentRun.findMany({
        where: { workspaceId, createdAt: { gte: from } },
        select: { id: true, status: true, latencyMs: true },
      }),
    ]);
    const byDate = new Map<string, Bucket>();
    const byModel = new Map<string, Bucket>();
    const byAgent = new Map<string, Bucket>();
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    for (const record of records) {
      inputTokens += record.inputTokens;
      outputTokens += record.outputTokens;
      totalTokens += record.totalTokens;
      totalCostUsd += record.costUsd.toNumber();
      const runKey = record.agentRunId ?? record.id;
      addBucket(byDate, record.createdAt.toISOString().slice(0, 10), record, runKey);
      addBucket(byModel, record.model, record, runKey);
      addBucket(
        byAgent,
        record.agentRun?.agentVersion.agent.name ?? 'Unknown Agent',
        record,
        runKey,
      );
    }
    const series = Array.from({ length: days }, (_, offset) => {
      const date = new Date(from.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      const bucket = byDate.get(date);
      return {
        date,
        tokens: bucket?.tokens ?? 0,
        costUsd: bucket?.costUsd ?? 0,
        requests: bucket?.requests.size ?? 0,
      };
    });
    const latencyValues = runs.flatMap(({ latencyMs }) => (latencyMs === null ? [] : [latencyMs]));
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      totalCostUsd,
      requestCount: new Set(runs.map(({ id }) => id)).size,
      errorCount: runs.filter(({ status }) => status === RunStatus.FAILED).length,
      averageLatencyMs: latencyValues.length
        ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
        : 0,
      budgetUsd: workspaceRow.monthlyBudgetUsd?.toNumber() ?? null,
      series,
      byModel: buckets(byModel),
      byAgent: buckets(byAgent),
    };
  }
}

function addBucket(
  map: Map<string, Bucket>,
  name: string,
  record: { totalTokens: number; costUsd: { toNumber(): number } },
  requestId: string,
): void {
  const bucket = map.get(name) ?? { name, tokens: 0, costUsd: 0, requests: new Set<string>() };
  bucket.tokens += record.totalTokens;
  bucket.costUsd += record.costUsd.toNumber();
  bucket.requests.add(requestId);
  map.set(name, bucket);
}

function buckets(map: Map<string, Bucket>) {
  return [...map.values()]
    .sort((left, right) => right.costUsd - left.costUsd || right.tokens - left.tokens)
    .map((bucket) => ({
      name: bucket.name,
      tokens: bucket.tokens,
      costUsd: bucket.costUsd,
      requests: bucket.requests.size,
    }));
}

function workspace(tenant: TenantContext): string {
  if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
  return tenant.workspaceId;
}
