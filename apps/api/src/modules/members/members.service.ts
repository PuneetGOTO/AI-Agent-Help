import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import type {
  AcceptInvitationDto,
  CreateRoleDto,
  InviteMemberDto,
  RegisterInvitationDto,
  UpdateMemberDto,
  UpdateRoleDto,
} from './dto/members.dto';
import { assertBcryptPasswordLength } from '../../common/auth/password-policy';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async members(tenant: TenantContext) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId: tenant.organizationId },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } },
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        membershipId: row.id,
        userId: row.userId,
        user: row.user,
        role: row.role,
        status: row.user.isActive ? 'ACTIVE' : 'DISABLED',
        joinedAt: row.createdAt,
      })),
      total: rows.length,
      page: 1,
      pageSize: rows.length,
    };
  }

  async updateMember(tenant: TenantContext, membershipId: string, dto: UpdateMemberDto) {
    return this.prisma.$transaction(
      async (transaction) => {
        const membership = await this.membership(tenant.organizationId, membershipId, transaction);
        const role = await this.ownedRole(tenant.organizationId, dto.roleId, transaction);
        this.assertMembershipManageable(tenant, membership.role);
        this.assertRoleAssignable(tenant, role);
        if (membership.role.name === 'OWNER' && role.name !== 'OWNER') {
          await this.ensureAnotherOwner(tenant.organizationId, membership.id, transaction);
        }
        return transaction.organizationMembership.update({
          where: { id: membership.id },
          data: { roleId: role.id },
          include: {
            user: {
              select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true },
            },
            role: { select: { id: true, name: true } },
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async removeMember(tenant: TenantContext, membershipId: string): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        const membership = await this.membership(tenant.organizationId, membershipId, transaction);
        this.assertMembershipManageable(tenant, membership.role);
        if (membership.role.name === 'OWNER') {
          await this.ensureAnotherOwner(tenant.organizationId, membership.id, transaction);
        }
        await transaction.organizationMembership.delete({ where: { id: membership.id } });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async roles(tenant: TenantContext) {
    const rows = await this.prisma.role.findMany({
      where: { organizationId: tenant.organizationId },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    const items = rows.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      system: role.isSystem,
      permissions: role.permissions.map(({ permission }) => permission.key),
      memberCount: role._count.memberships,
    }));
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async createRole(tenant: TenantContext, dto: CreateRoleDto) {
    this.assertOwner(tenant);
    const permissionIds = await this.permissionIds(dto.permissions);
    const role = await this.prisma.role.create({
      data: {
        organizationId: tenant.organizationId,
        name: dto.name.trim().toUpperCase(),
        description: dto.description?.trim(),
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
    return serializeRole(role);
  }

  async updateRole(tenant: TenantContext, id: string, dto: UpdateRoleDto) {
    this.assertOwner(tenant);
    const role = await this.ownedRole(tenant.organizationId, id);
    if (role.isSystem) throw new ForbiddenException('Built-in roles cannot be modified');
    const permissionIds = dto.permissions ? await this.permissionIds(dto.permissions) : undefined;
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (permissionIds) {
        await transaction.rolePermission.deleteMany({ where: { roleId: role.id } });
        await transaction.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
          skipDuplicates: true,
        });
      }
      return transaction.role.update({
        where: { id: role.id },
        data: { name: dto.name?.trim().toUpperCase(), description: dto.description?.trim() },
        include: { permissions: { include: { permission: true } } },
      });
    });
    return serializeRole(updated);
  }

  async removeRole(tenant: TenantContext, id: string): Promise<void> {
    this.assertOwner(tenant);
    const role = await this.ownedRole(tenant.organizationId, id);
    if (role.isSystem) throw new ForbiddenException('Built-in roles cannot be deleted');
    const references = await this.prisma.organizationMembership.count({
      where: { roleId: role.id },
    });
    if (references) throw new ConflictException('Role is assigned to one or more members');
    await this.prisma.role.delete({ where: { id: role.id } });
  }

  async invitations(tenant: TenantContext) {
    await this.expireInvitations(tenant.organizationId);
    const items = await this.prisma.invitation.findMany({
      where: { organizationId: tenant.organizationId },
      include: {
        role: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async invite(tenant: TenantContext, user: AuthUser, dto: InviteMemberDto) {
    const email = dto.email.trim().toLowerCase();
    const role = await this.ownedRole(tenant.organizationId, dto.roleId);
    this.assertRoleAssignable(tenant, role);
    const alreadyMember = await this.prisma.organizationMembership.findFirst({
      where: { organizationId: tenant.organizationId, user: { email } },
      select: { id: true },
    });
    if (alreadyMember) throw new ConflictException('User is already a member of this organization');
    await this.prisma.invitation.updateMany({
      where: { organizationId: tenant.organizationId, email, status: InvitationStatus.PENDING },
      data: { status: InvitationStatus.REVOKED },
    });
    const token = this.crypto.createOpaqueToken(40);
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: tenant.organizationId,
        email,
        roleId: role.id,
        tokenHash: this.crypto.hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        invitedById: user.id,
      },
      include: { role: { select: { id: true, name: true } } },
    });
    return { ...invitation, token };
  }

  async revokeInvitation(tenant: TenantContext, id: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.invitation.findFirst({
        where: { id, organizationId: tenant.organizationId, status: InvitationStatus.PENDING },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      });
      if (!invitation) throw new NotFoundException('Pending invitation not found');
      this.assertRoleAssignable(tenant, invitation.role);
      const result = await transaction.invitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.REVOKED },
      });
      if (!result.count) throw new NotFoundException('Pending invitation not found');
    });
  }

  async registerInvitation(dto: RegisterInvitationDto) {
    assertBcryptPasswordLength(dto.password);
    const invitation = await this.validInvitation(dto.token);
    const existing = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (existing)
      throw new ConflictException('Account already exists; sign in and accept the invitation');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    let user: { id: string; name: string; email: string };
    try {
      user = await this.prisma.$transaction(async (transaction) => {
        await this.claimInvitation(invitation.id, transaction);
        const created = await transaction.user.create({
          data: { email: invitation.email, name: dto.name.trim(), passwordHash },
        });
        await transaction.organizationMembership.create({
          data: {
            organizationId: invitation.organizationId,
            userId: created.id,
            roleId: invitation.roleId,
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: invitation.organizationId,
            actorUserId: created.id,
            action: 'invitation.accept',
            resourceType: 'membership',
            resourceId: created.id,
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Account already exists; sign in and accept the invitation');
      }
      throw error;
    }
    return { accepted: true, user: { id: user.id, name: user.name, email: user.email } };
  }

  async acceptInvitation(user: AuthUser, dto: AcceptInvitationDto) {
    const invitation = await this.validInvitation(dto.token);
    if (invitation.email !== user.email.toLowerCase()) {
      throw new ForbiddenException('Invitation email does not match the signed-in account');
    }
    await this.prisma.$transaction(async (transaction) => {
      await this.claimInvitation(invitation.id, transaction);
      await transaction.organizationMembership.upsert({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId: user.id },
        },
        update: { roleId: invitation.roleId },
        create: {
          organizationId: invitation.organizationId,
          userId: user.id,
          roleId: invitation.roleId,
        },
      });
    });
    return { accepted: true, organizationId: invitation.organizationId };
  }

  private async validInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
    });
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new NotFoundException('Invitation is invalid or no longer pending');
    }
    if (invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('Invitation has expired');
    }
    return invitation;
  }

  private async claimInvitation(id: string, client: Prisma.TransactionClient): Promise<void> {
    const claimed = await client.invitation.updateMany({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: { status: InvitationStatus.ACCEPTED },
    });
    if (claimed.count !== 1) {
      throw new NotFoundException('Invitation is invalid, expired, or no longer pending');
    }
  }

  private async membership(
    organizationId: string,
    id: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const membership = await client.organizationMembership.findFirst({
      where: { id, organizationId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!membership) throw new NotFoundException('Member not found');
    return membership;
  }

  private async ownedRole(
    organizationId: string,
    id: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const role = await client.role.findFirst({
      where: { id, organizationId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async permissionIds(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: unique } } });
    if (permissions.length !== unique.length)
      throw new BadRequestException('One or more permissions are unknown');
    return permissions.map(({ id }) => id);
  }

  private async ensureAnotherOwner(
    organizationId: string,
    excludingMembershipId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const owners = await client.organizationMembership.count({
      where: { organizationId, id: { not: excludingMembershipId }, role: { name: 'OWNER' } },
    });
    if (!owners) throw new ConflictException('Organization must retain at least one Owner');
  }

  private assertOwner(tenant: TenantContext): void {
    if (tenant.roleName !== 'OWNER') {
      throw new ForbiddenException('Only an Owner can manage custom roles');
    }
  }

  private assertMembershipManageable(
    tenant: TenantContext,
    currentRole: RoleWithPermissions,
  ): void {
    if (currentRole.name === 'OWNER' && tenant.roleName !== 'OWNER') {
      throw new ForbiddenException('Only an Owner can modify another Owner membership');
    }
    this.assertPermissionSubset(tenant, currentRole);
  }

  private assertRoleAssignable(tenant: TenantContext, role: RoleWithPermissions): void {
    if (tenant.roleName !== 'OWNER' && (role.name === 'OWNER' || !role.isSystem)) {
      throw new ForbiddenException('Only an Owner can assign Owner or custom roles');
    }
    this.assertPermissionSubset(tenant, role);
  }

  private assertPermissionSubset(tenant: TenantContext, role: RoleWithPermissions): void {
    if (tenant.roleName === 'OWNER') return;
    const actorPermissions = new Set(tenant.permissions);
    if (role.permissions.some(({ permission }) => !actorPermissions.has(permission.key))) {
      throw new ForbiddenException('Cannot manage or assign a role with broader permissions');
    }
  }

  private async expireInvitations(organizationId: string): Promise<void> {
    await this.prisma.invitation.updateMany({
      where: { organizationId, status: InvitationStatus.PENDING, expiresAt: { lte: new Date() } },
      data: { status: InvitationStatus.EXPIRED },
    });
  }
}

type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } };
}>;

function serializeRole(
  role: Prisma.RoleGetPayload<{ include: { permissions: { include: { permission: true } } } }>,
) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    system: role.isSystem,
    permissions: role.permissions.map(({ permission }) => permission.key),
  };
}
