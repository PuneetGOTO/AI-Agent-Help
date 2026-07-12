import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyType } from '@prisma/client';
import { PERMISSIONS, type Permission } from '@agent-platform/shared';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import type { CreateApiKeyDto } from './dto/api-key.dto';

export interface ApiKeyPrincipal {
  id: string;
  workspaceId: string;
  organizationId: string;
  agentId?: string;
  scopes: string[];
  createdBy: AuthUser;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async list(tenant: TenantContext) {
    const workspaceId = requiredWorkspace(tenant);
    const rows = await this.prisma.apiKey.findMany({
      where: { workspaceId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        agent: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      type: row.type,
      scopes: row.scopes,
      agent: row.agent,
      createdBy: row.createdBy,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }));
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async create(tenant: TenantContext, user: AuthUser, dto: CreateApiKeyDto) {
    const workspaceId = requiredWorkspace(tenant);
    const type = dto.type ?? ApiKeyType.PLATFORM;
    if (type === ApiKeyType.AGENT && !dto.agentId) {
      throw new BadRequestException('agentId is required for an Agent API key');
    }
    if (dto.agentId) {
      const agent = await this.prisma.agent.findFirst({
        where: {
          id: dto.agentId,
          workspaceId,
          deletedAt: null,
          publishedVersionId: { not: null },
        },
        select: { id: true },
      });
      if (!agent) {
        throw new BadRequestException('Agent is missing, unpublished, or outside the workspace');
      }
    }
    const scopes = this.scopes(type, dto.scopes);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date())
      throw new BadRequestException('expiresAt must be in the future');
    const secret = this.crypto.createOpaqueToken(36);
    const prefix = secret.slice(0, 10);
    const token = `eap_${prefix}_${secret}`;
    const row = await this.prisma.apiKey.create({
      data: {
        workspaceId,
        agentId: dto.agentId,
        createdById: user.id,
        name: dto.name.trim(),
        prefix: `eap_${prefix}`,
        keyHash: this.crypto.hashToken(token),
        type,
        scopes,
        expiresAt,
      },
    });
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      type: row.type,
      scopes: row.scopes,
      agentId: row.agentId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      token,
    };
  }

  async revoke(tenant: TenantContext, id: string): Promise<void> {
    const result = await this.prisma.apiKey.updateMany({
      where: { id, workspaceId: requiredWorkspace(tenant), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Active API key not found');
  }

  async authenticate(token: string): Promise<ApiKeyPrincipal> {
    if (!/^eap_[A-Za-z0-9_-]{10}_[A-Za-z0-9_-]{30,}$/.test(token)) {
      throw new UnauthorizedException('API key is invalid');
    }
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.crypto.hashToken(token) },
      include: {
        workspace: { select: { organizationId: true } },
        createdBy: { select: { id: true, name: true, email: true, isActive: true } },
      },
    });
    if (
      !row ||
      row.revokedAt ||
      (row.expiresAt && row.expiresAt <= new Date()) ||
      !row.createdBy.isActive
    ) {
      throw new UnauthorizedException('API key is invalid or expired');
    }
    await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      organizationId: row.workspace.organizationId,
      agentId: row.agentId ?? undefined,
      scopes: row.scopes,
      createdBy: { id: row.createdBy.id, name: row.createdBy.name, email: row.createdBy.email },
    };
  }

  private scopes(type: ApiKeyType, requested?: string[]): Permission[] {
    const defaults =
      type === ApiKeyType.AGENT
        ? [PERMISSIONS.AGENT_RUN]
        : [PERMISSIONS.WORKSPACE_READ, PERMISSIONS.AGENT_READ, PERMISSIONS.AGENT_RUN];
    const scopes = [...new Set(requested?.length ? requested : defaults)];
    const allowed = new Set<string>(
      type === ApiKeyType.AGENT
        ? [PERMISSIONS.AGENT_RUN]
        : [
            PERMISSIONS.WORKSPACE_READ,
            PERMISSIONS.PROVIDER_READ,
            PERMISSIONS.AGENT_READ,
            PERMISSIONS.AGENT_RUN,
            PERMISSIONS.TOOL_READ,
            PERMISSIONS.KNOWLEDGE_READ,
            PERMISSIONS.USAGE_READ,
          ],
    );
    if (scopes.some((scope) => !allowed.has(scope))) {
      throw new BadRequestException('One or more API key scopes are unsupported or unsafe');
    }
    if (type === ApiKeyType.AGENT && scopes.some((scope) => scope !== PERMISSIONS.AGENT_RUN)) {
      throw new BadRequestException('Agent API keys can only use the agent:run scope');
    }
    return scopes as Permission[];
  }
}

function requiredWorkspace(tenant: TenantContext): string {
  if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
  return tenant.workspaceId;
}
