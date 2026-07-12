import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ConversationsService } from './conversations.service';
import { ObservabilityController } from './observability.controller';
import { UsageService } from './usage.service';

@Module({
  controllers: [ObservabilityController],
  providers: [ConversationsService, UsageService, AuditService],
})
export class ObservabilityModule {}
