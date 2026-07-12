import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: null,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 250, 5_000),
    });
    this.client.on('error', (error) =>
      this.logger.warn(`Redis connection error: ${error.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
      this.logger.log('Redis connection established');
    } catch (error) {
      if (this.config.get('NODE_ENV') === 'production') throw error;
      this.logger.warn('Redis unavailable; development-only in-process limits will be used');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end')
      await this.client.quit().catch(() => this.client.disconnect());
  }

  get ready(): boolean {
    return this.client.status === 'ready';
  }

  async ping(): Promise<number> {
    const started = Date.now();
    if (!this.ready) throw new Error('Redis is not ready');
    await this.client.ping();
    return Date.now() - started;
  }
}
