import { createServer } from 'node:http';

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 4010);
const host = process.env.MOCK_PROVIDER_HOST ?? '127.0.0.1';

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === 'GET' && url.pathname === '/v1/models') {
    return json(response, 200, {
      object: 'list',
      data: [{ id: 'e2e-model', object: 'model', owned_by: 'e2e' }],
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = await readJson(request);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages]
      .reverse()
      .find((message) => message && typeof message === 'object' && message.role === 'user');
    const prompt = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const hasKnowledgeContext = messages.some(
      (message) =>
        message &&
        typeof message === 'object' &&
        typeof message.content === 'string' &&
        message.content.includes('<untrusted_knowledge>'),
    );
    const suffix = hasKnowledgeContext ? ' [knowledge-context-present]' : '';
    if (body.stream === true) return streamChat(response, `${prompt}${suffix}`);
    return json(response, 200, {
      id: 'chatcmpl_e2e',
      object: 'chat.completion',
      model: body.model ?? 'e2e-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `Mock response: ${prompt}${suffix}` },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/embeddings') {
    const body = await readJson(request);
    const input = Array.isArray(body.input) ? body.input : [body.input];
    return json(response, 200, {
      object: 'list',
      model: body.model ?? 'e2e-embedding',
      data: input.map((_, index) => ({ object: 'embedding', index, embedding: [0.1, 0.2, 0.3] })),
      usage: { prompt_tokens: input.length, total_tokens: input.length },
    });
  }

  return json(response, 404, { error: { message: 'Fixture route not found' } });
});

server.listen(port, host, () => {
  process.stdout.write(`OpenAI-compatible fixture listening on http://${host}:${port}/v1\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw new Error('Fixture request is too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function streamChat(response, prompt) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  send(response, {
    id: 'chatcmpl_e2e_stream',
    model: 'e2e-model',
    choices: [
      { index: 0, delta: { role: 'assistant', content: 'Mock stream: ' }, finish_reason: null },
    ],
  });
  send(response, {
    id: 'chatcmpl_e2e_stream',
    model: 'e2e-model',
    choices: [{ index: 0, delta: { content: prompt }, finish_reason: 'stop' }],
  });
  send(response, {
    id: 'chatcmpl_e2e_stream',
    model: 'e2e-model',
    choices: [],
    usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
  });
  response.end('data: [DONE]\n\n');
}

function send(response, body) {
  response.write(`data: ${JSON.stringify(body)}\n\n`);
}
