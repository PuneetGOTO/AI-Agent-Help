import type { Tool, ToolExecution, Workspace } from '@prisma/client';
import { RunStatus } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TenantContext } from '../src/common/tenancy/tenancy.types';
import type { ToolExecutorService } from '../src/modules/tools/tool-executor.service';
import { ToolApprovalService } from '../src/modules/tools/tool-approval.service';

const workspaceId = '22222222-2222-4222-8222-222222222222';
const tenant: TenantContext = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId,
  membershipId: 'membership-1',
  roleId: 'role-1',
  roleName: 'OWNER',
  permissions: [],
};

describe('ToolApprovalService tenant transitions', () => {
  it('keeps workspace and expected-state predicates on approval updates', async () => {
    const execution = {
      id: 'execution-1',
      agentRunId: 'run-1',
      status: RunStatus.WAITING_APPROVAL,
      input: { id: 1 },
      createdAt: new Date(),
      tool: { id: 'tool-1', name: 'Lookup' } as Tool,
      agentRun: { workspace: { id: workspaceId } as Workspace },
    } as unknown as ToolExecution & {
      tool: Tool;
      agentRun: { workspace: Workspace };
    };
    const toolExecutionUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const agentRunUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      toolExecution: {
        findFirst: jest.fn().mockResolvedValue(execution),
        updateMany: toolExecutionUpdateMany,
      },
      agentRun: { updateMany: agentRunUpdateMany },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaService;
    const executor = {
      execute: jest.fn().mockResolvedValue({ ok: true }),
    } as unknown as ToolExecutorService;

    await new ToolApprovalService(prisma, executor).approve(
      tenant,
      { id: 'user-1', name: 'Owner', email: 'owner@example.com' },
      execution.id,
    );

    expect(toolExecutionUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: execution.id,
          status: RunStatus.RUNNING,
          agentRun: { workspaceId },
        }),
      }),
    );
    expect(agentRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: execution.agentRunId, workspaceId, status: RunStatus.WAITING_APPROVAL },
      }),
    );
  });
});
