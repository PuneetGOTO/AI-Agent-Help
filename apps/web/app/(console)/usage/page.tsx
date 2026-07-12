'use client';

import { Activity, CircleDollarSign, Clock3, Download, Hash, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/states';
import { Button, PageHeader, Panel, Select } from '@/components/ui';
import type { UsageBreakdown, UsagePoint, UsageSummary } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';

export default function UsagePage() {
  const [period, setPeriod] = useState('30d');
  const query = useApiQuery<UsageSummary>(`/usage/summary?period=${period}`);
  const data = query.data;
  const exportCsv = () => {
    if (!data?.series?.length) return;
    const rows = [
      ['date', 'requests', 'tokens', 'cost_usd'],
      ...data.series.map((point) => [
        point.date,
        String(point.requests ?? 0),
        String(point.tokens ?? 0),
        String(point.costUsd ?? 0),
      ]),
    ];
    const blob = new Blob(
      [
        rows
          .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
          .join('\n'),
      ],
      { type: 'text/csv;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `usage-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (query.error)
    return (
      <>
        <PageHeader title="用量與成本" />
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  return (
    <div className="animate-enter">
      <PageHeader
        title="用量與成本"
        description="分析模型請求、Token、成本、延遲與錯誤。"
        actions={
          <>
            <Select
              className="w-36"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              aria-label="統計期間"
            >
              <option value="7d">最近 7 日</option>
              <option value="30d">最近 30 日</option>
              <option value="90d">最近 90 日</option>
            </Select>
            <Button variant="secondary" disabled={!data?.series?.length} onClick={exportCsv}>
              <Download className="size-4" />
              匯出 CSV
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="總成本"
          value={formatCurrency(data?.totalCostUsd)}
          icon={<CircleDollarSign className="size-4" />}
          loading={query.loading}
        />
        <Metric
          label="總 Token"
          value={formatNumber(data?.totalTokens)}
          icon={<Hash className="size-4" />}
          loading={query.loading}
        />
        <Metric
          label="請求數"
          value={formatNumber(data?.requestCount)}
          icon={<Activity className="size-4" />}
          loading={query.loading}
        />
        <Metric
          label="平均延遲"
          value={`${formatNumber(data?.averageLatencyMs)} ms`}
          icon={<Clock3 className="size-4" />}
          loading={query.loading}
        />
        <Metric
          label="錯誤"
          value={formatNumber(data?.errorCount)}
          icon={<TriangleAlert className="size-4" />}
          loading={query.loading}
          warning={Boolean(data?.errorCount)}
        />
      </div>
      {data?.budgetUsd != null ? (
        <div className="mt-4 rounded-lg border bg-white p-4">
          <div className="mb-2 flex justify-between text-xs">
            <span className="font-medium">工作區預算</span>
            <span>
              {formatCurrency(data.totalCostUsd)} / {formatCurrency(data.budgetUsd)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-[#e9ece9]">
            <div
              className={`h-full ${Number(data.totalCostUsd ?? 0) > data.budgetUsd ? 'bg-[#d92d20]' : 'bg-[#3d9b6b]'}`}
              style={{
                width: `${Math.min(100, ((data.totalCostUsd ?? 0) / Math.max(data.budgetUsd, 0.01)) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">成本趨勢</h2>
          </div>
          {query.loading ? (
            <div className="h-72 m-4 rounded bg-[#eef1ee] animate-pulse-soft" />
          ) : data?.series?.length ? (
            <CostChart series={data.series} />
          ) : (
            <EmptyState compact title="尚無用量資料" />
          )}
        </Panel>
        <Panel>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Token 組成</h2>
          </div>
          <div className="p-5">
            <div className="flex h-3 overflow-hidden rounded bg-[#ecefec]">
              <div
                className="bg-[#327d58]"
                style={{ width: `${ratio(data?.inputTokens, data?.totalTokens)}%` }}
              />
              <div
                className="bg-[#d48a22]"
                style={{ width: `${ratio(data?.outputTokens, data?.totalTokens)}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Legend color="bg-[#327d58]" label="Input" value={formatNumber(data?.inputTokens)} />
              <Legend
                color="bg-[#d48a22]"
                label="Output"
                value={formatNumber(data?.outputTokens)}
              />
            </div>
          </div>
        </Panel>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Breakdown title="按模型" rows={data?.byModel ?? []} />
        <Breakdown title="按 Agent" rows={data?.byAgent ?? []} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  loading,
  warning,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading: boolean;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div
        className={`flex items-center justify-between text-xs ${warning ? 'text-[#a15c00]' : 'text-[var(--muted)]'}`}
      >
        <span>{label}</span>
        {icon}
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-20 rounded bg-[#e9ece9] animate-pulse-soft" />
      ) : (
        <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}
function ratio(value?: number, total?: number) {
  return total ? ((value ?? 0) / total) * 100 : 0;
}
function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <span className={`size-2 rounded-full ${color}`} />
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
function CostChart({ series }: { series: UsagePoint[] }) {
  const max = Math.max(...series.map((point) => point.costUsd ?? 0), 0.0001);
  return (
    <div className="flex h-72 items-end gap-1 px-4 pb-4 pt-8">
      {series.map((point) => (
        <div key={point.date} className="group relative flex h-full flex-1 items-end">
          <div
            className="w-full rounded-t-sm bg-[#d7a04f] group-hover:bg-[#a15c00]"
            style={{ height: `${Math.max(2, ((point.costUsd ?? 0) / max) * 100)}%` }}
          />
          <span className="absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#202823] px-2 py-1 text-[10px] text-white group-hover:block">
            {formatDate(point.date, false)} · {formatCurrency(point.costUsd, 4)}
          </span>
        </div>
      ))}
    </div>
  );
}
function Breakdown({ title, rows }: { title: string; rows: UsageBreakdown[] }) {
  const maximum = Math.max(...rows.map((row) => row.costUsd ?? 0), 0.0001);
  return (
    <Panel>
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {rows.length ? (
        <div className="divide-y">
          {rows.slice(0, 8).map((row) => (
            <div key={row.name} className="px-4 py-3">
              <div className="flex justify-between gap-3 text-xs">
                <span className="truncate font-medium">{row.name}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(row.costUsd, 4)}</span>
              </div>
              <div className="mt-2 h-1.5 rounded bg-[#edf0ed]">
                <div
                  className="h-full rounded bg-[#6ba686]"
                  style={{ width: `${((row.costUsd ?? 0) / maximum) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {formatNumber(row.tokens)} tokens · {formatNumber(row.requests)} requests
              </p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact title="尚無資料" />
      )}
    </Panel>
  );
}
