import { validateEnvironment } from '../src/config/environment';

const validProduction = {
  NODE_ENV: 'production',
  WEB_URL: 'https://agents.example.com',
  DATABASE_URL: 'postgresql://app:strong-password@db.example.com:5432/agents',
  REDIS_URL: 'rediss://cache.example.com:6379/0',
  S3_ENDPOINT: 'https://objects.example.com',
  S3_ACCESS_KEY: 'production-access-key',
  S3_SECRET_KEY: 'production-secret-value',
  JWT_ACCESS_SECRET: 'access-secret-that-is-long-and-unique-1234',
  JWT_REFRESH_SECRET: 'refresh-secret-that-is-long-and-unique-5678',
  ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  BOOTSTRAP_TOKEN: 'bootstrap-token-that-is-long-and-unique-1234',
  COOKIE_SECURE: 'true',
};

describe('validateEnvironment', () => {
  it('accepts non-placeholder production secrets', () => {
    expect(validateEnvironment(validProduction)).toEqual(
      expect.objectContaining({ NODE_ENV: 'production', COOKIE_SECURE: true }),
    );
  });

  it('allows an initialized production deployment to remove its bootstrap token', () => {
    const { BOOTSTRAP_TOKEN: _removed, ...withoutBootstrapToken } = validProduction;
    void _removed;
    expect(validateEnvironment(withoutBootstrapToken)).toEqual(
      expect.objectContaining({ NODE_ENV: 'production', BOOTSTRAP_TOKEN: undefined }),
    );
  });

  it('rejects documented example secrets in production', () => {
    expect(() =>
      validateEnvironment({
        ...validProduction,
        JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('example values');
  });

  it('requires secure cookies for public production origins', () => {
    expect(() => validateEnvironment({ ...validProduction, COOKIE_SECURE: 'false' })).toThrow(
      'COOKIE_SECURE',
    );
  });

  it('rejects malformed deployment-controlled Ollama allowlist entries', () => {
    expect(() =>
      validateEnvironment({
        ...validProduction,
        OLLAMA_ALLOWED_BASE_URLS: 'http://user:password@127.0.0.1:11434/v1',
      }),
    ).toThrow('OLLAMA_ALLOWED_BASE_URLS');
  });

  it('accepts exact HTTPS Bedrock proxy origins and rejects paths', () => {
    expect(
      validateEnvironment({
        ...validProduction,
        BEDROCK_ALLOWED_ENDPOINTS: 'https://bedrock-proxy.example.com',
      }),
    ).toEqual(
      expect.objectContaining({
        BEDROCK_ALLOWED_ENDPOINTS: 'https://bedrock-proxy.example.com',
      }),
    );
    expect(() =>
      validateEnvironment({
        ...validProduction,
        BEDROCK_ALLOWED_ENDPOINTS: 'https://bedrock-proxy.example.com/v1',
      }),
    ).toThrow('BEDROCK_ALLOWED_ENDPOINTS');
  });

  it('requires an exact HTTPS S3 endpoint in production', () => {
    expect(() =>
      validateEnvironment({ ...validProduction, S3_ENDPOINT: 'http://objects.example.com' }),
    ).toThrow('S3_ENDPOINT');
    expect(() =>
      validateEnvironment({
        ...validProduction,
        S3_ENDPOINT: 'https://objects.example.com/bucket',
      }),
    ).toThrow('S3_ENDPOINT');
  });

  it('allows the loopback Docker Compose profile to use internal MinIO HTTP', () => {
    expect(
      validateEnvironment({
        ...validProduction,
        WEB_URL: 'http://localhost:3000',
        COOKIE_SECURE: 'false',
        S3_ENDPOINT: 'http://minio:9000',
      }),
    ).toEqual(expect.objectContaining({ S3_ENDPOINT: 'http://minio:9000' }));
    expect(() =>
      validateEnvironment({
        ...validProduction,
        WEB_URL: 'http://localhost:3000',
        COOKIE_SECURE: 'false',
        S3_ENDPOINT: 'http://objects.example.com',
      }),
    ).toThrow('S3_ENDPOINT');
  });
});
