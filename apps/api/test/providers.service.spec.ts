import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ProviderType, type ProviderConnection } from '@prisma/client';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { TenantContext } from '../src/common/tenancy/tenancy.types';
import type { ProviderRegistryService } from '../src/modules/providers/provider-registry.service';
import { ProvidersService } from '../src/modules/providers/providers.service';

const tenant: TenantContext = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  membershipId: 'membership-1',
  roleId: 'role-1',
  roleName: 'OWNER',
  permissions: [],
};

describe('ProvidersService Ollama egress policy', () => {
  function setup(allowlist: string, connection?: ProviderConnection, bedrockAllowlist = '') {
    const row =
      connection ??
      ({
        id: 'provider-1',
        workspaceId: tenant.workspaceId,
        name: 'Local Ollama',
        type: ProviderType.OLLAMA,
        baseUrl: 'http://127.0.0.1:11434/v1',
        credentialsEncrypted: 'encrypted',
        credentialFingerprint: 'fingerprint',
        config: null,
        isEnabled: true,
        lastValidatedAt: null,
        lastValidationError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ProviderConnection);
    const createProvider = jest.fn().mockResolvedValue(row);
    const prisma = {
      providerConnection: {
        create: createProvider,
        findFirst: jest.fn().mockResolvedValue(row),
      },
    } as unknown as PrismaService;
    const crypto = {
      encryptJson: jest.fn().mockReturnValue('encrypted'),
      fingerprintSecret: jest.fn().mockReturnValue('fingerprint'),
      decryptJson: jest.fn().mockReturnValue({}),
    } as unknown as CryptoService;
    const registry = {
      capabilities: jest.fn().mockReturnValue({ chat: true }),
    } as unknown as ProviderRegistryService;
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'OLLAMA_ALLOWED_BASE_URLS') return allowlist;
        if (key === 'BEDROCK_ALLOWED_ENDPOINTS') return bedrockAllowlist;
        return fallback;
      }),
    } as unknown as ConfigService;
    return { service: new ProvidersService(prisma, crypto, registry, config), createProvider };
  }

  it('rejects tenant-selected private endpoints outside the deployment allowlist', async () => {
    const { service, createProvider } = setup('http://127.0.0.1:11434/v1');

    await expect(
      service.create(tenant, {
        name: 'Metadata',
        type: ProviderType.OLLAMA,
        baseUrl: 'http://169.254.169.254/latest',
        credentials: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('accepts an exact normalized deployment allowlist match', async () => {
    const { service } = setup('http://127.0.0.1:11434/v1/');

    await expect(
      service.create(tenant, {
        name: 'Local Ollama',
        type: ProviderType.OLLAMA,
        baseUrl: 'http://127.0.0.1:11434/v1',
        credentials: {},
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'provider-1' }));
  });

  it('revalidates stored rows when constructing a runtime', async () => {
    const unsafe = {
      id: 'provider-2',
      workspaceId: tenant.workspaceId,
      type: ProviderType.OLLAMA,
      baseUrl: 'http://169.254.169.254/latest',
      isEnabled: true,
    } as ProviderConnection;
    const { service } = setup('http://127.0.0.1:11434/v1', unsafe);

    await expect(
      service.runtimeForWorkspace('22222222-2222-4222-8222-222222222222', unsafe.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects negative pricing metadata that could reduce recorded cost', async () => {
    const { service } = setup('http://127.0.0.1:11434/v1');

    await expect(
      service.create(tenant, {
        name: 'OpenAI',
        type: ProviderType.OPENAI,
        credentials: { apiKey: 'test-key' },
        config: { pricing: { model: { inputPerMillion: -1 } } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects tenant-controlled Gemini proxy endpoints that could redirect to private networks', async () => {
    const { service, createProvider } = setup('http://127.0.0.1:11434/v1');

    await expect(
      service.create(tenant, {
        name: 'Gemini proxy',
        type: ProviderType.GOOGLE_GEMINI,
        baseUrl: 'https://tenant-proxy.example.com',
        credentials: { apiKey: 'test-key' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('accepts explicit Gemini Vertex ADC credentials without storing an API key', async () => {
    const { service, createProvider } = setup('http://127.0.0.1:11434/v1');

    await expect(
      service.create(tenant, {
        name: 'Vertex AI',
        type: ProviderType.GOOGLE_GEMINI,
        credentials: { projectId: 'project-1', location: 'us-central1' },
        config: { enterprise: true },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'provider-1' }));
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ config: { enterprise: true } }),
      }),
    );
  });

  it('keeps Gemini API-key and Vertex ADC credential modes mutually exclusive', async () => {
    const { service, createProvider } = setup('http://127.0.0.1:11434/v1');

    await expect(
      service.create(tenant, {
        name: 'Mixed Gemini',
        type: ProviderType.GOOGLE_GEMINI,
        credentials: {
          apiKey: 'must-not-be-stored',
          projectId: 'project-1',
          location: 'us-central1',
        },
        config: { enterprise: true },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('restricts Bedrock custom endpoints to AWS hosts or an exact deployment allowlist', async () => {
    const credentials = {
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    };
    const rejected = setup('http://127.0.0.1:11434/v1');
    await expect(
      rejected.service.create(tenant, {
        name: 'Untrusted Bedrock',
        type: ProviderType.AWS_BEDROCK,
        baseUrl: 'https://provider-proxy.example.com',
        credentials,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const official = setup('http://127.0.0.1:11434/v1');
    await expect(
      official.service.create(tenant, {
        name: 'AWS Bedrock',
        type: ProviderType.AWS_BEDROCK,
        baseUrl: 'https://bedrock.us-east-1.amazonaws.com',
        credentials,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'provider-1' }));

    await expect(
      official.service.create(tenant, {
        name: 'Wrong region Bedrock',
        type: ProviderType.AWS_BEDROCK,
        baseUrl: 'https://bedrock.eu-west-1.amazonaws.com',
        credentials,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const allowlisted = setup(
      'http://127.0.0.1:11434/v1',
      undefined,
      'https://bedrock-proxy.example.com/',
    );
    await expect(
      allowlisted.service.create(tenant, {
        name: 'Allowlisted Bedrock',
        type: ProviderType.AWS_BEDROCK,
        baseUrl: 'https://bedrock-proxy.example.com',
        credentials,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'provider-1' }));
  });
});
