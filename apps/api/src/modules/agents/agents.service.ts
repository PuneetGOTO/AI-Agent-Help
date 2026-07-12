import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentStatus, AgentVersionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import { ProvidersService } from '../providers/providers.service';
import type { CreateAgentDto, CreateAgentVersionDto, UpdateAgentDto } from './dto/agent.dto';
import { safeToolView } from '../tools/tool-view';

const VERSION_INCLUDE = {
  providerConnection: { select: { id: true, name: true, type: true } },
  tools: { include: { tool: true } },
  knowledgeBases: { include: { knowledgeBase: true } },
} satisfies Prisma.AgentVersionInclude;

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  async list(tenant: TenantContext) {
    const workspaceId = workspace(tenant);
    const items = await this.prisma.agent.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        publishedVersion: { include: VERSION_INCLUDE },
        versions: { orderBy: { version: 'desc' }, take: 1, include: VERSION_INCLUDE },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: items.map((agent) => this.serialize(agent)),
      total: items.length,
      page: 1,
      pageSize: items.length,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const agent = await this.findWithVersions(workspace(tenant), id);
    return this.serialize(agent);
  }

  async create(tenant: TenantContext, user: AuthUser, dto: CreateAgentDto) {
    const workspaceId = workspace(tenant);
    assertSupportedMemoryMode(dto.memoryMode);
    await this.providers.runtimeForWorkspace(workspaceId, dto.providerConnectionId);
    await this.validateTools(workspaceId, dto.toolIds ?? []);
    await this.validateKnowledgeBases(workspaceId, dto.knowledgeBaseIds ?? []);
    const agent = await this.prisma.agent.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        slug: uniqueSlug(dto.name),
        description: dto.description?.trim(),
        icon: dto.icon,
        tags: dto.tags ?? [],
        createdById: user.id,
        versions: {
          create: {
            version: 1,
            providerConnectionId: dto.providerConnectionId,
            model: dto.model.trim(),
            systemPrompt: dto.systemPrompt,
            temperature: dto.temperature,
            maxTokens: dto.maxTokens,
            timeoutMs: dto.timeoutMs,
            retryCount: dto.retryCount,
            streamEnabled: dto.streamEnabled,
            structuredOutputSchema: dto.structuredOutputSchema as Prisma.InputJsonValue | undefined,
            memoryMode: dto.memoryMode,
            budgetUsd: dto.budgetUsd,
            createdById: user.id,
            tools: { create: (dto.toolIds ?? []).map((toolId) => ({ toolId })) },
            knowledgeBases: {
              create: (dto.knowledgeBaseIds ?? []).map((knowledgeBaseId) => ({
                knowledgeBaseId,
              })),
            },
          },
        },
      },
    });
    return this.get(tenant, agent.id);
  }

  async update(tenant: TenantContext, id: string, dto: UpdateAgentDto) {
    const current = await this.findOwned(workspace(tenant), id);
    if (dto.status === AgentStatus.PUBLISHED && !current.publishedVersionId) {
      throw new BadRequestException('Publish a version before setting PUBLISHED status');
    }
    await this.prisma.agent.update({
      where: { id: current.id },
      data: {
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        icon: dto.icon,
        tags: dto.tags,
        status: dto.status,
      },
    });
    return this.get(tenant, id);
  }

  async remove(tenant: TenantContext, id: string): Promise<void> {
    const agent = await this.findOwned(workspace(tenant), id);
    await this.prisma.agent.update({
      where: { id: agent.id },
      data: { deletedAt: new Date(), status: AgentStatus.ARCHIVED },
    });
  }

  async versions(tenant: TenantContext, id: string) {
    const agent = await this.findOwned(workspace(tenant), id);
    const items = await this.prisma.agentVersion.findMany({
      where: { agentId: agent.id },
      include: VERSION_INCLUDE,
      orderBy: { version: 'desc' },
    });
    return {
      items: items.map(serializeVersion),
      total: items.length,
      page: 1,
      pageSize: items.length,
    };
  }

  async createVersion(
    tenant: TenantContext,
    user: AuthUser,
    id: string,
    dto: CreateAgentVersionDto,
  ) {
    const workspaceId = workspace(tenant);
    const agent = await this.findOwned(workspaceId, id);
    const latest = await this.prisma.agentVersion.findFirst({
      where: { agentId: agent.id },
      orderBy: { version: 'desc' },
      include: { tools: true, knowledgeBases: true },
    });
    if (!latest) throw new NotFoundException('Agent has no base version');
    assertSupportedMemoryMode(dto.memoryMode ?? latest.memoryMode);
    const providerConnectionId = dto.providerConnectionId ?? latest.providerConnectionId;
    const toolIds = dto.toolIds ?? latest.tools.map(({ toolId }) => toolId);
    const knowledgeBaseIds =
      dto.knowledgeBaseIds ?? latest.knowledgeBases.map(({ knowledgeBaseId }) => knowledgeBaseId);
    await this.providers.runtimeForWorkspace(workspaceId, providerConnectionId);
    await this.validateTools(workspaceId, toolIds);
    await this.validateKnowledgeBases(workspaceId, knowledgeBaseIds);
    try {
      const created = await this.prisma.$transaction(
        async (transaction) =>
          transaction.agentVersion.create({
            data: {
              agentId: agent.id,
              version: latest.version + 1,
              providerConnectionId,
              model: dto.model ?? latest.model,
              systemPrompt: dto.systemPrompt ?? latest.systemPrompt,
              temperature: dto.temperature ?? latest.temperature,
              maxTokens: dto.maxTokens ?? latest.maxTokens,
              timeoutMs: dto.timeoutMs ?? latest.timeoutMs,
              retryCount: dto.retryCount ?? latest.retryCount,
              streamEnabled: dto.streamEnabled ?? latest.streamEnabled,
              structuredOutputSchema:
                (dto.structuredOutputSchema as Prisma.InputJsonValue | undefined) ??
                (latest.structuredOutputSchema as Prisma.InputJsonValue | undefined),
              memoryMode: dto.memoryMode ?? latest.memoryMode,
              budgetUsd: dto.budgetUsd ?? latest.budgetUsd,
              changeNote: dto.changeNote,
              createdById: user.id,
              tools: { create: toolIds.map((toolId) => ({ toolId })) },
              knowledgeBases: {
                create: knowledgeBaseIds.map((knowledgeBaseId) => ({ knowledgeBaseId })),
              },
            },
            include: VERSION_INCLUDE,
          }),
        { isolationLevel: 'Serializable' },
      );
      return serializeVersion(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another version was created concurrently; retry the request');
      }
      throw error;
    }
  }

  async publish(tenant: TenantContext, id: string, versionId?: string) {
    const workspaceId = workspace(tenant);
    const agent = await this.findOwned(workspaceId, id);
    const target = await this.prisma.agentVersion.findFirst({
      where: { agentId: agent.id, ...(versionId ? { id: versionId } : {}) },
      orderBy: { version: 'desc' },
    });
    if (!target) throw new NotFoundException('Agent version not found');
    await this.activateVersion(agent.id, target.id);
    return this.get(tenant, id);
  }

  async rollback(tenant: TenantContext, id: string, versionId: string) {
    const agent = await this.findOwned(workspace(tenant), id);
    const target = await this.prisma.agentVersion.findFirst({
      where: { id: versionId, agentId: agent.id },
    });
    if (!target) throw new NotFoundException('Agent version not found');
    await this.activateVersion(agent.id, target.id);
    return this.get(tenant, id);
  }

  async duplicate(tenant: TenantContext, user: AuthUser, id: string) {
    const original = await this.findWithVersions(workspace(tenant), id);
    const latest = original.versions[0];
    if (!latest) throw new NotFoundException('Agent version not found');
    return this.create(tenant, user, {
      name: `${original.name} Copy`,
      description: original.description ?? undefined,
      icon: original.icon ?? undefined,
      tags: original.tags,
      providerConnectionId: latest.providerConnectionId,
      model: latest.model,
      systemPrompt: latest.systemPrompt,
      temperature: latest.temperature,
      maxTokens: latest.maxTokens,
      timeoutMs: latest.timeoutMs,
      retryCount: latest.retryCount,
      streamEnabled: latest.streamEnabled,
      structuredOutputSchema: latest.structuredOutputSchema as Record<string, unknown> | undefined,
      memoryMode: latest.memoryMode,
      budgetUsd: latest.budgetUsd?.toNumber(),
      toolIds: latest.tools.map(({ toolId }) => toolId),
      knowledgeBaseIds: latest.knowledgeBases.map(({ knowledgeBaseId }) => knowledgeBaseId),
    });
  }

  async executable(workspaceId: string, id: string, useDraft = false) {
    const agent = await this.findWithVersions(workspaceId, id);
    if (agent.status === AgentStatus.ARCHIVED) throw new NotFoundException('Agent is archived');
    if (!useDraft && agent.status !== AgentStatus.PUBLISHED) {
      throw new NotFoundException('Agent is not published');
    }
    const version = useDraft ? agent.versions[0] : agent.publishedVersion;
    if (!version) throw new NotFoundException('Agent has no executable version');
    assertSupportedMemoryMode(version.memoryMode);
    return { agent, version };
  }

  private async activateVersion(agentId: string, versionId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.agentVersion.updateMany({
        where: { agentId, status: AgentVersionStatus.PUBLISHED, id: { not: versionId } },
        data: { status: AgentVersionStatus.RETIRED },
      }),
      this.prisma.agentVersion.update({
        where: { id: versionId },
        data: { status: AgentVersionStatus.PUBLISHED, publishedAt: new Date() },
      }),
      this.prisma.agent.update({
        where: { id: agentId },
        data: { publishedVersionId: versionId, status: AgentStatus.PUBLISHED },
      }),
    ]);
  }

  private async findOwned(workspaceId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, workspaceId, deletedAt: null },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  private async findWithVersions(workspaceId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: {
        publishedVersion: { include: VERSION_INCLUDE },
        versions: { orderBy: { version: 'desc' }, include: VERSION_INCLUDE },
      },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  private async validateTools(workspaceId: string, toolIds: string[]): Promise<void> {
    const unique = [...new Set(toolIds)];
    if (unique.length !== toolIds.length) throw new BadRequestException('toolIds must be unique');
    if (!unique.length) return;
    const count = await this.prisma.tool.count({
      where: { id: { in: unique }, workspaceId, isEnabled: true },
    });
    if (count !== unique.length)
      throw new BadRequestException(
        'One or more tools are missing, disabled, or outside the workspace',
      );
  }

  private async validateKnowledgeBases(
    workspaceId: string,
    knowledgeBaseIds: string[],
  ): Promise<void> {
    const unique = [...new Set(knowledgeBaseIds)];
    if (unique.length !== knowledgeBaseIds.length) {
      throw new BadRequestException('knowledgeBaseIds must be unique');
    }
    if (!unique.length) return;
    const count = await this.prisma.knowledgeBase.count({
      where: { id: { in: unique }, workspaceId },
    });
    if (count !== unique.length) {
      throw new BadRequestException('One or more knowledge bases are outside the workspace');
    }
  }

  private serialize(agent: Awaited<ReturnType<AgentsService['findWithVersions']>>) {
    return {
      id: agent.id,
      workspaceId: agent.workspaceId,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      icon: agent.icon,
      tags: agent.tags,
      status: agent.status,
      currentVersion: agent.versions[0] ? serializeVersion(agent.versions[0]) : null,
      publishedVersion: agent.publishedVersion ? serializeVersion(agent.publishedVersion) : null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }
}

function serializeVersion(
  version: Prisma.AgentVersionGetPayload<{ include: typeof VERSION_INCLUDE }>,
) {
  return {
    ...version,
    budgetUsd: version.budgetUsd?.toString() ?? null,
    toolIds: version.tools.map(({ toolId }) => toolId),
    tools: version.tools.map(({ tool }) => safeToolView(tool)),
    knowledgeBaseIds: version.knowledgeBases.map(({ knowledgeBaseId }) => knowledgeBaseId),
    knowledgeBases: version.knowledgeBases.map(({ knowledgeBase }) => knowledgeBase),
  };
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
      .slice(0, 40) || 'agent';
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertSupportedMemoryMode(mode: string | undefined): void {
  if (mode === 'LONG_TERM') {
    throw new BadRequestException(
      'Long-term memory is not available until consent and deletion controls are configured',
    );
  }
}
