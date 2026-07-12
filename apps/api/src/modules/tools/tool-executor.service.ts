import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import type { Tool, Workspace } from '@prisma/client';
import Ajv from 'ajv';
import { lookup } from 'node:dns/promises';
import { isPrivateHostname } from '../providers/ssrf-protection';

interface HttpToolConfig {
  url?: unknown;
  method?: unknown;
  headers?: unknown;
}

@Injectable()
export class ToolExecutorService {
  private readonly ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });

  validateDefinition(
    type: Tool['type'],
    inputSchema: Record<string, unknown>,
    config: Record<string, unknown>,
  ): void {
    try {
      this.ajv.compile(inputSchema);
    } catch (error) {
      throw new BadRequestException(
        `Invalid input schema: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    if (type === 'HTTP_REQUEST' || type === 'WEBHOOK') this.parseHttpConfig(config);
    if (type === 'DATABASE_QUERY' || type === 'CUSTOM_FUNCTION') {
      // These types are extension points only; arbitrary SQL and system commands are intentionally not executable.
      if (!config.handlerId || typeof config.handlerId !== 'string') {
        throw new BadRequestException('This tool type requires a registered handlerId');
      }
    }
  }

  async execute(
    tool: Tool,
    workspace: Workspace,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (!tool.isEnabled) throw new ForbiddenException('Tool is disabled');
    this.validateInput(tool, input);
    if (tool.type !== 'HTTP_REQUEST' && tool.type !== 'WEBHOOK') {
      throw new NotImplementedException(
        'Only verified HTTP and webhook tools are executable in this runtime',
      );
    }
    const config = this.parseHttpConfig(tool.config as Record<string, unknown>);
    const url = new URL(config.url);
    await this.assertDestinationAllowed(url, workspace.allowedToolDomains);
    const headers = this.safeHeaders(config.headers);
    const method = config.method;
    if (method === 'GET') {
      for (const [key, value] of Object.entries(input)) {
        if (['string', 'number', 'boolean'].includes(typeof value))
          url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(tool.timeoutMs),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      ...(method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(input) } : {}),
    });
    const text = await readLimitedResponse(response, 1_000_000);
    if (!response.ok) {
      throw new Error(`Tool endpoint returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? JSON.parse(text) : { text };
  }

  private validateInput(tool: Tool, input: Record<string, unknown>): void {
    const validator = this.ajv.compile(tool.inputSchema as Record<string, unknown>);
    if (!validator(input)) {
      throw new BadRequestException({
        message: 'Tool arguments failed schema validation',
        errors: validator.errors,
      });
    }
  }

  private parseHttpConfig(value: Record<string, unknown>): {
    url: string;
    method: string;
    headers?: Record<string, string>;
  } {
    const config = value as HttpToolConfig;
    if (typeof config.url !== 'string')
      throw new BadRequestException('HTTP tool config.url is required');
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new BadRequestException('HTTP tool config.url must be a valid URL');
    }
    if (url.protocol !== 'https:')
      throw new BadRequestException('HTTP tools require HTTPS endpoints');
    if (url.username || url.password)
      throw new BadRequestException('Credentials cannot be embedded in tool URLs');
    if (url.hash) throw new BadRequestException('HTTP tool URLs cannot contain fragments');
    for (const key of url.searchParams.keys()) {
      if (/(secret|password|api.?key|authorization|credential|token)/i.test(key)) {
        throw new BadRequestException('Sensitive values cannot be embedded in tool URL queries');
      }
    }
    const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'POST';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new BadRequestException('Unsupported HTTP tool method');
    }
    return { url: url.toString(), method, headers: this.safeHeaders(config.headers) };
  }

  private safeHeaders(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Tool headers must be an object');
    const result: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(value)) {
      if (/(auth|token|key|secret|password|credential|cookie|session|signature)/i.test(key)) {
        throw new BadRequestException(`Sensitive static header ${key} is not allowed`);
      }
      if (typeof headerValue !== 'string' || headerValue.length > 1000)
        throw new BadRequestException('Invalid tool header');
      result[key] = headerValue;
    }
    return result;
  }

  private async assertDestinationAllowed(url: URL, allowedDomains: string[]): Promise<void> {
    const host = url.hostname.toLowerCase();
    if (
      !allowedDomains.some(
        (domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`),
      )
    ) {
      throw new ForbiddenException('Tool destination is not in the workspace domain allowlist');
    }
    if (isPrivateHostname(host))
      throw new ForbiddenException('Tool destination resolves to a private network');
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateHostname(address))) {
      throw new ForbiddenException('Tool destination resolves to a private network');
    }
  }
}

async function readLimitedResponse(response: Response, limit: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > limit) throw new BadRequestException('Tool response exceeds the size limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BadRequestException('Tool response exceeds the size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
