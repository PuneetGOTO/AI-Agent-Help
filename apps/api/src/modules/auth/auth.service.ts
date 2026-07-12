import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/tenancy/tenancy.types';
import { assertBcryptPasswordLength } from '../../common/auth/password-policy';
import type { BootstrapDto, LoginDto } from './dto/auth.dto';
import { RbacBootstrapService } from './rbac-bootstrap.service';

@Injectable()
export class AuthService {
  private readonly refreshDays: number;
  private readonly bootstrapToken?: string;
  private readonly bootstrapTokenRequired: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly rbac: RbacBootstrapService,
  ) {
    this.refreshDays = config.get<number>('JWT_REFRESH_TTL_DAYS', 7);
    this.bootstrapToken = config.get<string>('BOOTSTRAP_TOKEN') || undefined;
    this.bootstrapTokenRequired =
      config.get<string>('NODE_ENV', 'development') === 'production' ||
      Boolean(this.bootstrapToken);
  }

  async bootstrapStatus(): Promise<{
    required: boolean;
    initialized: boolean;
    tokenRequired: boolean;
  }> {
    const required = (await this.prisma.user.count()) === 0;
    return {
      required,
      initialized: !required,
      tokenRequired: required && this.bootstrapTokenRequired,
    };
  }

  async bootstrap(dto: BootstrapDto, request: Request, suppliedToken?: string) {
    this.assertBootstrapToken(suppliedToken);
    assertBcryptPasswordLength(dto.password);
    if ((await this.prisma.user.count()) > 0) {
      throw new ConflictException('Platform initialization has already completed');
    }
    const email = dto.email.trim().toLowerCase();
    const organizationName = dto.organizationName?.trim() || 'Default Organization';
    const workspaceName = dto.workspaceName?.trim() || 'Default Workspace';
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(
      async (transaction) => {
        // Serializable isolation prevents two bootstrap requests from creating separate owners.
        if ((await transaction.user.count()) > 0)
          throw new ConflictException('Already initialized');
        const createdUser = await transaction.user.create({
          data: { email, name: dto.name.trim(), passwordHash },
        });
        const organization = await transaction.organization.create({
          data: { name: organizationName, slug: uniqueSlug(organizationName) },
        });
        const roles = await this.rbac.createDefaultRoles(organization.id, transaction);
        await transaction.organizationMembership.create({
          data: { organizationId: organization.id, userId: createdUser.id, roleId: roles.OWNER! },
        });
        await transaction.workspace.create({
          data: {
            organizationId: organization.id,
            name: workspaceName,
            slug: uniqueSlug(workspaceName),
          },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: organization.id,
            actorUserId: createdUser.id,
            action: 'platform.bootstrap',
            resourceType: 'organization',
            resourceId: organization.id,
            ipAddress: request.ip,
            userAgent: request.get('user-agent')?.slice(0, 500),
          },
        });
        return createdUser;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.createSession(user.id, request);
  }

  async login(dto: LoginDto, request: Request) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    // Always run bcrypt to reduce account enumeration timing differences.
    const valid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEe.yrhP.XXq5nZr0Py4FfEdpcKOx9h64qS',
    );
    if (!user || !valid || !user.isActive || Buffer.byteLength(dto.password, 'utf8') > 72)
      throw new UnauthorizedException('Invalid email or password');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.createSession(user.id, request);
  }

  async refresh(refreshToken: string | undefined, request: Request) {
    if (!refreshToken) throw new UnauthorizedException('Refresh session is missing');
    const result = await this.restore(refreshToken, request);
    if (!result) throw new UnauthorizedException('Refresh session is invalid or expired');
    return result;
  }

  async restore(refreshToken: string | undefined, request: Request) {
    if (!refreshToken) return null;
    const session = await this.prisma.$transaction(async (transaction) => {
      const found = await transaction.refreshSession.findUnique({
        where: { tokenHash: this.crypto.hashToken(refreshToken) },
        include: { user: true },
      });
      if (!found || found.revokedAt || found.expiresAt <= new Date() || !found.user.isActive)
        return null;
      const revoked = await transaction.refreshSession.updateMany({
        where: { id: found.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      return revoked.count === 1 ? found : null;
    });
    return session ? this.createSession(session.userId, request) : null;
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: this.crypto.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(user: AuthUser) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId: user.id },
      include: {
        organization: { include: { workspaces: { orderBy: { createdAt: 'asc' } } } },
        role: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user,
      organizations: await Promise.all(
        memberships.map(async (membership) => ({
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          role: membership.role.name,
          permissions: await this.rolePermissions(membership.role.id),
          workspaces: membership.organization.workspaces,
        })),
      ),
      activeOrganizationId: memberships[0]?.organizationId ?? null,
      activeWorkspaceId: memberships[0]?.organization.workspaces[0]?.id ?? null,
    };
  }

  private async createSession(userId: string, request: Request) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, type: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m') as never,
        algorithm: 'HS256',
      },
    );
    const refreshToken = this.crypto.createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.refreshDays * 86_400_000);
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.hashToken(refreshToken),
        expiresAt,
        ipAddress: request.ip,
        userAgent: request.get('user-agent')?.slice(0, 500),
      },
    });
    const tenant = await this.me(user);
    return { ...tenant, accessToken, refreshToken, refreshExpiresAt: expiresAt };
  }

  private async rolePermissions(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });
    return rows.map((row) => row.permission.key);
  }

  private assertBootstrapToken(suppliedToken?: string): void {
    if (!this.bootstrapTokenRequired) return;

    // Hashing both values gives timingSafeEqual fixed-length buffers even for a missing token.
    const expected = createHash('sha256')
      .update(this.bootstrapToken ?? '')
      .digest();
    const supplied = createHash('sha256')
      .update(suppliedToken ?? '')
      .digest();
    const matches = timingSafeEqual(expected, supplied);
    if (!this.bootstrapToken || !suppliedToken || !matches) {
      throw new UnauthorizedException('Platform initialization credential is invalid');
    }
  }
}

function uniqueSlug(value: string): string {
  const base =
    value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'workspace';
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
