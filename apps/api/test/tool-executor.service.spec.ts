import { BadRequestException, ForbiddenException, NotImplementedException } from '@nestjs/common';
import { ToolType, type Tool, type Workspace } from '@prisma/client';
import { ToolExecutorService } from '../src/modules/tools/tool-executor.service';

describe('ToolExecutorService policy', () => {
  const workspace = { allowedToolDomains: [] } as unknown as Workspace;
  const baseTool = {
    id: 'tool-1',
    type: ToolType.CUSTOM_FUNCTION,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
      additionalProperties: false,
    },
    config: { handlerId: 'registered-handler' },
    isEnabled: true,
    timeoutMs: 1000,
  } as unknown as Tool;

  it('validates the current schema instead of a cached schema for the same tool id', async () => {
    const executor = new ToolExecutorService();
    await expect(executor.execute(baseTool, workspace, { value: 1 })).rejects.toBeInstanceOf(
      NotImplementedException,
    );

    const changed = {
      ...baseTool,
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    } as Tool;
    await expect(executor.execute(changed, workspace, { value: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects disabled tools before execution', async () => {
    const executor = new ToolExecutorService();
    await expect(
      executor.execute({ ...baseTool, isEnabled: false }, workspace, { value: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects static headers whose names imply credentials or signatures', () => {
    const executor = new ToolExecutorService();
    expect(() =>
      executor.validateDefinition(
        ToolType.HTTP_REQUEST,
        { type: 'object' },
        {
          url: 'https://example.com/hook',
          headers: { 'X-Webhook-Signature': 'plaintext-secret' },
        },
      ),
    ).toThrow(BadRequestException);
  });
});
