const DEV_ACCESS_SECRET = 'development-access-secret-change-in-production';
const DEV_REFRESH_SECRET = 'development-refresh-secret-change-in-production';
// Stable only so local encrypted rows remain readable after a restart. Production rejects this fallback.
const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZSE=';

export interface AppEnvironment {
  NODE_ENV: string;
  API_PORT: number;
  WEB_URL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL_DAYS: number;
  ENCRYPTION_KEY: string;
  COOKIE_SECURE: boolean;
  BOOTSTRAP_TOKEN?: string;
  OLLAMA_ALLOWED_BASE_URLS: string;
  BEDROCK_ALLOWED_ENDPOINTS: string;
}

export function validateEnvironment(
  raw: Record<string, unknown>,
): AppEnvironment & Record<string, unknown> {
  const nodeEnv = stringValue(raw.NODE_ENV, 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const production = nodeEnv === 'production';
  const accessSecret = stringValue(raw.JWT_ACCESS_SECRET, production ? '' : DEV_ACCESS_SECRET);
  const refreshSecret = stringValue(raw.JWT_REFRESH_SECRET, production ? '' : DEV_REFRESH_SECRET);
  const encryptionKey = stringValue(raw.ENCRYPTION_KEY, production ? '' : DEV_ENCRYPTION_KEY);

  if (accessSecret.length < 32 || refreshSecret.length < 32 || accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must contain at least 32 characters');
  }

  let decodedEncryptionKey: Buffer;
  try {
    decodedEncryptionKey = Buffer.from(encryptionKey, 'base64');
  } catch {
    decodedEncryptionKey = Buffer.alloc(0);
  }
  if (decodedEncryptionKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  const webUrl = stringValue(raw.WEB_URL, 'http://localhost:3000');
  const databaseUrl = stringValue(
    raw.DATABASE_URL,
    'postgresql://agent_platform:change-me-in-production@localhost:5432/agent_platform?schema=public',
  );
  const redisUrl = stringValue(raw.REDIS_URL, 'redis://localhost:6379');
  const s3Endpoint = optionalString(raw.S3_ENDPOINT);
  const s3AccessKey = stringValue(raw.S3_ACCESS_KEY, 'minioadmin');
  const s3SecretKey = stringValue(raw.S3_SECRET_KEY, 'minioadmin-change-me');
  const cookieSecure = parseBoolean(raw.COOKIE_SECURE, false);
  const bootstrapToken = optionalString(raw.BOOTSTRAP_TOKEN);
  const origins = webUrl.split(',').map((origin) => parseOrigin(origin));
  const ollamaAllowedBaseUrls = stringValue(
    raw.OLLAMA_ALLOWED_BASE_URLS,
    production ? '' : 'http://localhost:11434/v1,http://127.0.0.1:11434/v1',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseOllamaBaseUrl);
  const bedrockAllowedEndpoints = stringValue(raw.BEDROCK_ALLOWED_ENDPOINTS, '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseBedrockEndpoint);

  if (production) {
    if (
      !raw.DATABASE_URL ||
      !raw.WEB_URL ||
      !raw.REDIS_URL ||
      !raw.S3_ENDPOINT ||
      !raw.S3_ACCESS_KEY ||
      !raw.S3_SECRET_KEY
    ) {
      throw new Error(
        'DATABASE_URL, WEB_URL, REDIS_URL, S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY are required in production',
      );
    }
    const placeholders = [
      DEV_ACCESS_SECRET,
      DEV_REFRESH_SECRET,
      DEV_ENCRYPTION_KEY,
      'replace-with-at-least-32-random-characters',
      'replace-with-another-32-random-characters',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ];
    if (placeholders.includes(accessSecret) || placeholders.includes(refreshSecret)) {
      throw new Error('Production JWT secrets must not use example values');
    }
    if (placeholders.includes(encryptionKey) || decodedEncryptionKey.every((byte) => byte === 0)) {
      throw new Error('Production ENCRYPTION_KEY must not use an example value');
    }
    if (/change-me-in-production|replace_me|(?:^|:)minioadmin(?:@|:)/i.test(databaseUrl)) {
      throw new Error('Production DATABASE_URL must not use an example password');
    }
    if (s3AccessKey === 'minioadmin' || /minioadmin|change-me|replace_me/i.test(s3SecretKey)) {
      throw new Error('Production S3 credentials must not use example values');
    }
    validateS3Endpoint(s3Endpoint, true, origins.every(isLoopbackOrigin));
    if (bootstrapToken && bootstrapToken.length < 32) {
      throw new Error('BOOTSTRAP_TOKEN must contain at least 32 characters when configured');
    }
    const onlyLoopbackOrigins = origins.every(isLoopbackOrigin);
    if (!cookieSecure && !onlyLoopbackOrigins) {
      throw new Error('COOKIE_SECURE must be true for non-loopback production origins');
    }
  }

  return {
    ...raw,
    NODE_ENV: nodeEnv,
    API_PORT: Number(raw.API_PORT ?? 4000),
    WEB_URL: origins.map((origin) => origin.origin).join(','),
    DATABASE_URL: databaseUrl,
    REDIS_URL: validateRedisUrl(redisUrl),
    S3_ENDPOINT: validateS3Endpoint(s3Endpoint, production, origins.every(isLoopbackOrigin)),
    S3_ACCESS_KEY: s3AccessKey,
    S3_SECRET_KEY: s3SecretKey,
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
    JWT_ACCESS_TTL: stringValue(raw.JWT_ACCESS_TTL, '15m'),
    JWT_REFRESH_TTL_DAYS: parseDurationDays(stringValue(raw.JWT_REFRESH_TTL, '7d')),
    ENCRYPTION_KEY: encryptionKey,
    COOKIE_SECURE: cookieSecure,
    BOOTSTRAP_TOKEN: bootstrapToken,
    OLLAMA_ALLOWED_BASE_URLS: ollamaAllowedBaseUrls.join(','),
    BEDROCK_ALLOWED_ENDPOINTS: bedrockAllowedEndpoints.join(','),
  };
}

function stringValue(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error('Environment values must be strings, numbers, or booleans');
  }
  return String(value);
}

function parseDurationDays(value: string): number {
  const match = /^(\d+)d$/.exec(value);
  if (!match?.[1]) return 7;
  return Math.max(1, Math.min(90, Number(match[1])));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  const normalized = stringValue(value, String(fallback));
  if (!['true', 'false'].includes(normalized)) {
    throw new Error('Boolean environment values must be true or false');
  }
  return normalized === 'true';
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return stringValue(value, '').trim();
}

function parseOrigin(value: string): URL {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('WEB_URL must contain valid HTTP(S) origins');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== trimmed ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'WEB_URL must contain exact HTTP(S) origins without paths, credentials, or wildcards',
    );
  }
  return url;
}

function isLoopbackOrigin(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function parseOllamaBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OLLAMA_ALLOWED_BASE_URLS must contain valid HTTP(S) URLs');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('OLLAMA_ALLOWED_BASE_URLS entries cannot contain credentials, query, or hash');
  }
  return url.toString().replace(/\/$/, '');
}

function parseBedrockEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BEDROCK_ALLOWED_ENDPOINTS must contain valid HTTPS origins');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'BEDROCK_ALLOWED_ENDPOINTS entries must be exact HTTPS origins without credentials, paths, query, or hash',
    );
  }
  return url.origin;
}

function validateRedisUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  return value;
}

function validateS3Endpoint(
  value: string | undefined,
  production: boolean,
  localDeployment = false,
): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('S3_ENDPOINT must be a valid HTTP(S) origin');
  }
  const localHttpAllowed =
    localDeployment && url.protocol === 'http:' && isLocalS3Hostname(url.hostname);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (production && url.protocol !== 'https:' && !localHttpAllowed) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'S3_ENDPOINT must be an exact HTTPS origin for public production deployments without credentials, path, query, or hash',
    );
  }
  return url.origin;
}

function isLocalS3Hostname(value: string): boolean {
  const hostname = value.replace(/^\[|\]$/g, '').toLowerCase();
  return ['minio', 'localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(hostname);
}
