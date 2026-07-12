import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import type { CreateWorkspaceDto, UpdateWorkspaceSettingsDto } from './dto/workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext) {
    const items = await this.prisma.workspace.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return { items: items.map(serialize), total: items.length, page: 1, pageSize: items.length };
  }

  async create(tenant: TenantContext, dto: CreateWorkspaceDto) {
    const name = dto.name.trim();
    const workspace = await this.prisma.workspace.create({
      data: {
        organizationId: tenant.organizationId,
        name,
        slug: await this.uniqueSlug(tenant.organizationId, name),
        description: dto.description?.trim() || null,
      },
    });
    return serialize(workspace);
  }

  async settings(tenant: TenantContext) {
    return serialize(await this.ownedWorkspace(tenant));
  }

  async updateSettings(tenant: TenantContext, dto: UpdateWorkspaceSettingsDto) {
    const current = await this.ownedWorkspace(tenant);
    const updated = await this.prisma.workspace.update({
      where: { id: current.id },
      data: {
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        monthlyBudgetUsd:
          dto.monthlyBudgetUsd === undefined
            ? undefined
            : dto.monthlyBudgetUsd === null
              ? null
              : new Prisma.Decimal(dto.monthlyBudgetUsd),
        rateLimitPerMinute: dto.rateLimitPerMinute,
        concurrentRunLimit: dto.concurrencyLimit,
        retentionDays: dto.dataRetentionDays,
        allowedToolDomains: dto.allowedToolDomains
          ? [...new Set(dto.allowedToolDomains)]
          : undefined,
        piiMaskingEnabled: dto.piiMaskingEnabled,
      },
    });
    return serialize(updated);
  }

  private async ownedWorkspace(tenant: TenantContext) {
    if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: tenant.workspaceId, organizationId: tenant.organizationId },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  private async uniqueSlug(organizationId: string, value: string): Promise<string> {
    const base =
      value
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 50) || 'workspace';
    let candidate = base;
    for (let suffix = 1; suffix < 1000; suffix += 1) {
      const exists = await this.prisma.workspace.findFirst({
        where: { organizationId, slug: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
      candidate = `${base.slice(0, 45)}-${suffix + 1}`;
    }
    throw new BadRequestException('Unable to allocate a unique workspace slug');
  }
}

function serialize(workspace: {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  monthlyBudgetUsd: Prisma.Decimal | null;
  rateLimitPerMinute: number;
  concurrentRunLimit: number;
  retentionDays: number;
  allowedToolDomains: string[];
  piiMaskingEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    monthlyBudgetUsd: workspace.monthlyBudgetUsd?.toNumber() ?? null,
    rateLimitPerMinute: workspace.rateLimitPerMinute,
    concurrencyLimit: workspace.concurrentRunLimit,
    dataRetentionDays: workspace.retentionDays,
    allowedToolDomains: workspace.allowedToolDomains,
    piiMaskingEnabled: workspace.piiMaskingEnabled,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}
