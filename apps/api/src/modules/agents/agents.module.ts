import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { ToolsModule } from '../tools/tools.module';
import { AgentsController } from './agents.controller';
import { AgentExecutionService } from './agent-execution.service';
import { AgentsService } from './agents.service';

@Module({
  imports: [ProvidersModule, ToolsModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentExecutionService],
  exports: [AgentsService],
})
export class AgentsModule {}
