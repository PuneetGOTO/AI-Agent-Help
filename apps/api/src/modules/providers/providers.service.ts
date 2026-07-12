import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProviderConnection, ProviderType } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import type { CreateProviderDto, UpdateProviderDto } from './dto/provider.dto';
import { ProviderRegistryService } from './provider-registry.service';
import type { ProviderRuntimeConfig } from './provider.types';
import { assertSafeProviderBaseUrl } from './ssrf-protection';
import { assertAllowedBedrockEndpoint } from './bedrock-endpoint-policy';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: ProviderRegistryService,
    private readonly config: ConfigService,
  ) {}

  async list(tenant: TenantContext) {
    const rows = await this.prisma.providerConnection.findMany({
      where: { workspaceId: requiredWorkspace(tenant) },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: rows.map((row) => this.safe(row)),
      total: rows.length,
      page: 1,
      pageSize: rows.length,
    };
  }

  async create(tenant: TenantContext, dto: CreateProviderDto) {
    this.validateConfiguration(dto.type, dto.baseUrl, dto.credentials, dto.config);
    this.validatePublicConfig(dto.config);
    const encrypted = this.crypto.encryptJson(dto.credentials);
    try {
      const row = await this.prisma.providerConnection.create({
        data: {
          workspaceId: requiredWorkspace(tenant),
          name: dto.name.trim(),
          type: dto.type,
          baseUrl: dto.baseUrl?.replace(/\/$/, ''),
          credentialsEncrypted: encrypted,
          credentialFingerprint: this.fingerprint(dto.type, dto.credentials),
          config: dto.config as Prisma.InputJsonValue | undefined,
        },
      });
      return this.safe(row);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new BadRequestException('Provider connection name already exists in this workspace');
      }
      throw error;
    }
  }

  async update(tenant: TenantContext, id: string, dto: UpdateProviderDto) {
    const current = await this.findOwned(tenant, id);
    const nextBaseUrl = dto.baseUrl ?? current.baseUrl ?? undefined;
    const nextConfig =
      dto.config ?? (current.config as Record<string, unknown> | null) ?? undefined;
    if (dto.baseUrl !== undefined || dto.credentials || dto.config !== undefined) {
      this.validateConfiguration(
        current.type,
        nextBaseUrl,
        dto.credentials ?? this.decrypt(current),
        nextConfig,
      );
    }
    this.validatePublicConfig(dto.config);
    const row = await this.prisma.providerConnection.update({
      where: { id: current.id },
      data: {
        name: dto.name?.trim(),
        baseUrl: dto.baseUrl?.replace(/\/$/, ''),
        isEnabled: dto.isEnabled,
        config: dto.config as Prisma.InputJsonValue | undefined,
        ...(dto.credentials
          ? {
              credentialsEncrypted: this.crypto.encryptJson(dto.credentials),
              credentialFingerprint: this.fingerprint(current.type, dto.credentials),
            }
          : {}),
      },
    });
    return this.safe(row);
  }

  async remove(tenant: TenantContext, id: string): Promise<void> {
    const row = await this.findOwned(tenant, id);
    const used = await this.prisma.agentVersion.count({ where: { providerConnectionId: row.id } });
    if (used) throw new BadRequestException('Provider connection is referenced by agent versions');
    await this.prisma.providerConnection.delete({ where: { id: row.id } });
  }

  async validate(tenant: TenantContext, id: string) {
    const row = await this.findOwned(tenant, id);
    const runtime = this.runtime(row);
    const adapter = this.registry.get(row.type);
    try {
      await adapter.validateCredential(runtime);
      await this.prisma.providerConnection.update({
        where: { id: row.id },
        data: { lastValidatedAt: new Date(), lastValidationError: null },
      });
      return { valid: true, capabilities: this.registry.capabilities(row.type) };
    } catch (error) {
      const normalized = adapter.normalizeError(error);
      await this.prisma.providerConnection.update({
        where: { id: row.id },
        data: { lastValidationError: normalized.message.slice(0, 500) },
      });
      throw new BadGatewayException(normalized.message);
    }
  }

  async models(tenant: TenantContext, id: string) {
    const row = await this.findOwned(tenant, id);
    const adapter = this.registry.get(row.type);
    const models = await adapter.listModels(this.runtime(row));
    return { items: models, total: models.length };
  }

  async runtimeForWorkspace(
    workspaceId: string,
    id: string,
  ): Promise<{
    connection: ProviderConnection;
    runtime: ProviderRuntimeConfig;
  }> {
    const connection = await this.prisma.providerConnection.findFirst({
      where: { id, workspaceId, isEnabled: true },
    });
    if (!connection) throw new NotFoundException('Provider connection not found or disabled');
    return { connection, runtime: this.runtime(connection) };
  }

  private async findOwned(tenant: TenantContext, id: string): Promise<ProviderConnection> {
    const row = await this.prisma.providerConnection.findFirst({
      where: { id, workspaceId: requiredWorkspace(tenant) },
    });
    if (!row) throw new NotFoundException('Provider connection not found');
    return row;
  }

  private runtime(row: ProviderConnection): ProviderRuntimeConfig {
    const publicConfig = (row.config as Record<string, unknown> | null) ?? null;
    const credentials = this.decrypt(row);
    this.validateBaseUrl(row.type, row.baseUrl ?? undefined, credentials.region);
    if (row.type === 'AWS_BEDROCK') {
      this.validateBedrockConfigEndpoint(publicConfig ?? undefined, credentials.region);
    }
    const bedrockEndpoint =
      row.type === 'AWS_BEDROCK'
        ? (row.baseUrl ?? stringConfigValue(publicConfig, 'endpoint'))
        : undefined;
    return {
      id: row.id,
      type: row.type,
      baseUrl: row.baseUrl,
      credentials,
      config: publicConfig,
      allowPrivateNetwork:
        row.type === 'OLLAMA' && this.isAllowedOllamaBaseUrl(row.baseUrl ?? undefined),
      allowCustomAwsEndpoint:
        row.type === 'AWS_BEDROCK' &&
        Boolean(bedrockEndpoint) &&
        this.isAllowedBedrockEndpoint(bedrockEndpoint),
    };
  }

  private decrypt(row: ProviderConnection): Record<string, unknown> {
    return this.crypto.decryptJson(row.credentialsEncrypted);
  }

  private safe(row: ProviderConnection) {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      type: row.type,
      baseUrl: row.baseUrl,
      credentialFingerprint: row.credentialFingerprint,
      config: row.config,
      capabilities: this.registry.capabilities(row.type),
      isEnabled: row.isEnabled,
      lastValidatedAt: row.lastValidatedAt,
      lastValidationError: row.lastValidationError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private validateConfiguration(
    type: ProviderType,
    baseUrl: string | undefined,
    credentials: {
      apiKey?: unknown;
      accessKeyId?: unknown;
      secretAccessKey?: unknown;
      region?: unknown;
      projectId?: unknown;
      location?: unknown;
    },
    providerConfig?: Record<string, unknown>,
  ): void {
    if (['AZURE_OPENAI', 'OPENAI_COMPATIBLE'].includes(type) && !baseUrl) {
      throw new BadRequestException('baseUrl is required for this provider type');
    }
    this.validateBaseUrl(type, baseUrl, credentials.region);
    const geminiEnterprise = type === 'GOOGLE_GEMINI' && isGeminiEnterprise(providerConfig);
    if (type !== 'OLLAMA' && !credentials.apiKey && type !== 'AWS_BEDROCK' && !geminiEnterprise) {
      throw new BadRequestException('apiKey is required for this provider type');
    }
    if (type === 'GOOGLE_GEMINI') {
      if (geminiEnterprise) {
        if (credentials.apiKey) {
          throw new BadRequestException('Gemini Vertex ADC connections must not include an apiKey');
        }
        if (!nonEmptyString(credentials.projectId) || !nonEmptyString(credentials.location)) {
          throw new BadRequestException(
            'Gemini Vertex ADC requires credentials.projectId and credentials.location',
          );
        }
      } else if (credentials.projectId || credentials.location) {
        throw new BadRequestException(
          'Gemini projectId/location require config.enterprise to be enabled',
        );
      }
    }
    if (type === 'AWS_BEDROCK' && (!credentials.accessKeyId || !credentials.secretAccessKey)) {
      throw new BadRequestException('AWS accessKeyId and secretAccessKey are required');
    }
    if (
      type === 'AWS_BEDROCK' &&
      (typeof credentials.region !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)+-\d+$/.test(credentials.region))
    ) {
      throw new BadRequestException('AWS region is required');
    }
    if (type === 'AWS_BEDROCK') {
      this.validateBedrockConfigEndpoint(providerConfig, credentials.region);
    }
  }

  private validateBaseUrl(type: ProviderType, baseUrl?: string, region?: unknown): void {
    if (!baseUrl) {
      if (type === 'OLLAMA') {
        throw new BadRequestException('baseUrl is required for Ollama providers');
      }
      return;
    }
    if (type === 'OLLAMA') {
      assertSafeProviderBaseUrl(baseUrl, true);
      if (!this.isAllowedOllamaBaseUrl(baseUrl)) {
        throw new BadRequestException(
          'Ollama baseUrl is not in the deployment OLLAMA_ALLOWED_BASE_URLS allowlist',
        );
      }
      return;
    }
    if (type === 'GOOGLE_GEMINI') {
      const url = assertSafeProviderBaseUrl(baseUrl, false);
      const host = url.hostname.toLowerCase();
      if (
        host !== 'generativelanguage.googleapis.com' &&
        host !== 'aiplatform.googleapis.com' &&
        !host.endsWith('-aiplatform.googleapis.com')
      ) {
        throw new BadRequestException(
          'Gemini custom baseUrl must use an official Google API endpoint',
        );
      }
      return;
    }
    if (type === 'AWS_BEDROCK') {
      const allowCustom = this.isAllowedBedrockEndpoint(baseUrl);
      assertAllowedBedrockEndpoint(baseUrl, {
        allowCustom,
        region: nonEmptyString(region) ? region : undefined,
      });
      return;
    }
    assertSafeProviderBaseUrl(baseUrl, false);
  }

  private isAllowedOllamaBaseUrl(baseUrl?: string): boolean {
    if (!baseUrl) return false;
    const normalized = normalizeBaseUrl(baseUrl);
    return this.config
      .get<string>('OLLAMA_ALLOWED_BASE_URLS', '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .some((value) => normalizeBaseUrl(value) === normalized);
  }

  private isAllowedBedrockEndpoint(endpoint?: string): boolean {
    if (!endpoint) return false;
    const normalized = normalizeBaseUrl(endpoint);
    return this.config
      .get<string>('BEDROCK_ALLOWED_ENDPOINTS', '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .some((value) => normalizeBaseUrl(value) === normalized);
  }

  private validateBedrockConfigEndpoint(config?: Record<string, unknown>, region?: unknown): void {
    if (!config || config.endpoint === undefined) return;
    if (typeof config.endpoint !== 'string' || !config.endpoint.trim()) {
      throw new BadRequestException('Bedrock config.endpoint must be a URL');
    }
    const allowCustom = this.isAllowedBedrockEndpoint(config.endpoint);
    assertAllowedBedrockEndpoint(config.endpoint, {
      allowCustom,
      region: nonEmptyString(region) ? region : undefined,
    });
  }

  private fingerprint(
    type: ProviderType,
    credentials: {
      apiKey?: unknown;
      secretAccessKey?: unknown;
      projectId?: unknown;
    },
  ): string {
    const rawSecret = credentials.apiKey ?? credentials.secretAccessKey;
    const secret =
      typeof rawSecret === 'string'
        ? rawSecret
        : type === 'GOOGLE_GEMINI' && nonEmptyString(credentials.projectId)
          ? `vertex:${credentials.projectId}`
          : `${type}:credentialless`;
    return this.crypto.fingerprintSecret(secret);
  }

  private validatePublicConfig(config?: Record<string, unknown>): void {
    if (!config) return;
    validatePricing(config.pricing);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (/(secret|password|api.?key|authorization|credential|token)/i.test(key)) {
          throw new BadRequestException(`Sensitive field ${key} must be supplied in credentials`);
        }
        visit(child);
      }
    };
    visit(config);
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function validatePricing(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('config.pricing must be an object');
  }
  for (const [model, modelPricing] of Object.entries(value)) {
    if (!modelPricing || typeof modelPricing !== 'object' || Array.isArray(modelPricing)) {
      throw new BadRequestException(`Pricing for ${model} must be an object`);
    }
    for (const field of ['inputPerMillion', 'outputPerMillion']) {
      const price = (modelPricing as Record<string, unknown>)[field];
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
        throw new BadRequestException(`Pricing ${model}.${field} must be a non-negative number`);
      }
    }
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function isGeminiEnterprise(config?: Record<string, unknown>): boolean {
  return config?.enterprise === true || config?.vertexai === true;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function stringConfigValue(
  config: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = config?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredWorkspace(tenant: TenantContext): string {
  if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
  return tenant.workspaceId;
}
