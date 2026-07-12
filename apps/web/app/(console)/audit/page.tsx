'use client';

import { FileClock, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';
import { Badge, Input, PageHeader, Panel, Select } from '@/components/ui';
import type { AuditLog } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatDate } from '@/lib/utils';

export default function AuditPage() {
  const query = useApiQuery<unknown>('/audit-logs?page=1&pageSize=100');
  const [search, setSearch] = useState('');
  const [resource, setResource] = useState('all');
  const logs = asPaginated<AuditLog>(query.data).items;
  const resources = [...new Set(logs.map((log) => log.resourceType).filter(Boolean))] as string[];
  const filtered = useMemo(
    () =>
      logs.filter(
        (log) =>
          (resource === 'all' || log.resourceType === resource) &&
          (!search ||
            `${log.action} ${log.actor?.name ?? ''} ${log.actor?.email ?? ''} ${log.resourceType ?? ''}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [logs, search, resource],
  );
  return (
    <div className="animate-enter">
      <PageHeader title="審計日誌" description="不可變更的工作區操作記錄與安全追蹤資訊。" />
      <Panel>
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[var(--muted)]" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋操作、成員或資源"
            />
          </div>
          <Select
            className="sm:w-44"
            value={resource}
            onChange={(event) => setResource(event.target.value)}
          >
            <option value="all">所有資源</option>
            {resources.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
        {query.loading ? (
          <SkeletonRows rows={9} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5">時間</th>
                  <th className="px-4 py-2.5">操作</th>
                  <th className="px-4 py-2.5">執行者</th>
                  <th className="px-4 py-2.5">資源</th>
                  <th className="px-4 py-2.5">IP</th>
                  <th className="px-4 py-2.5">結果</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-[#fafbfa]">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--muted)]">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-medium">{log.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-xs font-medium">
                        {log.actor?.name ?? 'System'}
                      </span>
                      <span className="block text-[10px] text-[var(--muted)]">
                        {log.actor?.email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{log.resourceType ?? 'SYSTEM'}</Badge>
                      {log.resourceId ? (
                        <span className="ml-2 font-mono text-[10px] text-[var(--muted)]">
                          {log.resourceId.slice(0, 10)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {log.ipAddress ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-[#12643f]">
                        <ShieldCheck className="size-3.5" />
                        記錄完成
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={logs.length ? '找不到符合條件的記錄' : '尚無審計記錄'}
            icon={<FileClock className="size-5" />}
          />
        )}
      </Panel>
    </div>
  );
}
