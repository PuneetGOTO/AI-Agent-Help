import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAiCompatibleAdapter } from '../src/modules/providers/openai-compatible.adapter';
import type { ProviderRuntimeConfig } from '../src/modules/providers/provider.types';

describe('OpenAiCompatibleAdapter integration', () => {
  let server: Server;
  let config: ProviderRuntimeConfig;
  let lastRequestBody: Record<string, unknown> = {};

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.headers.authorization !== 'Bearer test-key') {
          response.writeHead(401).end();
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        lastRequestBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (request.url === '/v1/models') {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ data: [{ id: 'model-test' }] }));
          return;
        }
        if (request.url === '/v1/embeddings') {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              data: [{ embedding: [0.1, 0.2] }],
              usage: { prompt_tokens: 2, total_tokens: 2 },
            }),
          );
          return;
        }
        if (request.url === '/v1/chat/completions' && lastRequestBody.stream === true) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`,
          );
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
          );
          response.end('data: [DONE]\n\n');
          return;
        }
        if (request.url === '/v1/chat/completions') {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              model: 'model-test',
              choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            }),
          );
          return;
        }
        response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    config = {
      id: 'provider-1',
      type: 'OLLAMA',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      credentials: { apiKey: 'test-key' },
      allowPrivateNetwork: true,
    };
  });

  afterAll(
    async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  it('lists models and normalizes a non-streaming chat response', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    await expect(adapter.listModels(config)).resolves.toEqual([
      expect.objectContaining({ id: 'model-test' }),
    ]);
    const response = await adapter.chat(config, {
      model: 'model-test',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response.content).toBe('Hello world');
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  });

  it('parses streamed tokens and usage across SSE chunks', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    const events = [];
    for await (const event of adapter.streamChat(config, {
      model: 'model-test',
      messages: [{ role: 'user', content: 'Hi' }],
    }))
      events.push(event);

    expect(events.filter((event) => event.type === 'token')).toEqual([
      { type: 'token', content: 'Hello' },
      { type: 'token', content: ' world' },
    ]);
    expect(events).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(events).toContainEqual({ type: 'done', finishReason: 'stop' });
  });

  it('sends strict JSON schema output configuration and normalizes embeddings', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    await adapter.chat(config, {
      model: 'model-test',
      messages: [{ role: 'user', content: 'Hi' }],
      responseSchema: { type: 'object', additionalProperties: false },
    });
    expect(lastRequestBody.response_format).toEqual(
      expect.objectContaining({ type: 'json_schema' }),
    );
    await expect(
      adapter.embeddings(config, { model: 'embed-test', input: ['one'] }),
    ).resolves.toEqual({
      embeddings: [[0.1, 0.2]],
      usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
    });
  });

  it('rejects oversized requests before contacting the provider', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    await expect(
      adapter.chat(config, {
        model: 'model-test',
        messages: [{ role: 'user', content: 'x'.repeat(5_100_000) }],
      }),
    ).rejects.toThrow('size limit');
    await expect(
      adapter.embeddings(config, { model: 'embed-test', input: ['x'.repeat(1_000_001)] }),
    ).rejects.toThrow('size limit');
  });
});
