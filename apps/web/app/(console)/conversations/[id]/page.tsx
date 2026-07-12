'use client';

import {
  ArrowLeft,
  Bot,
  Braces,
  Clock3,
  MessageSquareText,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Badge, Button, Dialog, Field, Panel, Textarea, useToast } from '@/components/ui';
import { ErrorState, FullPageLoading } from '@/components/states';
import { apiRequest } from '@/lib/api';
import type { ChatMessage, Conversation, Run, TraceEvent } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { cn, formatCurrency, formatDate, formatNumber, toMessage } from '@/lib/utils';

export default function ConversationDetailPage() {
  const auth = useAuth();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const query = useApiQuery<Conversation>(params.id ? `/conversations/${params.id}` : null);
  const selectedRunId = search.get('run') ?? query.data?.runs?.[0]?.id;
  const runQuery = useApiQuery<Run>(selectedRunId ? `/runs/${selectedRunId}` : null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>();
  const [rejectReason, setRejectReason] = useState('');
  const [approvalBusy, setApprovalBusy] = useState(false);
  if (query.loading) return <FullPageLoading label="載入對話" />;
  if (query.error)
    return (
      <ErrorState title="無法載入對話" error={query.error} onRetry={() => void query.refetch()} />
    );
  if (!query.data) return null;
  const conversation = query.data;
  const messages = conversation.messages ?? [];
  const run = runQuery.data;
  const pendingApproval = run?.trace?.find((event) => event.canApprove);
  const decideApproval = async () => {
    if (!approvalAction || !pendingApproval?.id) return;
    setApprovalBusy(true);
    try {
      await apiRequest(`/tool-executions/${pendingApproval.id}/${approvalAction}`, {
        method: 'POST',
        ...(approvalAction === 'reject'
          ? { body: { reason: rejectReason.trim() || undefined } }
          : {}),
      });
      toast.push(approvalAction === 'approve' ? '工具執行已批准' : '工具執行已拒絕');
      setApprovalAction(undefined);
      setRejectReason('');
      await Promise.all([query.refetch(), runQuery.refetch()]);
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setApprovalBusy(false);
    }
  };
  return (
    <div className="animate-enter">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/conversations" aria-label="返回對話記錄">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <span className="grid size-9 place-items-center rounded-md bg-[#f3eee5] text-[#8a5c16]">
          <MessageSquareText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{conversation.title || '未命名對話'}</h1>
          <p className="text-xs text-[var(--muted)]">
            {conversation.agent?.name ?? 'Agent'} · {formatDate(conversation.createdAt)}
          </p>
        </div>
      </header>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="overflow-hidden">
          <div className="border-b bg-[#fafbfa] px-4 py-3 text-xs text-[var(--muted)]">
            {messages.length} 則訊息
          </div>
          {messages.length ? (
            <div className="space-y-5 p-4 sm:p-6">
              {messages.map((message, index) => (
                <StoredMessage key={message.id ?? index} message={message} />
              ))}
            </div>
          ) : (
            <div className="p-10 text-center text-sm text-[var(--muted)]">此對話沒有可見訊息</div>
          )}
        </Panel>
        <aside className="space-y-4">
          <Panel>
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">執行資訊</h2>
            </div>
            {runQuery.loading ? (
              <div className="h-40 bg-[#f4f6f4] animate-pulse-soft" />
            ) : runQuery.error ? (
              <ErrorState error={runQuery.error} onRetry={() => void runQuery.refetch()} compact />
            ) : run ? (
              <>
                <dl className="grid grid-cols-2 gap-px bg-[var(--border)]">
                  <Info label="狀態" value={run.status} badge />
                  <Info label="模型" value={run.model ?? '-'} />
                  <Info label="Token" value={formatNumber(run.totalTokens)} />
                  <Info label="成本" value={formatCurrency(run.costUsd, 4)} />
                  <Info label="延遲" value={run.latencyMs ? `${run.latencyMs} ms` : '-'} />
                  <Info label="開始時間" value={formatDate(run.startedAt ?? run.createdAt)} />
                </dl>
                {run.error ? (
                  <div className="flex gap-2 border-t bg-[#fff7f6] p-4 text-xs leading-5 text-[#98281f]">
                    <TriangleAlert className="size-4 shrink-0" />
                    {run.error}
                  </div>
                ) : null}
                {pendingApproval ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-[#fffaf0] p-4">
                    <span className="text-xs text-[#79520d]">
                      工具「{pendingApproval.name ?? '未命名'}」等待人工決策
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!auth.can('tool:manage')}
                        onClick={() => setApprovalAction('reject')}
                      >
                        拒絕
                      </Button>
                      <Button
                        size="sm"
                        disabled={!auth.can('tool:manage')}
                        onClick={() => setApprovalAction('approve')}
                      >
                        批准
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-8 text-center text-xs text-[var(--muted)]">沒有執行資訊</div>
            )}
          </Panel>
          {conversation.runs && conversation.runs.length > 1 ? (
            <Panel>
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Runs</h2>
              </div>
              <div className="divide-y">
                {conversation.runs.map((item) => (
                  <Link
                    key={item.id}
                    href={`/conversations/${conversation.id}?run=${item.id}`}
                    className={cn(
                      'flex items-center justify-between px-4 py-3 text-xs hover:bg-[#fafbfa]',
                      item.id === selectedRunId && 'bg-[#edf6f1]',
                    )}
                  >
                    <span>{formatDate(item.startedAt ?? item.createdAt)}</span>
                    <Badge>{item.status}</Badge>
                  </Link>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel>
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Trace</h2>
            </div>
            {run?.trace?.length ? (
              <div className="max-h-96 divide-y overflow-y-auto">
                {run.trace.map((event, index) => (
                  <TraceItem key={`${event.type}-${index}`} event={event} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-[var(--muted)]">沒有 Debug trace</div>
            )}
          </Panel>
        </aside>
      </div>
      <Dialog
        open={Boolean(approvalAction)}
        onClose={() => setApprovalAction(undefined)}
        title={approvalAction === 'approve' ? '批准工具執行' : '拒絕工具執行'}
        description={
          approvalAction === 'approve'
            ? '批准後將立即使用已驗證的參數執行工具。'
            : '拒絕後此 Run 會標記為已取消。'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setApprovalAction(undefined)}>
              取消
            </Button>
            <Button
              variant={approvalAction === 'reject' ? 'danger' : 'primary'}
              loading={approvalBusy}
              onClick={() => void decideApproval()}
            >
              確認{approvalAction === 'approve' ? '批准' : '拒絕'}
            </Button>
          </>
        }
      >
        {approvalAction === 'reject' ? (
          <Field label="拒絕原因">
            <Textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              maxLength={500}
            />
          </Field>
        ) : (
          <p className="text-sm">工具：{pendingApproval?.name ?? '未命名'}</p>
        )}
      </Dialog>
    </div>
  );
}

function StoredMessage({ message }: { message: ChatMessage }) {
  const role = message.role.toLowerCase();
  const isUser = role === 'user';
  const isTool = role === 'tool';
  return (
    <article className={cn('flex gap-3', isUser && 'justify-end')}>
      <span
        className={cn(
          'mt-1 grid size-7 shrink-0 place-items-center rounded-md',
          isUser
            ? 'order-2 bg-[#28372e] text-white'
            : isTool
              ? 'bg-[#fff3d6] text-[#8a5c16]'
              : 'bg-[#e9f3ed] text-[#18794e]',
        )}
      >
        {isUser ? (
          <span className="text-[10px]">U</span>
        ) : isTool ? (
          <Wrench className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
      </span>
      <div
        className={cn(
          'max-w-[86%] rounded-lg px-4 py-3 text-sm leading-6',
          isUser ? 'bg-[#28372e] text-white' : 'border bg-[#fafbfa]',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {message.createdAt ? (
          <p className={cn('mt-2 text-[10px]', isUser ? 'text-white/60' : 'text-[var(--muted)]')}>
            {formatDate(message.createdAt)}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function Info({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <dt className="text-[10px] uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate text-xs font-medium">
        {badge ? <Badge>{value}</Badge> : value}
      </dd>
    </div>
  );
}

function TraceItem({ event }: { event: TraceEvent }) {
  const icon =
    event.type === 'tool_call' ? (
      <Wrench className="size-3.5" />
    ) : event.type === 'usage' ? (
      <Braces className="size-3.5" />
    ) : (
      <Clock3 className="size-3.5" />
    );
  return (
    <div className="flex gap-2 px-4 py-3">
      {icon}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{event.name ?? event.type}</span>
        <span className="text-[10px] text-[var(--muted)]">
          {event.status ?? '-'}
          {event.durationMs ? ` · ${event.durationMs} ms` : ''}
        </span>
      </span>
    </div>
  );
}
