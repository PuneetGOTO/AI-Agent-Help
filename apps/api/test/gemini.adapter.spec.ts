import { GeminiAdapter, type GeminiClient } from '../src/modules/providers/gemini.adapter';
import type {
  ProviderChatRequest,
  ProviderRuntimeConfig,
  ProviderToolDefinition,
} from '../src/modules/providers/provider.types';

describe('GeminiAdapter', () => {
  const calls: Record<string, unknown>[] = [];
  const client: GeminiClient = {
    models: {
      async generateContent(params) {
        await Promise.resolve();
        calls.push(params);
        return {
          modelVersion: 'gemini-2.5-flash',
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Hello ' },
                  { functionCall: { id: 'call-1', name: 'lookup', args: { q: 'status' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 4,
            totalTokenCount: 11,
          },
        };
      },
      async generateContentStream(params) {
        await Promise.resolve();
        calls.push(params);
        return (async function* () {
          await Promise.resolve();
          yield {
            candidates: [{ content: { parts: [{ text: 'Hel' }] } }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
          };
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'lo' },
                    { functionCall: { id: 'call-1', name: 'lookup', args: { q: 'x' } } },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
          };
        })();
      },
      async embedContent(params) {
        await Promise.resolve();
        calls.push(params);
        return {
          embeddings: [
            { values: [0.1, 0.2], statistics: { tokenCount: 2 } },
            { values: [0.3], statistics: { tokenCount: 3 } },
          ],
          metadata: { billableCharacterCount: 3 },
        };
      },
      async list() {
        await Promise.resolve();
        return {
          page: [
            { name: 'models/gemini-2.5-flash', displayName: 'Gemini Flash' },
            { name: 'models/gemini-embedding-001' },
          ],
        };
      },
    },
  };

  const config: ProviderRuntimeConfig = {
    id: 'gemini-1',
    type: 'GOOGLE_GEMINI',
    baseUrl: 'https://gemini.test.example/v1beta',
    credentials: { apiKey: 'secret-key' },
  };

  beforeEach(() => calls.splice(0));

  function adapter(): GeminiAdapter {
    return new GeminiAdapter(
      () => client,
      async () => {
        await Promise.resolve();
      },
    );
  }

  it('maps roles, tools and structured output to the Gemini request', async () => {
    const request: ProviderChatRequest = {
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Check status' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call-0',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"status"}' },
            },
          ],
        },
        { role: 'tool', toolCallId: 'call-0', content: '{"ok":true}' },
      ],
      temperature: 0.4,
      maxTokens: 100,
      tools: [tool('lookup')],
      responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      timeoutMs: 5_000,
    };

    const response = await adapter().chat(config, request);
    const payload = calls[0] as { contents: unknown[]; config: Record<string, unknown> };
    expect(payload.contents).toEqual([
      { role: 'user', parts: [{ text: 'Check status' }] },
      {
        role: 'model',
        parts: [{ functionCall: { id: 'call-0', name: 'lookup', args: { q: 'status' } } }],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { id: 'call-0', name: 'lookup', response: { ok: true } } }],
      },
    ]);
    expect(payload.config.systemInstruction).toEqual({ parts: [{ text: 'Be concise' }] });
    expect(payload.config.responseMimeType).toBe('application/json');
    expect(payload.config.responseJsonSchema).toEqual(request.responseSchema);
    expect(payload.config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'lookup',
            description: 'Lookup a status',
            parametersJsonSchema: { type: 'object', properties: { q: { type: 'string' } } },
          },
        ],
      },
    ]);
    expect(response).toEqual({
      content: 'Hello ',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"status"}' },
        },
      ],
      usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 },
      model: 'gemini-2.5-flash',
      finishReason: 'STOP',
    });
  });

  it('streams text, usage and one normalized function call', async () => {
    const events = [];
    for await (const event of adapter().streamChat(config, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event);
    }
    expect(events.filter((event) => event.type === 'token')).toEqual([
      { type: 'token', content: 'Hel' },
      { type: 'token', content: 'lo' },
    ]);
    expect(events).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    });
    expect(events).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    });
    expect(events).toContainEqual({
      type: 'tool_call',
      toolCall: {
        id: 'call-1',
        type: 'function',
        function: { name: 'lookup', arguments: '{"q":"x"}' },
      },
    });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'STOP' });
  });

  it('lists models, embeds content and reports conservative capabilities', async () => {
    await expect(adapter().listModels(config)).resolves.toEqual([
      expect.objectContaining({ id: 'gemini-2.5-flash', name: 'Gemini Flash' }),
      expect.objectContaining({ id: 'gemini-embedding-001', name: 'gemini-embedding-001' }),
    ]);
    await expect(
      adapter().embeddings(config, { model: 'gemini-embedding-001', input: ['one', 'two'] }),
    ).resolves.toEqual({
      embeddings: [[0.1, 0.2], [0.3]],
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
    });
    expect(adapter().capabilityDetection('gemini-2.5-flash')).toMatchObject({
      chat: true,
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
    });
    expect(adapter().capabilityDetection('gemini-embedding-001')).toMatchObject({
      chat: false,
      embeddings: true,
      toolCalling: false,
      structuredOutput: false,
    });
    expect(adapter().capabilityDetection('unknown-model')).toEqual({
      chat: false,
      streaming: false,
      embeddings: false,
      toolCalling: false,
      structuredOutput: false,
      vision: false,
      modelListing: true,
    });
  });

  it('splits Vertex Gemini embedding batches and aggregates statistics token usage', async () => {
    const embedContent = jest.fn((params: Record<string, unknown>) => {
      const contents = params.contents as string[];
      const tokenCount = contents[0] === 'one' ? 2 : 3;
      return Promise.resolve({
        embeddings: [{ values: [tokenCount / 10], statistics: { tokenCount } }],
      });
    });
    const vertexClient: GeminiClient = {
      models: {
        generateContent: (params) => client.models.generateContent(params),
        generateContentStream: (params) => client.models.generateContentStream(params),
        list: (params) => client.models.list(params),
        embedContent,
      },
    };
    const vertexAdapter = new GeminiAdapter(
      () => vertexClient,
      async () => Promise.resolve(),
    );

    await expect(
      vertexAdapter.embeddings(
        {
          id: 'gemini-vertex',
          type: 'GOOGLE_GEMINI',
          baseUrl: 'https://us-central1-aiplatform.googleapis.com',
          credentials: { projectId: 'project-1', location: 'us-central1' },
          config: { enterprise: true },
        },
        { model: 'gemini-embedding-2-preview', input: ['one', 'two'] },
      ),
    ).resolves.toEqual({
      embeddings: [[0.2], [0.3]],
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
    });
    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(embedContent.mock.calls.map(([params]) => params.contents)).toEqual([['one'], ['two']]);
  });

  it('embeds Vertex single-content models sequentially and sums embedding token usage', async () => {
    const vertexCalls: Record<string, unknown>[] = [];
    const vertexClient: GeminiClient = {
      models: {
        ...client.models,
        async embedContent(params) {
          await Promise.resolve();
          vertexCalls.push(params);
          const content = (params.contents as string[])[0];
          return {
            embeddings: [
              {
                values: content === 'one' ? [0.1] : [0.2],
                statistics: { tokenCount: content === 'one' ? 3 : 5 },
              },
            ],
          };
        },
      },
    };
    const vertexConfig: ProviderRuntimeConfig = {
      ...config,
      baseUrl: null,
      credentials: { projectId: 'project-1', location: 'us-central1' },
      config: { enterprise: true },
    };
    const vertexAdapter = new GeminiAdapter(
      () => vertexClient,
      async () => Promise.resolve(),
    );

    await expect(
      vertexAdapter.embeddings(vertexConfig, {
        model: 'gemini-embedding-2-preview',
        input: ['one', 'two'],
      }),
    ).resolves.toEqual({
      embeddings: [[0.1], [0.2]],
      usage: { inputTokens: 8, outputTokens: 0, totalTokens: 8 },
    });
    expect(vertexCalls.map((call) => call.contents)).toEqual([['one'], ['two']]);
  });

  it('enforces separate Developer API key and Vertex ADC credential contracts', async () => {
    await expect(adapter().listModels({ ...config, credentials: {} })).rejects.toThrow(
      'Developer API key',
    );
    await expect(
      adapter().listModels({
        ...config,
        credentials: { location: 'us-central1' },
        config: { enterprise: true },
      }),
    ).rejects.toThrow('project');
    await expect(
      adapter().listModels({
        ...config,
        credentials: { projectId: 'project-1' },
        config: { vertexai: true },
      }),
    ).rejects.toThrow('location');
    await expect(
      adapter().listModels({
        ...config,
        baseUrl: null,
        credentials: { projectId: 'project-1', location: 'us-central1' },
        config: { vertexai: true },
      }),
    ).resolves.toHaveLength(2);
  });

  it('normalizes errors without returning SDK messages or credentials', () => {
    const normalized = adapter().normalizeError({
      status: 401,
      message: 'x-goog-api-key=secret-key leaked in response',
    });
    expect(normalized).toEqual({
      code: 'PROVIDER_AUTH_FAILED',
      message: 'Gemini credential was rejected',
      retryable: false,
      statusCode: 401,
    });
    expect(JSON.stringify(normalized)).not.toContain('secret-key');
  });

  it('rejects a private custom endpoint before constructing the SDK client', async () => {
    const factory = jest.fn(() => client);
    const unsafe = new GeminiAdapter(factory);
    await expect(
      unsafe.chat(
        { ...config, baseUrl: 'http://127.0.0.1:11434/v1' },
        { model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hello' }] },
      ),
    ).rejects.toThrow(/HTTPS|private/i);
    expect(factory).not.toHaveBeenCalled();
  });
});

function tool(name: string): ProviderToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: 'Lookup a status',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
    },
  };
}
