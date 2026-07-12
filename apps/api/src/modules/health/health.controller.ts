import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../runtime/redis.service';
import { StorageService } from '../storage/storage.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @Public()
  @Get()
  async health(@Res({ passthrough: true }) response: Response) {
    const checks: Record<string, { status: 'up' | 'down'; latencyMs: number }> = {};
    const databaseStarted = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'up', latencyMs: Date.now() - databaseStarted };
    } catch {
      checks.database = { status: 'down', latencyMs: Date.now() - databaseStarted };
    }
    try {
      checks.redis = { status: 'up', latencyMs: await this.redis.ping() };
    } catch {
      checks.redis = { status: 'down', latencyMs: 0 };
    }
    try {
      checks.storage = { status: 'up', latencyMs: await this.storage.health() };
    } catch {
      checks.storage = { status: 'down', latencyMs: 0 };
    }
    const ok = Object.values(checks).every(({ status }) => status === 'up');
    if (!ok) response.status(503);
    return {
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}
