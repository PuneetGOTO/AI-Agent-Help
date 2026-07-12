import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const apiBaseUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const apiOrigin = new URL(apiBaseUrl).origin;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const mockProviderUrl = process.env.E2E_MOCK_PROVIDER_URL;
const liveAgentId = process.env.E2E_LIVE_AGENT_ID;

function unwrap<T = Record<string, unknown>>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function accessTokenFrom(value: unknown): string | undefined {
  const body = unwrap<Record<string, unknown>>(value);
  const token = body?.accessToken;
  return typeof token === 'string' ? token : undefined;
}

interface AuthenticatedSession {
  accessToken?: string;
  organizationId: string;
  workspaceId: string;
}

async function login(request: APIRequestContext): Promise<AuthenticatedSession> {
  const response = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = unwrap<Record<string, unknown>>(await response.json());
  expect(body.activeOrganizationId).toEqual(expect.any(String));
  expect(body.activeWorkspaceId).toEqual(expect.any(String));
  return {
    accessToken: accessTokenFrom(body),
    organizationId: String(body.activeOrganizationId),
    workspaceId: String(body.activeWorkspaceId),
  };
}

function authHeaders(session: AuthenticatedSession): Record<string, string> {
  return {
    ...(session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    'X-Organization-Id': session.organizationId,
    'X-Workspace-Id': session.workspaceId,
  };
}

test.describe('public platform contract', () => {
  test('health endpoint reports a live API', async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/health`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(await response.json()).toEqual(expect.any(Object));
  });

  test('bootstrap status is public and returns initialization state', async ({ request }) => {
    const response = await request.get(`${apiBaseUrl}/auth/bootstrap/status`);

    expect(response.status()).toBe(200);
    const body = unwrap<Record<string, unknown>>(await response.json());
    expect(typeof body.initialized).toBe('boolean');
  });

  test('session restore reports an anonymous browser without an authorization error', async ({
    request,
  }) => {
    const response = await request.post(`${apiBaseUrl}/auth/session`);

    expect(response.status()).toBe(200);
    expect(unwrap(await response.json())).toMatchObject({ authenticated: false });
  });

  test('OpenAPI document is exposed without credentials', async ({ request }) => {
    const response = await request.get(`${apiOrigin}/docs-json`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.openapi).toMatch(/^3\./);
    expect(body.paths).toHaveProperty('/api/v1/health');
  });

  test('protected tenant resources reject anonymous access', async ({ request }) => {
    for (const path of ['/agents', '/providers', '/usage/summary', '/audit-logs']) {
      const response = await request.get(`${apiBaseUrl}${path}`, {
        headers: {
          'X-Organization-Id': '00000000-0000-4000-8000-000000000001',
          'X-Workspace-Id': '00000000-0000-4000-8000-000000000002',
        },
      });
      expect(response.status(), `${path} must require authentication`).toBe(401);
    }
  });

  test('malformed credentials are rejected without leaking secrets', async ({ request }) => {
    const response = await request.post(`${apiBaseUrl}/auth/login`, {
      data: { email: 'not-an-email', password: 'x' },
    });

    expect([400, 401]).toContain(response.status());
    const text = await response.text();
    expect(text).not.toContain('JWT_ACCESS_SECRET');
    expect(text).not.toContain('DATABASE_URL');
  });
});

test.describe('authenticated administrator smoke', () => {
  test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');

  test('seeded administrator can log in and read their profile', async ({ request }) => {
    const session = await login(request);
    const response = await request.get(`${apiBaseUrl}/auth/me`, {
      headers: session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : undefined,
    });

    expect(response.status(), await response.text()).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body.toLowerCase()).toContain(adminEmail!.toLowerCase());
    expect(body).not.toContain(adminPassword!);
  });

  test('provider credential is write-only throughout its lifecycle', async ({ request }) => {
    const session = await login(request);
    const secret = `sk-e2e-${randomUUID()}`;
    const createResponse = await request.post(`${apiBaseUrl}/providers`, {
      headers: authHeaders(session),
      data: {
        name: `E2E Provider ${randomUUID().slice(0, 8)}`,
        type: 'OPENAI_COMPATIBLE',
        baseUrl: 'https://example.com/v1',
        credentials: { apiKey: secret },
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const provider = unwrap<Record<string, unknown>>(await createResponse.json());
    expect(provider.id).toEqual(expect.any(String));
    expect(JSON.stringify(provider)).not.toContain(secret);
    expect(provider).not.toHaveProperty('credentials');
    expect(provider).not.toHaveProperty('credentialsEncrypted');

    try {
      const listResponse = await request.get(`${apiBaseUrl}/providers`, {
        headers: authHeaders(session),
      });
      expect(listResponse.status(), await listResponse.text()).toBe(200);
      const listBody = JSON.stringify(await listResponse.json());
      expect(listBody).toContain(String(provider.id));
      expect(listBody).not.toContain(secret);
      expect(listBody).not.toContain('credentialsEncrypted');
    } finally {
      const deleteResponse = await request.delete(
        `${apiBaseUrl}/providers/${String(provider.id)}`,
        {
          headers: authHeaders(session),
        },
      );
      expect(deleteResponse.status(), await deleteResponse.text()).toBe(204);
    }
  });

  test('an authenticated user cannot select a workspace outside their organization', async ({
    request,
  }) => {
    const session = await login(request);
    const response = await request.get(`${apiBaseUrl}/agents`, {
      headers: {
        ...authHeaders(session),
        'X-Workspace-Id': randomUUID(),
      },
    });

    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain('credentialsEncrypted');
  });

  test('agent version, publish, chat, SSE and rollback use the provider adapter', async ({
    request,
  }) => {
    test.skip(!mockProviderUrl, 'Set E2E_MOCK_PROVIDER_URL to the OpenAI-compatible fixture.');
    const session = await login(request);
    const providerResponse = await request.post(`${apiBaseUrl}/providers`, {
      headers: authHeaders(session),
      data: {
        name: `E2E Runtime ${randomUUID().slice(0, 8)}`,
        type: 'OLLAMA',
        baseUrl: mockProviderUrl,
        credentials: {},
      },
    });
    expect(providerResponse.status(), await providerResponse.text()).toBe(201);
    const provider = unwrap<Record<string, unknown>>(await providerResponse.json());

    const validationResponse = await request.post(
      `${apiBaseUrl}/providers/${String(provider.id)}/validate`,
      { headers: authHeaders(session) },
    );
    expect(validationResponse.status(), await validationResponse.text()).toBe(200);
    expect(await validationResponse.json()).toMatchObject({ valid: true });

    const knowledgeResponse = await request.post(`${apiBaseUrl}/knowledge-bases`, {
      headers: authHeaders(session),
      data: {
        name: `E2E Knowledge ${randomUUID().slice(0, 8)}`,
        description: 'Tenant-scoped lexical retrieval fixture',
      },
    });
    expect(knowledgeResponse.status(), await knowledgeResponse.text()).toBe(201);
    const knowledgeBase = unwrap<Record<string, unknown>>(await knowledgeResponse.json());

    const uploadResponse = await request.post(
      `${apiBaseUrl}/knowledge-bases/${String(knowledgeBase.id)}/documents`,
      {
        headers: authHeaders(session),
        multipart: {
          file: {
            name: 'e2e-knowledge.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(
              'The hello from sync e2e retrieval marker belongs only to this workspace.',
            ),
          },
        },
      },
    );
    expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
    const document = unwrap<Record<string, unknown>>(await uploadResponse.json());
    expect(document.status).toBe('READY');
    expect((document._count as Record<string, unknown>).chunks).toBe(1);

    const createResponse = await request.post(`${apiBaseUrl}/agents`, {
      headers: authHeaders(session),
      data: {
        name: `E2E Agent ${randomUUID().slice(0, 8)}`,
        description: 'Playwright lifecycle fixture',
        tags: ['e2e'],
        providerConnectionId: provider.id,
        model: 'e2e-model',
        systemPrompt: 'Answer briefly and do not call tools.',
        temperature: 0,
        maxTokens: 128,
        streamEnabled: true,
        memoryMode: 'SHORT_TERM',
        knowledgeBaseIds: [knowledgeBase.id],
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const created = unwrap<Record<string, unknown>>(await createResponse.json());
    const versionOne = created.currentVersion as Record<string, unknown>;
    expect(versionOne.version).toBe(1);

    const versionResponse = await request.post(
      `${apiBaseUrl}/agents/${String(created.id)}/versions`,
      {
        headers: authHeaders(session),
        data: {
          systemPrompt: 'Answer in one concise sentence and do not call tools.',
          changeNote: 'E2E publish candidate',
        },
      },
    );
    expect(versionResponse.status(), await versionResponse.text()).toBe(201);
    const versionTwo = unwrap<Record<string, unknown>>(await versionResponse.json());
    expect(versionTwo.version).toBe(2);

    const publishResponse = await request.post(
      `${apiBaseUrl}/agents/${String(created.id)}/publish`,
      {
        headers: authHeaders(session),
        data: { versionId: versionTwo.id },
      },
    );
    expect(publishResponse.status(), await publishResponse.text()).toBe(200);
    const published = unwrap<Record<string, unknown>>(await publishResponse.json());
    expect((published.publishedVersion as Record<string, unknown>).id).toBe(versionTwo.id);

    const chatResponse = await request.post(`${apiBaseUrl}/agents/${String(created.id)}/chat`, {
      headers: authHeaders(session),
      data: { message: 'hello from sync e2e' },
    });
    expect(chatResponse.status(), await chatResponse.text()).toBe(200);
    const chat = unwrap<Record<string, unknown>>(await chatResponse.json());
    expect((chat.message as Record<string, unknown>).content).toContain('hello from sync e2e');
    expect((chat.message as Record<string, unknown>).content).toContain(
      '[knowledge-context-present]',
    );
    expect((chat.usage as Record<string, unknown>).totalTokens).toBe(13);

    const streamResponse = await request.post(
      `${apiBaseUrl}/agents/${String(created.id)}/chat/stream`,
      {
        headers: authHeaders(session),
        data: { message: 'hello from stream e2e', debug: true },
        timeout: 20_000,
      },
    );
    expect(streamResponse.status(), await streamResponse.text()).toBe(200);
    expect(streamResponse.headers()['content-type']).toContain('text/event-stream');
    const stream = await streamResponse.text();
    expect(stream).toContain('event: meta');
    expect(stream).toContain('event: token');
    expect(stream).toContain('hello from stream e2e');
    expect(stream).toContain('event: usage');
    expect(stream).toContain('event: done');

    const rollbackResponse = await request.post(
      `${apiBaseUrl}/agents/${String(created.id)}/rollback`,
      {
        headers: authHeaders(session),
        data: { versionId: versionOne.id },
      },
    );
    expect(rollbackResponse.status(), await rollbackResponse.text()).toBe(200);
    const rolledBack = unwrap<Record<string, unknown>>(await rollbackResponse.json());
    expect((rolledBack.publishedVersion as Record<string, unknown>).id).toBe(versionOne.id);

    const deleteResponse = await request.delete(`${apiBaseUrl}/agents/${String(created.id)}`, {
      headers: authHeaders(session),
    });
    expect(deleteResponse.status(), await deleteResponse.text()).toBe(204);
  });

  test('configured live provider streams a real model response', async ({ request }) => {
    test.skip(!liveAgentId, 'Set E2E_LIVE_AGENT_ID in a protected canary environment.');
    const session = await login(request);
    const response = await request.post(`${apiBaseUrl}/agents/${liveAgentId}/chat/stream`, {
      headers: authHeaders(session),
      data: { message: 'Reply with the single word OK.' },
      timeout: 120_000,
    });

    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/event-stream');
    const stream = await response.text();
    expect(stream).toContain('event: token');
    expect(stream).toContain('event: usage');
    expect(stream).toContain('event: done');
    expect(stream).not.toContain('event: error');
  });
});

test.describe('web application smoke', () => {
  test('login screen exposes functional credential controls', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });

  test('desktop layout does not overflow horizontally', async ({ page }) => {
    await page.goto('/login');
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });

  test('authenticated mobile dashboard is usable without browser errors or overflow', async ({
    page,
  }) => {
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(adminEmail!);
    await page.locator('input[type="password"]').fill(adminPassword!);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.clientWidth).toBe(390);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    expect(browserErrors).toEqual([]);
  });
});
