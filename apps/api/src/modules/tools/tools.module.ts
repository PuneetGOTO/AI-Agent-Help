import { Module } from '@nestjs/common';
import { ToolExecutorService } from './tool-executor.service';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { ToolApprovalService } from './tool-approval.service';
import { ToolExecutionsController } from './tool-executions.controller';

@Module({
  controllers: [ToolsController, ToolExecutionsController],
  providers: [ToolsService, ToolExecutorService, ToolApprovalService],
  exports: [ToolsService, ToolExecutorService],
})
export class ToolsModule {}
