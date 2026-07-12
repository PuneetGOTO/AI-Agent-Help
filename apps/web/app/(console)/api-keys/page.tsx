'use client';

import { Clipboard, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';
import {
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  useToast,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { Agent, ApiKey } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatDate, toMessage } from '@/lib/utils';

export default function ApiKeysPage() {
  const auth = useAuth();
  const query = useApiQuery<unknown>('/api-keys?pageSize=100');
  const agentsQuery = useApiQuery<unknown>('/agents?pageSize=100');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<string>();
  const keys = asPaginated<ApiKey>(query.data).items;
  const agents = asPaginated<Agent>(agentsQuery.data).items;
  const canManage = auth.can('api-key:manage');

  const revoke = async (key: ApiKey) => {
    if (!window.confirm(`撤銷 API Key「${key.name}」？此操作立即生效。`)) return;
    setRevoking(key.id);
    try {
      await apiRequest(`/api-keys/${key.id}`, { method: 'DELETE' });
      toast.push('API Key 已撤銷');
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setRevoking(undefined);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        title="API Keys"
        description="建立可撤銷、具工作區與 Agent 範圍的企業系統存取權杖。"
        actions={
          <Button disabled={!canManage} onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            建立 API Key
          </Button>
        }
      />
      <Panel>
        {query.loading ? (
          <SkeletonRows rows={7} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : keys.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5">名稱</th>
                  <th className="px-4 py-2.5">類型 / 範圍</th>
                  <th className="px-4 py-2.5">建立時間</th>
                  <th className="px-4 py-2.5">最後使用</th>
                  <th className="px-4 py-2.5">狀態</th>
                  <th className="w-14 px-4 py-2.5">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {keys.map((key) => (
                  <tr key={key.id} className="hover:bg-[#fafbfa]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-md bg-[#edf0ed]">
                          <KeyRound className="size-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{key.name}</span>
                          <span className="block font-mono text-[11px] text-[var(--muted)]">
                            {key.prefix}…
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{key.type ?? 'PLATFORM'}</Badge>
                      {key.agent ? <span className="ml-2 text-xs">{key.agent.name}</span> : null}
                      <span className="mt-1 block max-w-xs truncate text-[10px] text-[var(--muted)]">
                        {key.scopes?.join(', ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      {formatDate(key.lastUsedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          key.revokedAt
                            ? 'danger'
                            : key.expiresAt && new Date(key.expiresAt) <= new Date()
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {key.revokedAt ? 'Revoked' : 'Active'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canManage || Boolean(key.revokedAt) || revoking === key.id}
                        onClick={() => void revoke(key)}
                        aria-label="撤銷 API Key"
                      >
                        <Trash2 className="size-4 text-[var(--danger)]" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="尚未建立 API Key"
            description="建立平台或 Agent 專用權杖，明文只會顯示一次。"
            icon={<KeyRound className="size-5" />}
            action={
              canManage ? (
                <Button onClick={() => setOpen(true)}>
                  <Plus className="size-4" />
                  建立 API Key
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
      <CreateKeyDialog
        open={open}
        agents={agents}
        onClose={() => setOpen(false)}
        onCreated={async () => {
          await query.refetch();
        }}
      />
    </div>
  );
}

function CreateKeyDialog({
  open,
  agents,
  onClose,
  onCreated,
}: {
  open: boolean;
  agents: Agent[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'PLATFORM' | 'AGENT'>('PLATFORM');
  const [agentId, setAgentId] = useState('');
  const [expiresIn, setExpiresIn] = useState('90');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selectedAgentId = agentId || agents[0]?.id || '';
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const expiresAt =
        expiresIn === 'never'
          ? undefined
          : new Date(Date.now() + Number(expiresIn) * 86_400_000).toISOString();
      const created = await apiRequest<ApiKey>('/api-keys', {
        method: 'POST',
        body: {
          name: name.trim(),
          type,
          ...(type === 'AGENT' ? { agentId: selectedAgentId, scopes: ['agent:run'] } : {}),
          expiresAt,
        },
      });
      setToken(created.token ?? '');
      await onCreated();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setName('');
    setType('PLATFORM');
    setAgentId('');
    setExpiresIn('90');
    setToken('');
    setError(undefined);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={token ? () => undefined : close}
      title={token ? 'API Key 已建立' : '建立 API Key'}
      description={token ? '這是唯一一次顯示完整權杖。' : '權杖只保存 HMAC hash，可隨時撤銷。'}
      footer={
        token ? (
          <Button onClick={close}>
            <ShieldCheck className="size-4" />
            我已保存
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              loading={busy}
              disabled={name.trim().length < 2 || (type === 'AGENT' && !selectedAgentId)}
              onClick={() => void submit()}
            >
              建立權杖
            </Button>
          </>
        )
      }
    >
      {token ? (
        <Field label="完整 API Key">
          <div className="flex gap-2">
            <Input readOnly value={token} className="font-mono" />
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void navigator.clipboard.writeText(token)}
              aria-label="複製 API Key"
            >
              <Clipboard className="size-4" />
            </Button>
          </div>
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名稱" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              placeholder="Production integration"
            />
          </Field>
          <Field label="類型">
            <Select
              value={type}
              onChange={(event) => setType(event.target.value as 'PLATFORM' | 'AGENT')}
            >
              <option value="PLATFORM">Platform</option>
              <option value="AGENT">Agent</option>
            </Select>
          </Field>
          {type === 'AGENT' ? (
            <Field className="sm:col-span-2" label="Agent" required>
              <Select value={selectedAgentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">選擇 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="有效期">
            <Select value={expiresIn} onChange={(event) => setExpiresIn(event.target.value)}>
              <option value="30">30 日</option>
              <option value="90">90 日</option>
              <option value="365">365 日</option>
              <option value="never">不自動過期</option>
            </Select>
          </Field>
        </div>
      )}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-3 py-2 text-sm text-[#98281f]"
        >
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
