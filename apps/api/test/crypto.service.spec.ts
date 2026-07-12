import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/common/crypto/crypto.service';

describe('CryptoService', () => {
  const encryptionKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
  const service = new CryptoService(
    new ConfigService({
      ENCRYPTION_KEY: encryptionKey,
      JWT_REFRESH_SECRET: 'test-refresh-pepper-with-more-than-32-characters',
    }),
  );

  it('round-trips credentials without exposing plaintext', () => {
    const encrypted = service.encryptJson({ apiKey: 'sk-unit-secret', region: 'test' });

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('sk-unit-secret');
    expect(service.decryptJson(encrypted)).toEqual({ apiKey: 'sk-unit-secret', region: 'test' });
  });

  it('rejects an authenticated-ciphertext modification', () => {
    const encrypted = service.encryptJson({ apiKey: 'sk-tamper-test' });
    const replacement = encrypted.endsWith('A') ? 'B' : 'A';

    expect(() => service.decryptJson(`${encrypted.slice(0, -1)}${replacement}`)).toThrow();
  });

  it('uses a deterministic HMAC for opaque token lookup', () => {
    expect(service.hashToken('token-value')).toBe(service.hashToken('token-value'));
    expect(service.hashToken('token-value')).not.toBe(service.hashToken('other-token'));
  });
});
