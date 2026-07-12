import { BadRequestException } from '@nestjs/common';
import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function assertSafeProviderBaseUrl(value: string, allowPrivateNetwork: boolean): URL {
  return parseProviderUrl(value, allowPrivateNetwork, false);
}

function parseProviderUrl(value: string, allowPrivateNetwork: boolean, allowQuery: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Provider baseUrl must be a valid URL');
  }
  if (!['https:', ...(allowPrivateNetwork ? ['http:'] : [])].includes(url.protocol)) {
    throw new BadRequestException('Provider baseUrl must use HTTPS');
  }
  if (url.username || url.password)
    throw new BadRequestException('Credentials are not allowed in baseUrl');
  if ((!allowQuery && url.search) || url.hash) {
    throw new BadRequestException('Provider baseUrl cannot contain a query string or fragment');
  }
  if (!allowPrivateNetwork && isPrivateHostname(url.hostname)) {
    throw new BadRequestException(
      'Private network provider endpoints are not allowed for this provider type',
    );
  }
  return url;
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (['localhost', 'host.docker.internal'].includes(normalized) || normalized.endsWith('.local'))
    return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const parts = normalized.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    if (normalized.startsWith('::ffff:')) {
      return isPrivateHostname(normalized.slice('::ffff:'.length));
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('ff')
    );
  }
  return false;
}

export async function assertSafeProviderDestination(
  value: string,
  allowPrivateNetwork: boolean,
): Promise<void> {
  const url = parseProviderUrl(value, allowPrivateNetwork, true);
  if (allowPrivateNetwork) return;
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('Provider hostname could not be resolved');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateHostname(address))) {
    throw new BadRequestException('Provider hostname resolves to a private network');
  }
}
