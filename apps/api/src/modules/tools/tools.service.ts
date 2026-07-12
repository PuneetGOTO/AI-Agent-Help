import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import type { CreateToolDto, UpdateToolDto } from './dto/tool.dto';
import { ToolExecutorService } from './tool-executor.service';
import { safeToolView } from './tool-view';

@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: ToolExecutorService,
  ) {}

  async list(tenant: TenantContext) {
    const items = await this.prisma.tool.findMany({
      where: { workspaceId: workspace(tenant) },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: items.map(safeToolView),
      total: items.length,
      page: 1,
      pageSize: items.length,
    };
  }

  async create(tenant: TenantContext, dto: CreateToolDto) {
    this.executor.validateDefinition(dto.type, dto.inputSchema, dto.config);
    try {
      const tool = await this.prisma.tool.create({
        data: {
          workspaceId: workspace(tenant),
          name: dto.name.trim(),
          slug: uniqueSlug(dto.name),
          description: dto.description.trim(),
          type: dto.type,
          inputSchema: dto.inputSchema as Prisma.InputJsonValue,
          config: dto.config as Prisma.InputJsonValue,
          requiresApproval: dto.requiresApproval,
          timeoutMs: dto.timeoutMs,
          retryCount: dto.retryCount,
        },
      });
      return safeToolView(tool);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Tool identifier already exists; retry the request');
      }
      throw error;
    }
  }

  async update(tenant: TenantContext, id: string, dto: UpdateToolDto) {
    const current = await this.find(tenant, id);
    const pendingApprovals = await this.prisma.toolExecution.count({
      where: { toolId: current.id, status: 'WAITING_APPROVAL' },
    });
    if (pendingApprovals) {
      throw new BadRequestException('Tool cannot change while an approval request is pending');
    }
    if (changesExecutionPolicy(dto)) {
      const publishedReferences = await this.prisma.agentVersionTool.count({
        where: {
          toolId: current.id,
          agentVersion: { status: { not: 'DRAFT' } },
        },
      });
      if (publishedReferences) {
        throw new ConflictException(
          'Published agent versions use this tool; create a new tool before changing execution policy',
        );
      }
    }
    this.executor.validateDefinition(
      current.type,
      dto.inputSchema ?? (current.inputSchema as Record<string, unknown>),
      dto.config ?? (current.config as Record<string, unknown>),
    );
    const tool = await this.prisma.tool.update({
      where: { id: current.id },
      data: {
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        inputSchema: dto.inputSchema as Prisma.InputJsonValue | undefined,
        config: dto.config as Prisma.InputJsonValue | undefined,
        requiresApproval: dto.requiresApproval,
        timeoutMs: dto.timeoutMs,
        retryCount: dto.retryCount,
        isEnabled: dto.isEnabled,
      },
    });
    return safeToolView(tool);
  }

  async remove(tenant: TenantContext, id: string): Promise<void> {
    const current = await this.find(tenant, id);
    const used = await this.prisma.agentVersionTool.count({ where: { toolId: current.id } });
    if (used) throw new BadRequestException('Tool is referenced by agent versions');
    await this.prisma.tool.delete({ where: { id: current.id } });
  }

  async find(tenant: TenantContext, id: string) {
    const tool = await this.prisma.tool.findFirst({
      where: { id, workspaceId: workspace(tenant) },
    });
    if (!tool) throw new NotFoundException('Tool not found');
    return tool;
  }
}

function changesExecutionPolicy(dto: UpdateToolDto): boolean {
  return (
    dto.inputSchema !== undefined ||
    dto.config !== undefined ||
    dto.description !== undefined ||
    dto.requiresApproval !== undefined ||
    dto.timeoutMs !== undefined ||
    dto.retryCount !== undefined
  );
}

function workspace(tenant: TenantContext): string {
  if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
  return tenant.workspaceId;
}

function uniqueSlug(value: string): string {
  const base =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'tool';
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
