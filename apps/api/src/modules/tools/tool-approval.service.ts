import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import { ToolExecutorService } from './tool-executor.service';

@Injectable()
export class ToolApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: ToolExecutorService,
  ) {}

  async approve(tenant: TenantContext, user: AuthUser, id: string) {
    const execution = await this.findOwned(tenant, id);
    if (execution.createdAt <= new Date(Date.now() - 15 * 60_000)) {
      await this.prisma.$transaction([
        this.prisma.toolExecution.updateMany({
          where: { id: execution.id, status: RunStatus.WAITING_APPROVAL },
          data: {
            status: RunStatus.CANCELLED,
            errorMessage: 'Approval request expired',
            completedAt: new Date(),
          },
        }),
        this.prisma.agentRun.updateMany({
          where: { id: execution.agentRunId, status: RunStatus.WAITING_APPROVAL },
          data: {
            status: RunStatus.CANCELLED,
            errorCode: 'TOOL_APPROVAL_EXPIRED',
            errorMessage: 'Tool approval request expired',
            completedAt: new Date(),
          },
        }),
      ]);
      throw new BadRequestException('Tool approval request has expired');
    }
    const claimed = await this.prisma.toolExecution.updateMany({
      where: { id: execution.id, status: RunStatus.WAITING_APPROVAL },
      data: { status: RunStatus.RUNNING, approvedById: user.id },
    });
    if (claimed.count !== 1)
      throw new ConflictException('Tool execution is no longer waiting for approval');
    const started = Date.now();
    try {
      const output = await this.executor.execute(
        execution.tool,
        execution.agentRun.workspace,
        execution.input as Record<string, unknown>,
      );
      await this.prisma.$transaction([
        this.prisma.toolExecution.updateMany({
          where: {
            id: execution.id,
            agentRun: { workspaceId: tenant.workspaceId },
            status: RunStatus.RUNNING,
          },
          data: {
            status: RunStatus.SUCCEEDED,
            output: safeJson(output),
            latencyMs: Date.now() - started,
            completedAt: new Date(),
          },
        }),
        this.prisma.agentRun.updateMany({
          where: {
            id: execution.agentRunId,
            workspaceId: tenant.workspaceId,
            status: RunStatus.WAITING_APPROVAL,
          },
          data: {
            status: RunStatus.SUCCEEDED,
            outputPreview: `Approved tool ${execution.tool.name} executed successfully`,
            completedAt: new Date(),
          },
        }),
      ]);
      return { id: execution.id, status: RunStatus.SUCCEEDED, output };
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.toolExecution.updateMany({
          where: {
            id: execution.id,
            agentRun: { workspaceId: tenant.workspaceId },
            status: RunStatus.RUNNING,
          },
          data: {
            status: RunStatus.FAILED,
            errorMessage: 'Approved tool execution failed',
            latencyMs: Date.now() - started,
            completedAt: new Date(),
          },
        }),
        this.prisma.agentRun.updateMany({
          where: {
            id: execution.agentRunId,
            workspaceId: tenant.workspaceId,
            status: RunStatus.WAITING_APPROVAL,
          },
          data: {
            status: RunStatus.FAILED,
            errorCode: 'TOOL_EXECUTION_FAILED',
            errorMessage: 'Approved tool execution failed',
            completedAt: new Date(),
          },
        }),
      ]);
      throw error;
    }
  }

  async reject(tenant: TenantContext, user: AuthUser, id: string, reason?: string) {
    const execution = await this.findOwned(tenant, id);
    const rejected = await this.prisma.toolExecution.updateMany({
      where: { id: execution.id, status: RunStatus.WAITING_APPROVAL },
      data: {
        status: RunStatus.CANCELLED,
        approvedById: user.id,
        errorMessage: reason?.trim() || 'Rejected by operator',
        completedAt: new Date(),
      },
    });
    if (rejected.count !== 1)
      throw new ConflictException('Tool execution is no longer waiting for approval');
    await this.prisma.agentRun.updateMany({
      where: {
        id: execution.agentRunId,
        workspaceId: tenant.workspaceId,
        status: RunStatus.WAITING_APPROVAL,
      },
      data: {
        status: RunStatus.CANCELLED,
        errorCode: 'TOOL_REJECTED',
        errorMessage: 'Tool execution rejected by operator',
        completedAt: new Date(),
      },
    });
    return { id: execution.id, status: RunStatus.CANCELLED };
  }

  private async findOwned(tenant: TenantContext, id: string) {
    if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
    const execution = await this.prisma.toolExecution.findFirst({
      where: { id, agentRun: { workspaceId: tenant.workspaceId } },
      include: { tool: true, agentRun: { include: { workspace: true } } },
    });
    if (!execution) throw new NotFoundException('Tool execution not found');
    return execution;
  }
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
