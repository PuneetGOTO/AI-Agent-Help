import { BadRequestException } from '@nestjs/common';
import {
  assertSafeProviderBaseUrl,
  assertSafeProviderDestination,
} from '../src/modules/providers/ssrf-protection';

describe('provider SSRF protection', () => {
  it('keeps configured base URLs free of query strings', () => {
    expect(() =>
      assertSafeProviderBaseUrl('https://api.example.com/v1?token=secret', false),
    ).toThrow(BadRequestException);
  });

  it('allows server-generated Azure query parameters on a public destination', async () => {
    await expect(
      assertSafeProviderDestination('https://1.1.1.1/openai/chat?api-version=2024-10-21', false),
    ).resolves.toBeUndefined();
  });

  it('rejects metadata and loopback destinations unless deployment policy explicitly allows them', async () => {
    await expect(
      assertSafeProviderDestination('https://169.254.169.254/latest/meta-data', false),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      assertSafeProviderDestination('http://127.0.0.1:11434/v1/models', false),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
