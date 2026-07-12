import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RedisService } from './redis.service';

interface LocalCounter {
  count: number;
  expiresAt: number;
}

@Injectable()
export class RequestRateLimitService {
  private readonly local = new Map<string, LocalCounter>();

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async consume(
    namespace: string,
    identifier: string | undefined,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `agent-platform:request-rate:${namespace}:${hash(identifier || 'unknown')}`;
    let count: number;
    if (this.redis.ready) {
      count = Number(
        await this.redis.client.eval(
          `local current = redis.call('INCR', KEYS[1]);
           if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end;
           return current`,
          1,
          key,
          windowSeconds,
        ),
      );
    } else {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('Request rate limiting is unavailable');
      }
      const now = Date.now();
      const current = this.local.get(key);
      const counter =
        !current || current.expiresAt <= now
          ? { count: 0, expiresAt: now + windowSeconds * 1000 }
          : current;
      counter.count += 1;
      this.local.set(key, counter);
      count = counter.count;
    }
    if (count > limit) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
