import { BadRequestException } from '@nestjs/common';
import { MemoryMode } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TenantContext } from '../src/common/tenancy/tenancy.types';
import { AgentsService } from '../src/modules/agents/agents.service';
import type { ProvidersService } from '../src/modules/providers/providers.service';

describe('AgentsService supported configuration', () => {
  it('fails closed when long-term memory controls are not implemented', async () => {
    const service = new AgentsService({} as PrismaService, {} as ProvidersService);
    const tenant = {
      organizationId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      membershipId: 'membership-1',
      roleId: 'role-1',
      roleName: 'OWNER',
      permissions: [],
    } satisfies TenantContext;

    await expect(
      service.create(
        tenant,
        { id: 'user-1', name: 'Owner', email: 'owner@example.com' },
        {
          name: 'Unsupported memory agent',
          providerConnectionId: '33333333-3333-4333-8333-333333333333',
          model: 'model-test',
          systemPrompt: 'Be helpful',
          memoryMode: MemoryMode.LONG_TERM,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
