'use client';

import { Bot, Copy, Plus, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';
import { Badge, Button, Input, PageHeader, Panel, Select, useToast } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { Agent } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatDate, toMessage } from '@/lib/utils';

export default function AgentsPage() {
  const query = useApiQuery<unknown>('/agents?page=1&pageSize=100');
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [duplicating, setDuplicating] = useState<string>();
  const agents = asPaginated<Agent>(query.data).items;
  const filtered = useMemo(
    () =>
      agents.filter((agent) => {
        const matchesText =
          !search ||
          `${agent.name} ${agent.description ?? ''} ${(agent.tags ?? []).join(' ')}`
            .toLowerCase()
            .includes(search.toLowerCase());
        return matchesText && (status === 'all' || agent.status.toLowerCase() === status);
      }),
    [agents, search, status],
  );

  const duplicate = async (agent: Agent) => {
    setDuplicating(agent.id);
    try {
      await apiRequest(`/agents/${agent.id}/duplicate`, { method: 'POST' });
      toast.push(`已複製「${agent.name}」`);
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setDuplicating(undefined);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        title="Agents"
        description="建立、測試、發布及版本化工作區內的 AI Agent。"
        actions={
          <Button asChild>
            <Link href="/agents/new">
              <Plus className="size-4" />
              建立 Agent
            </Link>
          </Button>
        }
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[var(--muted)]" />
            <Input
              className="pl-9"
              placeholder="搜尋名稱、描述或標籤"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            className="sm:w-40"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="狀態篩選"
          >
            <option value="all">全部狀態</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
        {query.loading ? (
          <SkeletonRows rows={7} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Agent</th>
                  <th className="px-4 py-2.5 font-semibold">模型</th>
                  <th className="px-4 py-2.5 font-semibold">狀態</th>
                  <th className="px-4 py-2.5 font-semibold">更新時間</th>
                  <th className="w-24 px-4 py-2.5">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((agent) => (
                  <tr key={agent.id} className="hover:bg-[#fafbfa]">
                    <td className="px-4 py-3">
                      <Link href={`/agents/${agent.id}`} className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-md bg-[#e9f3ed] text-base">
                          {agent.icon ?? <Bot className="size-4 text-[#18794e]" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block max-w-xs truncate text-sm font-medium hover:text-[var(--accent)]">
                            {agent.name}
                          </span>
                          <span className="block max-w-xs truncate text-xs text-[var(--muted)]">
                            {agent.description || '未填寫描述'}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm">{agent.currentVersion?.model ?? '-'}</span>
                      <span className="block text-[11px] text-[var(--muted)]">
                        v{agent.currentVersion?.version ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{agent.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      {formatDate(agent.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" title="開啟 Playground">
                          <Link href={`/agents/${agent.id}/playground`}>
                            <Sparkles className="size-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          loading={duplicating === agent.id}
                          title="複製 Agent"
                          onClick={() => void duplicate(agent)}
                        >
                          {duplicating !== agent.id ? <Copy className="size-4" /> : null}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={agents.length ? '找不到符合條件的 Agent' : '尚未建立 Agent'}
            description={
              agents.length ? '調整搜尋或狀態條件。' : '建立第一個 Agent，配置模型、提示詞與工具。'
            }
            icon={<Bot className="size-5" />}
            action={
              !agents.length ? (
                <Button asChild>
                  <Link href="/agents/new">
                    <Plus className="size-4" />
                    建立 Agent
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
    </div>
  );
}
