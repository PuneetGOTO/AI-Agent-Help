import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { BedrockAdapter } from '../src/modules/providers/bedrock.adapter';
import type {
  ProviderChatRequest,
  ProviderRuntimeConfig,
} from '../src/modules/providers/provider.types';

const config: ProviderRuntimeConfig = {
  id: 'bedrock-1',
  type: 'AWS_BEDROCK',
  credentials: {
    accessKeyId: 'AKIATEST',
    secretAccessKey: 'secret-test-value',
    sessionToken: 'session-test-value',
    region: 'us-east-1',
  },
};

const chatModel = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

describe('BedrockAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses explicit credentials and lists control-plane models with detected capabilities', async () => {
    const send = jest.spyOn(BedrockClient.prototype, 'send').mockResolvedValue({
      modelSummaries: [
        {
          modelId: 'amazon.nova-pro-v1:0',
          modelName: 'Nova Pro',
          inputModalities: ['TEXT'],
          outputModalities: ['TEXT'],
          responseStreamingSupported: true,
        },
        {
          modelId: 'amazon.titan-embed-text-v2:0',
          modelName: 'Titan Embed V2',
          inputModalities: ['TEXT'],
          outputModalities: ['EMBEDDING'],
          responseStreamingSupported: false,
        },
      ],
    } as never);

    const models = await new BedrockAdapter().listModels(config);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListFoundationModelsCommand);
    const client = send.mock.instances[0] as unknown as BedrockClient | undefined;
    if (!client) throw new Error('Expected Bedrock control client instance');
    const regionProvider = client.config.region as () => Promise<string>;
    const credentialsProvider = client.config.credentials as () => Promise<{
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }>;
    await expect(regionProvider()).resolves.toBe('us-east-1');
    await expect(credentialsProvider()).resolves.toEqual(
      expect.objectContaining({
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secret-test-value',
        sessionToken: 'session-test-value',
      }),
    );
    expect(models).toEqual([
      {
        id: 'amazon.nova-pro-v1:0',
        name: 'Nova Pro',
        capabilities: expect.objectContaining({
          chat: true,
          streaming: true,
          toolCalling: true,
          structuredOutput: true,
          embeddings: false,
        }),
      },
      {
        id: 'amazon.titan-embed-text-v2:0',
        name: 'Titan Embed V2',
        capabilities: expect.objectContaining({
          chat: false,
          streaming: false,
          embeddings: true,
          toolCalling: false,
        }),
      },
    ]);
  });

  it('maps Converse messages, tools and JSON schema, then normalizes output', async () => {
    const send = jest.spyOn(BedrockRuntimeClient.prototype, 'send').mockResolvedValue({
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'Weather ready.' },
            {
              toolUse: {
                toolUseId: 'call-2',
                name: 'get_weather',
                input: { city: 'Hong Kong' },
              },
            },
          ],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      metrics: { latencyMs: 20 },
    } as never);
    const request: ProviderChatRequest = {
      model: chatModel,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Weather?' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Hong Kong"}' },
            },
          ],
        },
        { role: 'tool', toolCallId: 'call-1', content: '{"temperature":30}' },
      ],
      temperature: 0.2,
      maxTokens: 1_000,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
      responseSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
      },
    };

    const response = await new BedrockAdapter().chat(config, request);
    const command = send.mock.calls[0]?.[0];

    expect(command).toBeInstanceOf(ConverseCommand);
    expect((command as ConverseCommand).input).toEqual(
      expect.objectContaining({
        modelId: chatModel,
        system: [{ text: 'Be concise.' }],
        inferenceConfig: { temperature: 0.2, maxTokens: 1_000 },
        toolConfig: {
          tools: [
            {
              toolSpec: expect.objectContaining({
                name: 'get_weather',
                strict: true,
                inputSchema: { json: request.tools?.[0]?.function.parameters },
              }),
            },
          ],
          toolChoice: { auto: {} },
        },
        outputConfig: {
          textFormat: {
            type: 'json_schema',
            structure: {
              jsonSchema: {
                name: 'agent_response',
                schema: JSON.stringify(request.responseSchema),
              },
            },
          },
        },
      }),
    );
    expect((command as ConverseCommand).input.messages?.[1]?.content).toEqual([
      {
        toolUse: {
          toolUseId: 'call-1',
          name: 'get_weather',
          input: { city: 'Hong Kong' },
        },
      },
    ]);
    expect((command as ConverseCommand).input.messages?.[2]?.content).toEqual([
      {
        toolResult: {
          toolUseId: 'call-1',
          content: [{ text: '{"temperature":30}' }],
        },
      },
    ]);
    expect(response).toEqual({
      content: 'Weather ready.',
      toolCalls: [
        {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"city":"Hong Kong"}',
          },
        },
      ],
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      model: chatModel,
      finishReason: 'tool_use',
    });
  });

  it('normalizes ConverseStream tokens, tool deltas, usage and completion', async () => {
    async function* stream() {
      await Promise.resolve();
      yield {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'Hello' },
        },
      };
      yield {
        contentBlockStart: {
          contentBlockIndex: 1,
          start: { toolUse: { toolUseId: 'tool-1', name: 'lookup' } },
        },
      };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 1,
          delta: { toolUse: { input: '{"id":' } },
        },
      };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 1,
          delta: { toolUse: { input: '42}' } },
        },
      };
      yield { contentBlockStop: { contentBlockIndex: 1 } };
      yield {
        metadata: {
          usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
          metrics: { latencyMs: 12 },
        },
      };
      yield { messageStop: { stopReason: 'tool_use' } };
    }
    const send = jest.spyOn(BedrockRuntimeClient.prototype, 'send').mockResolvedValue({
      stream: stream(),
    } as never);

    const events = [];
    for await (const event of new BedrockAdapter().streamChat(config, {
      model: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      events.push(event);
    }

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ConverseStreamCommand);
    expect(events).toEqual([
      { type: 'token', content: 'Hello' },
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool-1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"id":42}' },
        },
      },
      {
        type: 'usage',
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      },
      { type: 'done', finishReason: 'tool_use' },
    ]);
  });

  it('marks AWS retryable ConverseStream exception events as retryable', async () => {
    async function* stream() {
      await Promise.resolve();
      yield { throttlingException: { message: 'rate limited' } };
    }
    jest
      .spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockResolvedValue({ stream: stream() } as never);
    const adapter = new BedrockAdapter();
    let caught: unknown;

    try {
      await adapter
        .streamChat(config, {
          model: 'amazon.nova-pro-v1:0',
          messages: [{ role: 'user', content: 'Hi' }],
        })
        .next();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(adapter.normalizeError(caught)).toMatchObject({
      code: 'PROVIDER_THROTTLING',
      retryable: true,
    });
  });

  it('invokes Titan once per input and aggregates embedding token usage', async () => {
    const send = jest
      .spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockResolvedValueOnce({
        body: Uint8Array.from(
          Buffer.from(JSON.stringify({ embedding: [0.1, 0.2], inputTextTokenCount: 2 })),
        ),
      } as never)
      .mockResolvedValueOnce({
        body: Uint8Array.from(
          Buffer.from(JSON.stringify({ embedding: [0.3, 0.4], inputTextTokenCount: 3 })),
        ),
      } as never);

    const result = await new BedrockAdapter().embeddings(config, {
      model: 'amazon.titan-embed-text-v2:0',
      input: ['one', 'two'],
    });

    expect(send).toHaveBeenCalledTimes(2);
    const commands = send.mock.calls.map(([command]) => command as InvokeModelCommand);
    expect(commands.every((command) => command instanceof InvokeModelCommand)).toBe(true);
    expect(
      commands.map((command) =>
        JSON.parse(Buffer.from((command.input.body ?? []) as Uint8Array).toString()),
      ),
    ).toEqual([{ inputText: 'one' }, { inputText: 'two' }]);
    expect(result).toEqual({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
    });
  });

  it('invokes Cohere as one batch and accepts the float embedding response shape', async () => {
    const send = jest.spyOn(BedrockRuntimeClient.prototype, 'send').mockResolvedValue({
      body: Uint8Array.from(
        Buffer.from(
          JSON.stringify({
            embeddings: { float: [[0.1], [0.2]] },
            input_tokens: 4,
          }),
        ),
      ),
    } as never);

    const result = await new BedrockAdapter().embeddings(config, {
      model: 'cohere.embed-multilingual-v3',
      input: ['one', 'two'],
    });
    const command = send.mock.calls[0]?.[0] as InvokeModelCommand;

    expect(command).toBeInstanceOf(InvokeModelCommand);
    expect(JSON.parse(Buffer.from((command.input.body ?? []) as Uint8Array).toString())).toEqual({
      texts: ['one', 'two'],
      input_type: 'search_document',
    });
    expect(result).toEqual({
      embeddings: [[0.1], [0.2]],
      usage: { inputTokens: 4, outputTokens: 0, totalTokens: 4 },
    });
  });

  it('fails closed for unsupported embedding and structured-output models', async () => {
    const adapter = new BedrockAdapter();

    await expect(
      adapter.embeddings(config, { model: 'meta.llama3-8b-instruct-v1:0', input: ['one'] }),
    ).rejects.toThrow('not available');
    expect(() =>
      adapter.structuredOutput(
        {
          model: 'meta.llama3-8b-instruct-v1:0',
          messages: [{ role: 'user', content: 'Hi' }],
        },
        { type: 'object' },
      ),
    ).toThrow('not available');
  });

  it('rejects private custom endpoints even when runtime private-network flag is set', async () => {
    const send = jest.spyOn(BedrockClient.prototype, 'send');
    const adapter = new BedrockAdapter();

    await expect(
      adapter.listModels({
        ...config,
        baseUrl: 'https://127.0.0.1:9000',
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow(/HTTPS|private network/i);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects non-AWS public endpoints unless the server marked an allowlist match', async () => {
    const send = jest.spyOn(BedrockClient.prototype, 'send');

    await expect(
      new BedrockAdapter().listModels({
        ...config,
        baseUrl: 'https://provider-proxy.example.com',
      }),
    ).rejects.toThrow(/official AWS hostname|allowlist/i);
    expect(send).not.toHaveBeenCalled();
  });

  it('normalizes AWS errors without reflecting provider messages or credentials', () => {
    const normalized = new BedrockAdapter().normalizeError({
      name: 'AccessDeniedException',
      message: 'secret-test-value was invalid',
      $metadata: { httpStatusCode: 403, requestId: 'req-123' },
    });

    expect(normalized).toEqual({
      code: 'PROVIDER_AUTH_FAILED',
      message: 'Bedrock authorization failed (request req-123)',
      retryable: false,
      statusCode: 403,
    });
    expect(normalized.message).not.toContain('secret-test-value');
  });
});
