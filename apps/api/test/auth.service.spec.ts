import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import type { RbacBootstrapService } from '../src/modules/auth/rbac-bootstrap.service';
import { assertBcryptPasswordLength } from '../src/common/auth/password-policy';

describe('AuthService bootstrap protection', () => {
  const dto = {
    name: 'Platform Owner',
    email: 'owner@example.com',
    password: 'StrongPassword1!',
    organizationName: 'Example',
    workspaceName: 'Production',
  };
  const request = {} as Request;

  function service(environment: Record<string, unknown>, userCount = 0) {
    const countUsers = jest.fn().mockResolvedValue(userCount);
    const prisma = {
      user: { count: countUsers },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => environment[key] ?? fallback),
    } as unknown as ConfigService;
    return {
      auth: new AuthService(
        prisma,
        {} as JwtService,
        config,
        {} as CryptoService,
        {} as RbacBootstrapService,
      ),
      countUsers,
    };
  }

  it('reports that production initialization requires a token without exposing it', async () => {
    const { auth } = service({ NODE_ENV: 'production', BOOTSTRAP_TOKEN: 'server-secret' });

    await expect(auth.bootstrapStatus()).resolves.toEqual({
      required: true,
      initialized: false,
      tokenRequired: true,
    });
  });

  it('fails closed in production when the deployment has no bootstrap token', async () => {
    const { auth, countUsers } = service({ NODE_ENV: 'production' });

    await expect(auth.bootstrap(dto, request)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(countUsers).not.toHaveBeenCalled();
  });

  it('requires a configured token outside production and accepts only an exact match', async () => {
    const { auth, countUsers } = service({ NODE_ENV: 'test', BOOTSTRAP_TOKEN: 'server-secret' }, 1);

    await expect(auth.bootstrap(dto, request, 'wrong-secret')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(countUsers).not.toHaveBeenCalled();

    await expect(auth.bootstrap(dto, request, 'server-secret')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(countUsers).toHaveBeenCalledTimes(1);
  });

  it('does not require a token outside production when none is configured', async () => {
    const { auth } = service({ NODE_ENV: 'test' }, 1);

    await expect(auth.bootstrapStatus()).resolves.toEqual({
      required: false,
      initialized: true,
      tokenRequired: false,
    });
    await expect(auth.bootstrap(dto, request)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects passwords that bcrypt would silently truncate', () => {
    expect(() => assertBcryptPasswordLength('密'.repeat(25))).toThrow('72 UTF-8 bytes');
  });
});
