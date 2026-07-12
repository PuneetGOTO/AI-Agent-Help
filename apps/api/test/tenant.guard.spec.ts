import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { TenantGuard } from '../src/common/tenancy/tenant.guard';
import type { PrismaService } from '../src/common/prisma/prisma.service';

const organizationId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';

describe('TenantGuard', () => {
  function context(
    headers: Record<string, string>,
    extra: Record<string, unknown> = {},
  ): ExecutionContext {
    const request = {
      headers,
      user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
      ...extra,
    };
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function reflector(scope: 'workspace' | 'organization' | 'none' = 'workspace'): Reflector {
    return {
      getAllAndOverride: jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(scope),
    } as unknown as Reflector;
  }

  it('binds a workspace only when it belongs to the verified organization membership', async () => {
    const workspaceFindFirst = jest.fn().mockResolvedValue({ id: workspaceId });
    const prisma = {
      organizationMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          organizationId,
          roleId: 'role-1',
          role: { name: 'OWNER', permissions: [{ permission: { key: 'agent:read' } }] },
        }),
      },
      workspace: { findFirst: workspaceFindFirst },
    } as unknown as PrismaService;
    const guard = new TenantGuard(reflector(), prisma);

    await expect(
      guard.canActivate(
        context({ 'x-organization-id': organizationId, 'x-workspace-id': workspaceId }),
      ),
    ).resolves.toBe(true);
    expect(workspaceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId, id: workspaceId } }),
    );
  });

  it('fails closed when a workspace is outside the selected organization', async () => {
    const prisma = {
      organizationMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          organizationId,
          roleId: 'role-1',
          role: { name: 'VIEWER', permissions: [] },
        }),
      },
      workspace: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const guard = new TenantGuard(reflector(), prisma);

    await expect(
      guard.canActivate(
        context({ 'x-organization-id': organizationId, 'x-workspace-id': workspaceId }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects malformed tenant identifiers before a database query', async () => {
    const membershipFindFirst = jest.fn();
    const prisma = {
      organizationMembership: { findFirst: membershipFindFirst },
      workspace: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const guard = new TenantGuard(reflector(), prisma);

    await expect(
      guard.canActivate(
        context({ 'x-organization-id': 'not-a-uuid', 'x-workspace-id': workspaceId }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it('rejects API keys on session-only routes', async () => {
    const guard = new TenantGuard(reflector('none'), {} as PrismaService);

    await expect(
      guard.canActivate(
        context({}, { apiKey: { id: 'key-1', organizationId, workspaceId, scopes: [] } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
