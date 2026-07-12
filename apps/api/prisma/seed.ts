import { PrismaClient, ProviderType } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PERMISSIONS, PRESET_ROLE_PERMISSIONS } from '@agent-platform/shared';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ path: resolve(process.cwd(), '.env'), quiet: true, override: true });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const production = process.env.NODE_ENV === 'production';
  const email = requiredForProduction('ADMIN_EMAIL', 'admin@example.com', production)
    .trim()
    .toLowerCase();
  const password = requiredForProduction('ADMIN_PASSWORD', 'ChangeMe123!', production);
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD must not exceed 72 UTF-8 bytes');
  }
  const organizationName = process.env.DEFAULT_ORGANIZATION_NAME || 'Acme Corporation';
  const workspaceName = process.env.DEFAULT_WORKSPACE_NAME || 'AI Operations';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { name: process.env.ADMIN_NAME || 'Platform Administrator' },
    create: {
      email,
      passwordHash,
      name: process.env.ADMIN_NAME || 'Platform Administrator',
    },
  });
  const organization = await prisma.organization.upsert({
    where: { slug: 'default-organization' },
    update: { name: organizationName },
    create: { name: organizationName, slug: 'default-organization' },
  });
  const roleIds = await seedRoles(organization.id);
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: {},
    create: { organizationId: organization.id, userId: user.id, roleId: roleIds.OWNER! },
  });
  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: 'ai-operations' } },
    update: { name: workspaceName },
    create: {
      organizationId: organization.id,
      name: workspaceName,
      slug: 'ai-operations',
      allowedToolDomains: ['httpbin.org'],
    },
  });

  if (process.env.OPENAI_API_KEY) {
    const key = encryptionKey();
    await prisma.providerConnection.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: 'OpenAI' } },
      update: {},
      create: {
        workspaceId: workspace.id,
        name: 'OpenAI',
        type: ProviderType.OPENAI,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        credentialsEncrypted: encryptJson({ apiKey: process.env.OPENAI_API_KEY }, key),
        credentialFingerprint: createHash('sha256')
          .update(process.env.OPENAI_API_KEY)
          .digest('hex')
          .slice(0, 12),
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: 'database.seed',
      resourceType: 'workspace',
      resourceId: workspace.id,
    },
  });
  process.stdout.write(
    `Seeded admin ${email}, organization ${organization.id}, workspace ${workspace.id}\n`,
  );
}

async function seedRoles(organizationId: string): Promise<Record<string, string>> {
  const permissionRows = await Promise.all(
    Object.values(PERMISSIONS).map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Allows ${key.replace(':', ' operations on ')}` },
      }),
    ),
  );
  const ids = new Map(permissionRows.map((row) => [row.key, row.id]));
  const roles: Record<string, string> = {};
  for (const [name, permissions] of Object.entries(PRESET_ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: { isSystem: true },
      create: { organizationId, name, description: `${name} built-in role`, isSystem: true },
    });
    roles[name] = role.id;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: role.id,
        permissionId: ids.get(permission)!,
      })),
      skipDuplicates: true,
    });
  }
  return roles;
}

function encryptionKey(): Buffer {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) throw new Error('ENCRYPTION_KEY is required to seed an OpenAI credential');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

function encryptJson(value: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function requiredForProduction(name: string, fallback: string, production: boolean): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (production) throw new Error(`${name} is required when seeding a production environment`);
  return fallback;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Seed failed'}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
