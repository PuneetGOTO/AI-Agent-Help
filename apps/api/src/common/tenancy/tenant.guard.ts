import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { TENANT_SCOPE_KEY } from './tenant-scope.decorator';
import type { AuthUser, TenantScope } from './tenancy.types';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const scope =
      this.reflector.getAllAndOverride<TenantScope>(TENANT_SCOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'workspace';
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (scope === 'none') {
      if (request.apiKey) {
        throw new ForbiddenException('API keys cannot access session-only endpoints');
      }
      return true;
    }

    if (!request.user) return false;
    const explicitOrganizationId = header(request, 'x-organization-id');
    const explicitWorkspaceId = header(request, 'x-workspace-id');
    const apiKey = request.apiKey;
    if (apiKey && explicitOrganizationId && explicitOrganizationId !== apiKey.organizationId) {
      throw new ForbiddenException('API key cannot select another organization');
    }
    if (apiKey && explicitWorkspaceId && explicitWorkspaceId !== apiKey.workspaceId) {
      throw new ForbiddenException('API key cannot select another workspace');
    }
    const requestedOrganizationId = explicitOrganizationId ?? apiKey?.organizationId;
    const requestedWorkspaceId = explicitWorkspaceId ?? apiKey?.workspaceId;
    if (!requestedOrganizationId || !isUUID(requestedOrganizationId)) {
      throw new BadRequestException('X-Organization-Id must be a valid UUID');
    }
    if (scope === 'workspace' && (!requestedWorkspaceId || !isUUID(requestedWorkspaceId))) {
      throw new BadRequestException('X-Workspace-Id must be a valid UUID');
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId: request.user.id,
        organizationId: requestedOrganizationId,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
      },
    });
    if (!membership) throw new ForbiddenException('You do not belong to this organization');

    let workspaceId: string | undefined;
    if (scope === 'workspace') {
      const workspace = await this.prisma.workspace.findFirst({
        where: {
          organizationId: membership.organizationId,
          id: requestedWorkspaceId,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!workspace)
        throw new ForbiddenException('Workspace is outside the selected organization');
      workspaceId = workspace.id;
    }

    const rolePermissions = membership.role.permissions.map(({ permission }) => permission.key);
    request.tenant = {
      organizationId: membership.organizationId,
      workspaceId,
      membershipId: membership.id,
      roleId: membership.roleId,
      roleName: membership.role.name,
      permissions: apiKey
        ? rolePermissions.filter((permission) => apiKey.scopes.includes(permission))
        : rolePermissions,
      apiKeyId: apiKey?.id,
      apiKeyAgentId: apiKey?.agentId,
    };
    return true;
  }
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
