import { ConflictException } from '@nestjs/common';
import { ToolType, type Tool } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TenantContext } from '../src/common/tenancy/tenancy.types';
import type { ToolExecutorService } from '../src/modules/tools/tool-executor.service';
import { ToolsService } from '../src/modules/tools/tools.service';

describe('ToolsService published policy', () => {
  it('prevents model-visible policy changes on tools referenced by published versions', async () => {
    const tool = {
      id: 'tool-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      type: ToolType.HTTP_REQUEST,
      inputSchema: { type: 'object' },
      config: { url: 'https://example.com/hook' },
    } as unknown as Tool;
    const updateTool = jest.fn();
    const prisma = {
      tool: { findFirst: jest.fn().mockResolvedValue(tool), update: updateTool },
      toolExecution: { count: jest.fn().mockResolvedValue(0) },
      agentVersionTool: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const executor = { validateDefinition: jest.fn() } as unknown as ToolExecutorService;
    const service = new ToolsService(prisma, executor);
    const tenant = {
      organizationId: '11111111-1111-4111-8111-111111111111',
      workspaceId: tool.workspaceId,
      membershipId: 'membership-1',
      roleId: 'role-1',
      roleName: 'OWNER',
      permissions: [],
    } satisfies TenantContext;

    await expect(
      service.update(tenant, tool.id, { description: 'Changed model instruction' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateTool).not.toHaveBeenCalled();
  });
});
