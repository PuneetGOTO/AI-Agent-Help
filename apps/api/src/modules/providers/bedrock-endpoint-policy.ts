import { BadRequestException } from '@nestjs/common';
import { assertSafeProviderBaseUrl } from './ssrf-protection';

const AWS_REGION = '[a-z0-9]+(?:-[a-z0-9]+)+-\\d+';
const BEDROCK_SERVICE = '(?:bedrock|bedrock-runtime|bedrock-fips|bedrock-runtime-fips)';
const AWS_DNS_SUFFIX = '(?:amazonaws\\.com(?:\\.cn)?|api\\.aws)';

export function assertAllowedBedrockEndpoint(
  value: string,
  options: { allowCustom: boolean; region?: string },
): URL {
  const url = assertSafeProviderBaseUrl(value, false);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new BadRequestException('Bedrock endpoint must not contain a path, query, or fragment');
  }
  if (!options.allowCustom && !isOfficialBedrockHostname(url.hostname, options.region)) {
    throw new BadRequestException(
      'Bedrock endpoint must use an official AWS hostname or a deployment allowlist entry',
    );
  }
  return url;
}

export function isOfficialBedrockHostname(hostname: string, region?: string): boolean {
  const regionPattern = region ? escapeRegExp(region.toLowerCase()) : AWS_REGION;
  return new RegExp(`^${BEDROCK_SERVICE}\\.${regionPattern}\\.${AWS_DNS_SUFFIX}$`, 'i').test(
    hostname.replace(/\.$/, ''),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
