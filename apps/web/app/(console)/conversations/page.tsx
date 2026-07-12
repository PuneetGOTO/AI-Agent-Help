'use client';

import { Bot, MessageSquareText, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';
import { Input, PageHeader, Panel, Select } from '@/components/ui';
import type { Conversation } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatCurrency, formatDate, formatNumber } from '@/lib/utils';

export default function ConversationsPage() {
  const query = useApiQuery<unknown>('/conversations?page=1&pageSize=100');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const conversations = asPaginated<Conversation>(query.data).items;
  const filtered = useMemo(() => {
    const items = conversations.filter(
      (conversation) =>
        !search ||
        `${conversation.title ?? ''} ${conversation.agent?.name ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
    return [...items].sort((a, b) => {
      if (sort === 'cost') return (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0);
      if (sort === 'tokens') return (b.totalTokens ?? 0) - (a.totalTokens ?? 0);
      return (
        new Date(b.lastMessageAt ?? b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.lastMessageAt ?? a.updatedAt ?? a.createdAt).getTime()
      );
    });
  }, [conversations, search, sort]);
  return (
    <div className="animate-enter">
      <PageHeader title="對話記錄" description="檢視 Agent 對話、執行狀態、Token、成本與錯誤。" />
      <Panel>
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[var(--muted)]" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋對話或 Agent"
            />
          </div>
          <Select
            className="sm:w-44"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="recent">最近更新</option>
            <option value="cost">成本最高</option>
            <option value="tokens">Token 最多</option>
          </Select>
        </div>
        {query.loading ? (
          <SkeletonRows rows={8} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5">對話</th>
                  <th className="px-4 py-2.5">Agent</th>
                  <th className="px-4 py-2.5">訊息</th>
                  <th className="px-4 py-2.5">Token</th>
                  <th className="px-4 py-2.5">成本</th>
                  <th className="px-4 py-2.5">最後活動</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((conversation) => (
                  <tr key={conversation.id} className="hover:bg-[#fafbfa]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/conversations/${conversation.id}`}
                        className="flex items-center gap-3"
                      >
                        <span className="grid size-8 place-items-center rounded-md bg-[#f3eee5] text-[#8a5c16]">
                          <MessageSquareText className="size-4" />
                        </span>
                        <span className="max-w-xs truncate text-sm font-medium hover:text-[var(--accent)]">
                          {conversation.title || '未命名對話'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 text-sm">
                        <Bot className="size-3.5 text-[var(--muted)]" />
                        {conversation.agent?.name ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums">
                      {conversation.messageCount ?? conversation.messages?.length ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums">
                      {formatNumber(conversation.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums">
                      {formatCurrency(conversation.totalCostUsd, 4)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      {formatDate(conversation.lastMessageAt ?? conversation.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={conversations.length ? '找不到符合條件的對話' : '尚無對話記錄'}
            description={
              conversations.length
                ? '請調整搜尋條件。'
                : '透過 Playground 或 API 執行 Agent 後，對話會顯示在這裡。'
            }
            icon={<MessageSquareText className="size-5" />}
          />
        )}
      </Panel>
    </div>
  );
}
