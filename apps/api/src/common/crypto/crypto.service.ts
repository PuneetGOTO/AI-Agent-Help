import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly tokenPepper: string;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('ENCRYPTION_KEY'), 'base64');
    this.tokenPepper = config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  encryptJson(value: object): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decryptJson<T extends Record<string, unknown>>(payload: string): T {
    const [version, ivValue, tagValue, encryptedValue] = payload.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
      throw new Error('Unsupported encrypted credential format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.tokenPepper).update(token).digest('hex');
  }

  fingerprintSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex').slice(0, 12);
  }

  createOpaqueToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
