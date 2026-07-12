'use client';

import {
  ArrowRight,
  Bot,
  CircleDollarSign,
  Clock3,
  MessageSquareText,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, PageHeader, Panel } from '@/components/ui';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';
import type { Agent, Conversation, Run, UsageSummary } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatCurrency, formatDate, formatNumber } from '@/lib/utils';

export default function DashboardPage() {
  const agentsQuery = useApiQuery<unknown>('/agents?page=1&pageSize=5');
  const usageQuery = useApiQuery<UsageSummary>('/usage/summary?period=30d');
  const conversationsQuery = useApiQuery<unknown>('/conversations?page=1&pageSize=5');
  const runsQuery = useApiQuery<unknown>('/runs?page=1&pageSize=6');
  const agents = asPaginated<Agent>(agentsQuery.data);
  const conversations = asPaginated<Conversation>(conversationsQuery.data);
  const runs = asPaginated<Run>(runsQuery.data);
  const usage = usageQuery.data;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Dashboard"
        description="工作區的 Agent 運行狀態、用量與近期活動。"
        actions={
          <Button asChild>
            <Link href="/agents/new">
              <Plus className="size-4" />
              建立 Agent
            </Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Agents"
          value={agentsQuery.loading ? undefined : formatNumber(agents.total)}
          icon={<Bot className="size-4" />}
          href="/agents"
        />
        <Metric
          label="30 日請求"
          value={usageQuery.loading ? undefined : formatNumber(usage?.requestCount)}
          icon={<MessageSquareText className="size-4" />}
          href="/conversations"
        />
        <Metric
          label="30 日成本"
          value={usageQuery.loading ? undefined : formatCurrency(usage?.totalCostUsd)}
          icon={<CircleDollarSign className="size-4" />}
          href="/usage"
        />
        <Metric
          label="平均延遲"
          value={usageQuery.loading ? undefined : `${formatNumber(usage?.averageLatencyMs)} ms`}
          icon={<Clock3 className="size-4" />}
          href="/usage"
          warning={Boolean(usage?.errorCount)}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_0.9fr]">
        <Panel>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">用量趨勢</h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">最近 30 日 Token</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/usage">
                查看詳情 <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          {usageQuery.loading ? (
            <div className="h-64 p-4">
              <div className="h-full rounded bg-[#eef1ee] animate-pulse-soft" />
            </div>
          ) : usageQuery.error ? (
            <ErrorState
              error={usageQuery.error}
              onRetry={() => void usageQuery.refetch()}
              compact
            />
          ) : usage?.series?.length ? (
            <UsageBars series={usage.series} />
          ) : (
            <EmptyState
              compact
              title="尚無用量資料"
              description="執行 Agent 後，Token 與成本會顯示在這裡。"
            />
          )}
        </Panel>
        <Panel>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">近期執行</h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">最新 Agent runs</p>
            </div>
          </div>
          {runsQuery.loading ? (
            <SkeletonRows rows={4} />
          ) : runsQuery.error ? (
            <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} compact />
          ) : runs.items.length ? (
            <div className="divide-y">
              {runs.items.map((run) => (
                <Link
                  key={run.id}
                  href={`/conversations/${run.conversationId ?? ''}?run=${run.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafbfa]"
                >
                  <span
                    className={`size-2 rounded-full ${run.status.toUpperCase() === 'SUCCEEDED' ? 'bg-[#29a36a]' : run.status.toUpperCase() === 'FAILED' ? 'bg-[#d92d20]' : 'bg-[#d78b19]'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {run.model ?? 'Agent run'}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                      {formatDate(run.startedAt ?? run.createdAt)}
                    </span>
                  </span>
                  <span className="text-right text-[11px] text-[var(--muted)]">
                    <span className="block">{formatNumber(run.totalTokens)} tokens</span>
                    <span className="block">{run.latencyMs ? `${run.latencyMs} ms` : '-'}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState compact title="尚無執行記錄" />
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">近期 Agents</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/agents">
                全部 Agents <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          {agentsQuery.loading ? (
            <SkeletonRows />
          ) : agentsQuery.error ? (
            <ErrorState
              error={agentsQuery.error}
              onRetry={() => void agentsQuery.refetch()}
              compact
            />
          ) : agents.items.length ? (
            <div className="divide-y">
              {agents.items.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafbfa]"
                >
                  <span className="grid size-8 place-items-center rounded-md bg-[#e9f3ed] text-sm">
                    {agent.icon ?? <Bot className="size-4 text-[#18794e]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{agent.name}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {agent.currentVersion?.model ?? '尚未配置模型'}
                    </span>
                  </span>
                  <Badge>{agent.status}</Badge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="尚未建立 Agent"
              action={
                <Button asChild size="sm">
                  <Link href="/agents/new">
                    <Plus className="size-3.5" />
                    建立 Agent
                  </Link>
                </Button>
              }
            />
          )}
        </Panel>
        <Panel>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">最近對話</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/conversations">
                全部對話 <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          {conversationsQuery.loading ? (
            <SkeletonRows />
          ) : conversationsQuery.error ? (
            <ErrorState
              error={conversationsQuery.error}
              onRetry={() => void conversationsQuery.refetch()}
              compact
            />
          ) : conversations.items.length ? (
            <div className="divide-y">
              {conversations.items.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/conversations/${conversation.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafbfa]"
                >
                  <span className="grid size-8 place-items-center rounded-md bg-[#f3eee5] text-[#8a5c16]">
                    <MessageSquareText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {conversation.title || '未命名對話'}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {conversation.agent?.name ?? 'Agent'} · {conversation.messageCount ?? 0}{' '}
                      則訊息
                    </span>
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {formatDate(conversation.lastMessageAt ?? conversation.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState compact title="尚無對話記錄" />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  href,
  warning,
}: {
  label: string;
  value?: string;
  icon: React.ReactNode;
  href: string;
  warning?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-white p-4 transition-colors hover:border-[#b8c4bb]"
    >
      <div className="flex items-center justify-between text-[var(--muted)]">
        <span className="text-xs font-medium">{label}</span>
        <span className={warning ? 'text-[#a15c00]' : 'text-[var(--muted)]'}>
          {warning ? <TriangleAlert className="size-4" /> : icon}
        </span>
      </div>
      {value === undefined ? (
        <div className="mt-3 h-7 w-24 rounded bg-[#e8ebe8] animate-pulse-soft" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      )}
    </Link>
  );
}

function UsageBars({ series }: { series: NonNullable<UsageSummary['series']> }) {
  const maximum = Math.max(...series.map((point) => point.tokens ?? 0), 1);
  return (
    <div className="flex h-64 items-end gap-1 px-4 pb-4 pt-8" aria-label="Token 用量圖表">
      {series.map((point) => (
        <div key={point.date} className="group relative flex h-full min-w-0 flex-1 items-end">
          <div
            className="w-full rounded-t-sm bg-[#68ad87] transition-colors group-hover:bg-[#18794e]"
            style={{ height: `${Math.max(2, ((point.tokens ?? 0) / maximum) * 100)}%` }}
          />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#202823] px-2 py-1 text-[10px] text-white shadow group-hover:block">
            {formatDate(point.date, false)} · {formatNumber(point.tokens)}
          </div>
        </div>
      ))}
    </div>
  );
}
