import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TenantContext } from '../src/common/tenancy/tenancy.types';
import { MembersService } from '../src/modules/members/members.service';

const organizationId = '11111111-1111-4111-8111-111111111111';
const baseTenant: TenantContext = {
  organizationId,
  membershipId: 'actor-membership',
  roleId: 'admin-role',
  roleName: 'ADMIN',
  permissions: ['member:manage'],
};

describe('MembersService role boundaries', () => {
  function setup(options?: {
    currentRole?: { name: string; isSystem: boolean; permissionKeys?: string[] };
    targetRole?: { name: string; isSystem: boolean; permissionKeys?: string[] };
    otherOwners?: number;
  }) {
    const update = jest.fn().mockResolvedValue({ id: 'target-membership' });
    const remove = jest.fn().mockResolvedValue(undefined);
    const role = (value: { name: string; isSystem: boolean; permissionKeys?: string[] }) => ({
      ...value,
      permissions: (value.permissionKeys ?? ['member:manage']).map((key) => ({
        permission: { key },
      })),
    });
    const transaction = {
      organizationMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'target-membership',
          role: role(options?.currentRole ?? { name: 'DEVELOPER', isSystem: true }),
        }),
        count: jest.fn().mockResolvedValue(options?.otherOwners ?? 1),
        update,
        delete: remove,
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'target-role',
          ...role(options?.targetRole ?? { name: 'DEVELOPER', isSystem: true }),
        }),
      },
      invitation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invitation-1',
          role: role(options?.targetRole ?? { name: 'DEVELOPER', isSystem: true }),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
      permission: { findMany: jest.fn() },
      role: { create: jest.fn(), findFirst: transaction.role.findFirst },
      organizationMembership: transaction.organizationMembership,
    } as unknown as PrismaService;
    return {
      service: new MembersService(prisma, {} as CryptoService),
      update,
      remove,
    };
  }

  it('allows only Owners to create custom roles', async () => {
    const { service } = setup();

    await expect(
      service.createRole(baseTenant, { name: 'Auditor', permissions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only Owners to update or delete custom roles', async () => {
    const { service } = setup();

    await expect(service.updateRole(baseTenant, 'custom-role', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.removeRole(baseTenant, 'custom-role')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    ['OWNER', true],
    ['AUDITOR', false],
  ])('prevents a non-Owner from assigning %s roles', async (name, isSystem) => {
    const { service, update } = setup({ targetRole: { name, isSystem } });

    await expect(
      service.updateMember(baseTenant, 'target-membership', { roleId: 'target-role' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['OWNER', true],
    ['AUDITOR', false],
  ])('prevents a non-Owner from inviting a member into a %s role', async (name, isSystem) => {
    const { service } = setup({ targetRole: { name, isSystem } });

    await expect(
      service.invite(
        baseTenant,
        { id: 'actor-user', name: 'Admin', email: 'admin@example.com' },
        { email: 'invitee@example.com', roleId: 'target-role' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents a delegated member manager from promoting itself to a broader built-in role', async () => {
    const { service, update } = setup({
      currentRole: { name: 'MEMBER_MANAGER', isSystem: false },
      targetRole: {
        name: 'ADMIN',
        isSystem: true,
        permissionKeys: ['member:manage', 'provider:manage'],
      },
    });

    await expect(
      service.updateMember(baseTenant, baseTenant.membershipId, { roleId: 'admin-role' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('prevents a delegated member manager from inviting a broader built-in role', async () => {
    const { service } = setup({
      targetRole: {
        name: 'ADMIN',
        isSystem: true,
        permissionKeys: ['member:manage', 'provider:manage'],
      },
    });

    await expect(
      service.invite(
        baseTenant,
        { id: 'actor-user', name: 'Manager', email: 'manager@example.com' },
        { email: 'controlled@example.com', roleId: 'admin-role' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents a delegated member manager from revoking a broader-role invitation', async () => {
    const { service } = setup({
      targetRole: {
        name: 'ADMIN',
        isSystem: true,
        permissionKeys: ['member:manage', 'provider:manage'],
      },
    });

    await expect(service.revokeInvitation(baseTenant, 'invitation-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('prevents a non-Owner from modifying or removing an Owner membership', async () => {
    const { service, update, remove } = setup({
      currentRole: { name: 'OWNER', isSystem: true },
    });

    await expect(
      service.updateMember(baseTenant, 'target-membership', { roleId: 'target-role' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeMember(baseTenant, 'target-membership')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not allow the last Owner to be demoted', async () => {
    const { service, update } = setup({
      currentRole: { name: 'OWNER', isSystem: true },
      targetRole: { name: 'ADMIN', isSystem: true },
      otherOwners: 0,
    });
    const ownerTenant = { ...baseTenant, roleName: 'OWNER' };

    await expect(
      service.updateMember(ownerTenant, 'target-membership', { roleId: 'target-role' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rolls back acceptance when a pending invitation lost the revoke race', async () => {
    const upsert = jest.fn();
    const invitation = {
      id: 'invitation-1',
      email: 'invitee@example.com',
      organizationId,
      roleId: 'developer-role',
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const transaction = {
      invitation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organizationMembership: { upsert },
    };
    const prisma = {
      invitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new MembersService(prisma, {
      hashToken: jest.fn().mockReturnValue('hashed-token'),
    } as unknown as CryptoService);

    await expect(
      service.acceptInvitation(
        { id: 'user-1', name: 'Invitee', email: invitation.email },
        { token: 'x'.repeat(40) },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
