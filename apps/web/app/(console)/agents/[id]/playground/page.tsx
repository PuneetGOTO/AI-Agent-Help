'use client';

import {
  ArrowLeft,
  Bot,
  Bug,
  CircleStop,
  Clock3,
  Copy,
  Eraser,
  ExternalLink,
  Play,
  Send,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ErrorState, FullPageLoading } from '@/components/states';
import { Badge, Button, Panel, Switch, Textarea, useToast } from '@/components/ui';
import { streamAgentChat } from '@/lib/api';
import type { Agent, ChatMessage, StreamEvent, TraceEvent } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { cn, formatCurrency, formatNumber, toMessage } from '@/lib/utils';

interface PlaygroundMessage extends ChatMessage {
  localId: string;
  pending?: boolean;
}

interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

export default function AgentPlaygroundPage() {
  const params = useParams<{ id: string }>();
  const query = useApiQuery<Agent>(params.id ? `/agents/${params.id}` : null);
  if (query.loading) return <FullPageLoading label="載入 Playground" />;
  if (query.error)
    return (
      <ErrorState title="無法載入 Agent" error={query.error} onRetry={() => void query.refetch()} />
    );
  if (!query.data) return null;
  return <Playground agent={query.data} />;
}

function Playground({ agent }: { agent: Agent }) {
  const auth = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [input, setInput] = useState('');
  const canDebug = auth.can('agent:debug');
  const [debug, setDebug] = useState(canDebug);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [conversationId, setConversationId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [usage, setUsage] = useState<RunUsage>({});
  const controller = useRef<AbortController | undefined>(undefined);
  const startedAt = useRef<number | undefined>(undefined);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const updateAssistant = (localId: string, content: string, pending = true) => {
    setMessages((items) =>
      items.map((item) =>
        item.localId === localId ? { ...item, content: item.content + content, pending } : item,
      ),
    );
    requestAnimationFrame(() =>
      transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
    );
  };

  const handleEvent = (event: StreamEvent, assistantId: string) => {
    const data = event.data;
    if (event.type === 'meta') {
      if (typeof data.conversationId === 'string') setConversationId(data.conversationId);
      if (typeof data.runId === 'string') setRunId(data.runId);
      setTrace((items) => [
        ...items,
        {
          type: 'meta',
          name: 'Run started',
          status: 'SUCCEEDED',
          createdAt: new Date().toISOString(),
          output: data,
        },
      ]);
    }
    if (event.type === 'token') {
      const token = [data.content, data.token, data.delta].find(
        (value) => typeof value === 'string',
      );
      if (typeof token === 'string') updateAssistant(assistantId, token);
    }
    if (event.type === 'tool_call') {
      const tool =
        data.toolCall && typeof data.toolCall === 'object'
          ? (data.toolCall as Record<string, unknown>)
          : data;
      const functionData =
        tool.function && typeof tool.function === 'object'
          ? (tool.function as Record<string, unknown>)
          : undefined;
      setTrace((items) => [
        ...items,
        {
          type: 'tool_call',
          name: String(functionData?.name ?? tool.name ?? 'Tool call'),
          status: String(data.status ?? 'RUNNING'),
          createdAt: new Date().toISOString(),
          input: functionData?.arguments ?? data.arguments ?? data,
        },
      ]);
    }
    if (event.type === 'usage') {
      const raw =
        data.usage && typeof data.usage === 'object'
          ? (data.usage as Record<string, unknown>)
          : data;
      setUsage((current) => ({
        ...current,
        inputTokens: numberValue(raw.inputTokens),
        outputTokens: numberValue(raw.outputTokens),
        totalTokens: numberValue(raw.totalTokens),
        costUsd: numberValue(raw.costUsd),
      }));
      setTrace((items) => [
        ...items,
        {
          type: 'usage',
          name: 'Usage normalized',
          status: 'SUCCEEDED',
          createdAt: new Date().toISOString(),
          output: raw,
        },
      ]);
    }
    if (event.type === 'done') {
      updateAssistant(assistantId, '', false);
      if (startedAt.current)
        setUsage((current) => ({
          ...current,
          latencyMs: Math.round(performance.now() - startedAt.current!),
        }));
      setTrace((items) => [
        ...items,
        {
          type: 'done',
          name: 'Run completed',
          status: 'SUCCEEDED',
          createdAt: new Date().toISOString(),
          output: data,
        },
      ]);
    }
    if (event.type === 'error') {
      const message = typeof data.message === 'string' ? data.message : '模型串流發生錯誤';
      throw new Error(message);
    }
  };

  const send = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || streaming) return;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((items) => [
      ...items,
      { localId: userId, role: 'user', content },
      { localId: assistantId, role: 'assistant', content: '', pending: true },
    ]);
    setInput('');
    setError(undefined);
    setStreaming(true);
    setTrace([]);
    setUsage({});
    const abortController = new AbortController();
    controller.current = abortController;
    startedAt.current = performance.now();
    try {
      await streamAgentChat(
        agent.id,
        { message: content, conversationId, debug },
        (event) => handleEvent(event, assistantId),
        abortController.signal,
      );
      updateAssistant(assistantId, '', false);
    } catch (requestError) {
      if (abortController.signal.aborted) {
        updateAssistant(assistantId, '', false);
        setTrace((items) => [
          ...items,
          {
            type: 'cancelled',
            name: 'Run cancelled',
            status: 'CANCELLED',
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        const message = toMessage(requestError);
        setError(message);
        updateAssistant(assistantId, '', false);
        setTrace((items) => [
          ...items,
          {
            type: 'error',
            name: 'Run failed',
            status: 'FAILED',
            createdAt: new Date().toISOString(),
            output: { message },
          },
        ]);
      }
    } finally {
      setStreaming(false);
      controller.current = undefined;
    }
  };

  const stop = () => controller.current?.abort();
  const clear = () => {
    if (streaming) stop();
    setMessages([]);
    setConversationId(undefined);
    setRunId(undefined);
    setTrace([]);
    setUsage({});
    setError(undefined);
  };

  return (
    <div className="animate-enter">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/agents/${agent.id}`} aria-label="返回 Agent 編輯器">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <span className="grid size-9 place-items-center rounded-md bg-[#e9f3ed] text-base">
          {agent.icon ?? <Bot className="size-4 text-[#18794e]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{agent.name}</h1>
            <Badge>{agent.status}</Badge>
          </div>
          <p className="truncate text-xs text-[var(--muted)]">
            {agent.currentVersion?.model ?? '尚未配置模型'}
          </p>
        </div>
        {conversationId ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/conversations/${conversationId}`}>
              對話詳情 <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={clear}>
          <Eraser className="size-3.5" />
          清除
        </Button>
      </header>
      <div className="grid min-h-[calc(100vh-150px)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="flex min-h-[620px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b bg-[#fafbfa] px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Sparkles className="size-3.5" />
              <span>
                {conversationId ? `Conversation ${conversationId.slice(0, 8)}` : '新對話'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Bug className="size-3.5 text-[var(--muted)]" />
              <span className="text-xs">Debug</span>
              <Switch
                label="Debug mode"
                checked={debug}
                onCheckedChange={setDebug}
                disabled={streaming || !canDebug}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {messages.length ? (
              <div className="mx-auto max-w-3xl space-y-5">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.localId}
                    message={message}
                    onCopy={() => {
                      void navigator.clipboard.writeText(message.content);
                      toast.push('已複製訊息');
                    }}
                  />
                ))}
                <div ref={transcriptEnd} />
              </div>
            ) : (
              <div className="grid h-full min-h-80 place-items-center">
                <div className="max-w-md text-center">
                  <span className="mx-auto mb-4 grid size-11 place-items-center rounded-lg bg-[#e9f3ed] text-[#18794e]">
                    <Play className="size-5" />
                  </span>
                  <h2 className="text-sm font-semibold">開始測試 Agent</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    訊息會以{debug ? '目前草稿' : '已發布'}版本送往真實模型，執行軌跡會顯示在右側。
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="border-t bg-white p-3 sm:p-4">
            {error ? (
              <div
                role="alert"
                className="mb-3 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-3 py-2 text-sm text-[#98281f]"
              >
                {error}
              </div>
            ) : null}
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={streaming}
                className="min-h-11 max-h-40 resize-none py-2.5"
                placeholder="輸入訊息…"
                aria-label="訊息"
              />
              {streaming ? (
                <Button variant="danger" size="icon" onClick={stop} aria-label="停止生成">
                  <CircleStop className="size-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  disabled={!input.trim()}
                  onClick={() => void send()}
                  aria-label="傳送訊息"
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </Panel>
        <aside className="space-y-4">
          <Panel>
            <div className="border-b px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <TerminalSquare className="size-4" />
                執行摘要
              </h2>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-[var(--border)]">
              <Summary label="輸入 Token" value={formatNumber(usage.inputTokens)} />
              <Summary label="輸出 Token" value={formatNumber(usage.outputTokens)} />
              <Summary label="成本" value={formatCurrency(usage.costUsd, 4)} />
              <Summary label="延遲" value={usage.latencyMs ? `${usage.latencyMs} ms` : '-'} />
            </dl>
            {runId ? (
              <div className="border-t px-4 py-2 font-mono text-[10px] text-[var(--muted)]">
                Run: {runId}
              </div>
            ) : null}
          </Panel>
          <Panel>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">執行軌跡</h2>
              {streaming ? (
                <span className="flex items-center gap-1.5 text-[11px] text-[#8a4b00]">
                  <span className="size-1.5 rounded-full bg-[#d78b19] animate-pulse" />
                  Running
                </span>
              ) : null}
            </div>
            {trace.length ? (
              <div className="max-h-[520px] divide-y overflow-y-auto">
                {trace.map((event, index) => (
                  <TraceRow key={`${event.type}-${index}`} event={event} />
                ))}
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-xs text-[var(--muted)]">尚無執行事件</div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function MessageBubble({ message, onCopy }: { message: PlaygroundMessage; onCopy: () => void }) {
  const user = message.role === 'user';
  return (
    <article className={cn('flex gap-3', user && 'justify-end')}>
      <div className={cn('max-w-[86%]', user && 'order-1')}>
        <div
          className={cn(
            'rounded-lg px-4 py-3 text-sm leading-6',
            user ? 'bg-[#26362d] text-white' : 'border bg-[#fafbfa] text-[var(--foreground)]',
          )}
        >
          <div className="whitespace-pre-wrap break-words">
            {message.content ||
              (message.pending ? (
                <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                  <span className="size-1.5 rounded-full bg-current animate-bounce" />
                  <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                  <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
                </span>
              ) : (
                '未返回內容'
              ))}
          </div>
        </div>
        {!user && message.content ? (
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={onCopy}
          >
            <Copy className="size-3" />
            複製
          </button>
        ) : null}
      </div>
      {!user ? (
        <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-md bg-[#e9f3ed]">
          <Bot className="size-3.5 text-[#18794e]" />
        </span>
      ) : null}
    </article>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-[10px] uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function TraceRow({ event }: { event: TraceEvent }) {
  const success = ['SUCCEEDED', 'COMPLETED'].includes(event.status?.toUpperCase() ?? '');
  const failed = event.status?.toUpperCase() === 'FAILED';
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            failed ? 'bg-[#d92d20]' : success ? 'bg-[#29a36a]' : 'bg-[#d78b19]',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {event.type === 'tool_call' ? (
              <Wrench className="size-3" />
            ) : event.type === 'done' ? (
              <Clock3 className="size-3" />
            ) : null}
            {event.name ?? event.type}
          </span>
          <span className="mt-0.5 block text-[10px] uppercase text-[var(--muted)]">
            {event.status ?? event.type}
          </span>
          {event.input !== undefined ? (
            <pre className="mt-2 max-h-24 overflow-auto rounded bg-[#f4f5f3] p-2 text-[10px] leading-4 text-[#566159]">
              {safeJson(event.input)}
            </pre>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
