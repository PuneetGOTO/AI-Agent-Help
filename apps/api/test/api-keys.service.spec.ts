import { BadRequestException } from '@nestjs/common';
import { ApiKeyType } from '@prisma/client';
import { PERMISSIONS } from '@agent-platform/shared';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TenantContext } from '../src/common/tenancy/tenancy.types';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';

describe('ApiKeysService scopes', () => {
  it('rejects management scopes until a dedicated service-principal model exists', async () => {
    const service = new ApiKeysService({} as PrismaService, {} as CryptoService);
    const tenant = {
      organizationId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      membershipId: 'membership-1',
      roleId: 'role-1',
      roleName: 'OWNER',
      permissions: [PERMISSIONS.API_KEY_MANAGE],
    } satisfies TenantContext;

    await expect(
      service.create(
        tenant,
        { id: 'user-1', name: 'Owner', email: 'owner@example.com' },
        {
          name: 'Unsafe management key',
          type: ApiKeyType.PLATFORM,
          scopes: [PERMISSIONS.PROVIDER_MANAGE],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
