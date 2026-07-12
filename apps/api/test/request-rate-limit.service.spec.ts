import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../src/modules/runtime/redis.service';
import { RequestRateLimitService } from '../src/modules/runtime/request-rate-limit.service';

describe('RequestRateLimitService', () => {
  function service(nodeEnv: string) {
    const redis = { ready: false } as RedisService;
    const config = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
    } as unknown as ConfigService;
    return new RequestRateLimitService(redis, config);
  }

  it('limits repeated requests in development fallback mode', async () => {
    const limiter = service('development');
    await limiter.consume('login', '127.0.0.1', 2, 60);
    await limiter.consume('login', '127.0.0.1', 2, 60);

    await expect(limiter.consume('login', '127.0.0.1', 2, 60)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('fails closed in production when Redis is unavailable', async () => {
    const limiter = service('production');

    await expect(limiter.consume('login', '127.0.0.1', 2, 60)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
