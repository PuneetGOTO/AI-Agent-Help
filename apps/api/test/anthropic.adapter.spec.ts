import Anthropic, { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { BadRequestException } from '@nestjs/common';
import {
  AnthropicAdapter,
  AnthropicUnsupportedCapabilityError,
} from '../src/modules/providers/anthropic.adapter';
import type {
  ProviderChatRequest,
  ProviderRuntimeConfig,
  ProviderToolDefinition,
} from '../src/modules/providers/provider.types';

type AnthropicClient = Pick<Anthropic, 'messages' | 'models'>;

const PUBLIC_CONFIG: ProviderRuntimeConfig = {
  id: 'provider-anthropic',
  type: 'ANTHROPIC',
  baseUrl: 'https://8.8.8.8',
  credentials: { apiKey: 'sk-ant-test-only' },
};

const WEATHER_TOOL: ProviderToolDefinition = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
};

class TestAnthropicAdapter extends AnthropicAdapter {
  constructor(private readonly fakeClient: AnthropicClient) {
    super();
  }

  protected override createClient(_config: ProviderRuntimeConfig): AnthropicClient {
    void _config;
    return this.fakeClient;
  }
}

function createAdapter(options?: { create?: jest.Mock; list?: jest.Mock }): {
  adapter: AnthropicAdapter;
  create: jest.Mock;
  list: jest.Mock;
} {
  const create = options?.create ?? jest.fn();
  const list =
    options?.list ??
    jest.fn().mockResolvedValue({
      data: [],
      hasNextPage: () => false,
      getNextPage: jest.fn(),
    });
  const client = {
    messages: { create },
    models: { list },
  } as unknown as AnthropicClient;
  return { adapter: new TestAnthropicAdapter(client), create, list };
}

describe('AnthropicAdapter', () => {
  it('lists models through the official SDK contract and detects per-model capabilities', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'claude-sonnet-4-6',
          display_name: 'Claude Sonnet 4.6',
          capabilities: null,
        },
      ],
      hasNextPage: () => false,
      getNextPage: jest.fn(),
    });
    const { adapter } = createAdapter({ list });

    await expect(adapter.validateCredential(PUBLIC_CONFIG)).resolves.toBe(true);
    const models = await adapter.listModels(PUBLIC_CONFIG);

    expect(list).toHaveBeenCalledWith({ limit: 100 }, { maxRetries: 0, timeout: 15_000 });
    expect(models).toEqual([
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        capabilities: {
          chat: true,
          streaming: true,
          embeddings: false,
          toolCalling: true,
          structuredOutput: true,
          vision: true,
          modelListing: true,
        },
      },
    ]);
  });

  it('maps system, tool calls, tool results, tools, and JSON schema to Anthropic messages', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-sonnet-4-6',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
        output_tokens: 4,
      },
      content: [
        { type: 'text', text: 'It is sunny.' },
        {
          type: 'tool_use',
          id: 'toolu_new',
          name: 'get_weather',
          input: { city: 'Hong Kong' },
        },
      ],
    });
    const { adapter } = createAdapter({ create });
    const controller = new AbortController();
    const request: ProviderChatRequest = {
      model: 'claude-sonnet-4-6',
      maxTokens: 2_048,
      temperature: 0.2,
      timeoutMs: 1_234,
      signal: controller.signal,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Check the weather.' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'toolu_old',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Kowloon"}' },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'toolu_old',
          content: '{"temperature":30}',
        },
      ],
      tools: [WEATHER_TOOL],
      responseSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
    };

    const response = await adapter.chat(PUBLIC_CONFIG, request);

    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-6',
      max_tokens: 2_048,
      temperature: 0.2,
      system: 'Be concise.',
      stream: false,
      tool_choice: { type: 'auto' },
      tools: [
        {
          name: 'get_weather',
          description: 'Get the current weather',
          input_schema: expect.objectContaining({ type: 'object' }),
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: expect.objectContaining({ type: 'object' }),
        },
      },
    });
    expect(body.messages).toEqual([
      { role: 'user', content: 'Check the weather.' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_old',
            name: 'get_weather',
            input: { city: 'Kowloon' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_old',
            content: '{"temperature":30}',
          },
        ],
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('sk-ant-test-only');
    expect(options).toEqual({ maxRetries: 0, timeout: 1_234, signal: controller.signal });
    expect(response).toEqual({
      content: 'It is sunny.',
      toolCalls: [
        {
          id: 'toolu_new',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Hong Kong"}' },
        },
      ],
      usage: { inputTokens: 15, outputTokens: 4, totalTokens: 19 },
      model: 'claude-sonnet-4-6',
      finishReason: 'tool_use',
    });
  });

  it('normalizes streamed text, tool input deltas, finish reason, and cumulative usage', async () => {
    const abort = jest.fn();
    const stream = {
      controller: { abort },
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 5,
              cache_creation_input_tokens: 2,
              cache_read_input_tokens: 0,
              output_tokens: 0,
            },
          },
        };
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' world' },
        };
        yield { type: 'content_block_stop', index: 0 };
        yield {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'toolu_stream',
            name: 'get_weather',
            input: {},
          },
        };
        yield {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"city":' },
        };
        yield {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"Hong Kong"}' },
        };
        yield { type: 'content_block_stop', index: 1 };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: {
            input_tokens: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            output_tokens: 3,
          },
        };
        yield { type: 'message_stop' };
      },
    };
    const create = jest.fn().mockResolvedValue(stream);
    const { adapter } = createAdapter({ create });
    const events = [];

    for await (const event of adapter.streamChat(PUBLIC_CONFIG, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'token', content: 'Hello' },
      { type: 'token', content: ' world' },
      {
        type: 'tool_call',
        toolCall: {
          id: 'toolu_stream',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Hong Kong"}' },
        },
      },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
      { type: 'done', finishReason: 'tool_use' },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, max_tokens: 1_024 }),
      expect.objectContaining({ maxRetries: 0, timeout: 30_000 }),
    );
    expect(abort).not.toHaveBeenCalled();
  });

  it('exposes helper capabilities and rejects embeddings as a typed unsupported operation', async () => {
    const { adapter } = createAdapter();
    const request: ProviderChatRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    expect(adapter.toolCalling(request, [WEATHER_TOOL])).toMatchObject({
      tools: [WEATHER_TOOL],
    });
    expect(
      adapter.structuredOutput(request, {
        type: 'object',
        properties: { answer: { type: 'string' } },
      }),
    ).toMatchObject({ responseSchema: { type: 'object' } });
    expect(adapter.capabilityDetection('claude-sonnet-4-6')).toMatchObject({
      chat: true,
      streaming: true,
      embeddings: false,
      toolCalling: true,
      structuredOutput: true,
      vision: true,
      modelListing: true,
    });
    expect(adapter.capabilityDetection('claude-2.1')).toMatchObject({
      embeddings: false,
      toolCalling: false,
      structuredOutput: false,
      vision: false,
    });

    const promise = adapter.embeddings(PUBLIC_CONFIG, {
      model: 'not-supported',
      input: ['hello'],
    });
    await expect(promise).rejects.toBeInstanceOf(AnthropicUnsupportedCapabilityError);
    await promise.catch((error: unknown) => {
      expect(adapter.normalizeError(error)).toEqual({
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'Anthropic does not support embeddings',
        retryable: false,
      });
    });
  });

  it('normalizes API failures without exposing provider bodies or credentials', () => {
    const { adapter } = createAdapter();
    const error = APIError.generate(
      401,
      { error: { message: 'credential sk-ant-secret leaked in vendor body' } },
      'credential sk-ant-secret leaked in vendor body',
      new Headers({ 'request-id': 'req_safe_123' }),
    );

    const normalized = adapter.normalizeError(error);

    expect(normalized).toEqual({
      code: 'PROVIDER_AUTH_FAILED',
      message: 'Anthropic credential was rejected (request req_safe_123)',
      retryable: false,
      statusCode: 401,
    });
    expect(JSON.stringify(normalized)).not.toContain('sk-ant-secret');
    expect(adapter.normalizeUsage({ input_tokens: 3, output_tokens: 2 })).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });
    expect(adapter.normalizeError(new APIConnectionError({ message: 'network details' }))).toEqual({
      code: 'PROVIDER_CONNECTION_ERROR',
      message: 'Unable to connect to Anthropic',
      retryable: true,
    });
  });

  it('rejects private custom endpoints before invoking the SDK client', async () => {
    const list = jest.fn();
    const { adapter } = createAdapter({ list });

    await expect(
      adapter.listModels({
        ...PUBLIC_CONFIG,
        baseUrl: 'https://127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });
});
