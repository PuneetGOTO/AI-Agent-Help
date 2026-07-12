import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from './redis.service';

@Injectable()
export class MaintenanceQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceQueueService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis.ready) return;
    const connection = redisConnection(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
    this.queue = new Queue('platform-maintenance', { connection });
    this.worker = new Worker(
      'platform-maintenance',
      async (job: Job) => {
        if (job.name === 'retention-cleanup') return this.processRetention();
        return undefined;
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Maintenance job ${job?.id ?? 'unknown'} failed: ${error.message}`),
    );
    await this.queue.add(
      'retention-cleanup',
      {},
      {
        jobId: 'daily-retention-cleanup',
        repeat: { every: 86_400_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async processRetention(): Promise<{ deletedConversations: number }> {
    const workspaces = await this.prisma.workspace.findMany({
      select: { id: true, retentionDays: true },
    });
    let deletedConversations = 0;
    for (const workspace of workspaces) {
      const cutoff = new Date(Date.now() - workspace.retentionDays * 86_400_000);
      const result = await this.prisma.conversation.deleteMany({
        where: { workspaceId: workspace.id, updatedAt: { lt: cutoff } },
      });
      deletedConversations += result.count;
    }
    return { deletedConversations };
  }
}

function redisConnection(value: string) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
