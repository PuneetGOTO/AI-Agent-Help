import { Global, Module } from '@nestjs/common';
import { MaintenanceQueueService } from './maintenance-queue.service';
import { RedisService } from './redis.service';
import { RuntimeControlService } from './runtime-control.service';
import { RequestRateLimitService } from './request-rate-limit.service';

@Global()
@Module({
  providers: [
    RedisService,
    RuntimeControlService,
    RequestRateLimitService,
    MaintenanceQueueService,
  ],
  exports: [RedisService, RuntimeControlService, RequestRateLimitService],
})
export class RuntimeModule {}
