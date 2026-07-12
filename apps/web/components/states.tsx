'use client';

import { Ban, CircleAlert, Inbox, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui';

export function FullPageLoading({ label = '載入中' }: { label?: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <LoaderCircle className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y', className)} aria-label="載入中" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex h-14 items-center gap-3 px-4">
          <span className="size-8 rounded-md bg-[#e8ebe8] animate-pulse-soft" />
          <span className="h-3 w-1/4 rounded bg-[#e8ebe8] animate-pulse-soft" />
          <span className="ml-auto h-3 w-24 rounded bg-[#eef0ee] animate-pulse-soft" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-9' : 'min-h-72 py-14',
      )}
    >
      <div className="mb-3 grid size-10 place-items-center rounded-md border bg-[#f6f8f6] text-[var(--muted)]">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = '無法載入資料',
  error,
  onRetry,
  compact,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (error instanceof ApiClientError && (error.status === 401 || error.status === 403))
    return <UnauthorizedState detail={error.message} compact={compact} />;
  const message = error instanceof Error ? error.message : '服務暫時不可用';
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'min-h-72 py-14',
      )}
    >
      <CircleAlert className="mb-3 size-8 text-[var(--danger)]" />
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-lg text-sm leading-6 text-[var(--muted)]">{message}</p>
      {requestId ? (
        <p className="mt-1 font-mono text-[11px] text-[#88918b]">Request ID: {requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> 重試
        </Button>
      ) : null}
    </div>
  );
}

export function UnauthorizedState({ detail, compact }: { detail?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'min-h-72 py-14',
      )}
    >
      <LockKeyhole className="mb-3 size-8 text-[#8a4b00]" />
      <h3 className="text-sm font-semibold">沒有存取權限</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-[var(--muted)]">
        {detail ?? '請聯絡工作區管理員調整你的角色或權限。'}
      </p>
    </div>
  );
}

export function DisabledState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
      <Ban className="mb-3 size-7 text-[var(--muted)]" />
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
