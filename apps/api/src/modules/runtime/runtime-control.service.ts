import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';

interface LocalWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class RuntimeControlService {
  private readonly localRates = new Map<string, LocalWindow>();
  private readonly localLeases = new Map<string, Map<string, number>>();

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async acquire(
    workspaceId: string,
    rateLimitPerMinute: number,
    concurrentRunLimit: number,
  ): Promise<string> {
    const leaseId = randomUUID();
    if (!this.redis.ready) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('Runtime coordination is unavailable');
      }
      this.acquireLocal(workspaceId, leaseId, rateLimitPerMinute, concurrentRunLimit);
      return leaseId;
    }
    const rateKey = `agent-platform:rate:${workspaceId}:${Math.floor(Date.now() / 60_000)}`;
    const count = await this.redis.client.incr(rateKey);
    if (count === 1) await this.redis.client.expire(rateKey, 70);
    if (count > rateLimitPerMinute) throw tooManyRequests('Workspace run rate limit exceeded');

    const leaseKey = `agent-platform:concurrency:${workspaceId}`;
    const now = Date.now();
    const expiresAt = now + 1_800_000;
    const acquired = await this.redis.client.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]);
       if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end;
       redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4]);
       redis.call('EXPIRE', KEYS[1], 1900);
       return 1`,
      1,
      leaseKey,
      now,
      concurrentRunLimit,
      expiresAt,
      leaseId,
    );
    if (Number(acquired) !== 1) throw tooManyRequests('Workspace concurrent run limit exceeded');
    return leaseId;
  }

  async release(workspaceId: string, leaseId: string): Promise<void> {
    if (this.redis.ready) {
      await this.redis.client.zrem(`agent-platform:concurrency:${workspaceId}`, leaseId);
      return;
    }
    this.localLeases.get(workspaceId)?.delete(leaseId);
  }

  private acquireLocal(
    workspaceId: string,
    leaseId: string,
    rateLimit: number,
    concurrentLimit: number,
  ): void {
    const now = Date.now();
    const window = this.localRates.get(workspaceId);
    const current = !window || window.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : window;
    current.count += 1;
    this.localRates.set(workspaceId, current);
    if (current.count > rateLimit) throw tooManyRequests('Workspace run rate limit exceeded');
    const leases = this.localLeases.get(workspaceId) ?? new Map<string, number>();
    for (const [id, expiresAt] of leases) if (expiresAt <= now) leases.delete(id);
    if (leases.size >= concurrentLimit)
      throw tooManyRequests('Workspace concurrent run limit exceeded');
    leases.set(leaseId, now + 1_800_000);
    this.localLeases.set(workspaceId, leases);
  }
}

function tooManyRequests(message: string): HttpException {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}
