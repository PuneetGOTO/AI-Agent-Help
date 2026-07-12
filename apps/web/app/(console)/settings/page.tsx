'use client';

import { Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ErrorState, FullPageLoading } from '@/components/states';
import {
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  Switch,
  Textarea,
  useToast,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { toMessage } from '@/lib/utils';

interface SettingsForm {
  name: string;
  description: string;
  monthlyBudgetUsd: string;
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  dataRetentionDays: number;
  allowedToolDomains: string;
  piiMaskingEnabled: boolean;
}

const emptyForm: SettingsForm = {
  name: '',
  description: '',
  monthlyBudgetUsd: '',
  rateLimitPerMinute: 60,
  concurrencyLimit: 10,
  dataRetentionDays: 90,
  allowedToolDomains: '',
  piiMaskingEnabled: true,
};

export default function SettingsPage() {
  const auth = useAuth();
  const query = useApiQuery<Workspace>('/settings/workspace');
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const canManage = auth.can('workspace:update');
  useEffect(() => {
    if (!query.data) return;
    setForm({
      name: query.data.name,
      description: query.data.description ?? '',
      monthlyBudgetUsd:
        query.data.monthlyBudgetUsd == null ? '' : String(query.data.monthlyBudgetUsd),
      rateLimitPerMinute: query.data.rateLimitPerMinute ?? 60,
      concurrencyLimit: query.data.concurrencyLimit ?? 10,
      dataRetentionDays: query.data.dataRetentionDays ?? 90,
      allowedToolDomains: (query.data.allowedToolDomains ?? []).join('\n'),
      piiMaskingEnabled: query.data.piiMaskingEnabled ?? true,
    });
  }, [query.data]);
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const domains = form.allowedToolDomains
        .split(/[\n,]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      await apiRequest('/settings/workspace', {
        method: 'PATCH',
        body: {
          name: form.name.trim(),
          description: form.description.trim(),
          monthlyBudgetUsd: form.monthlyBudgetUsd === '' ? null : Number(form.monthlyBudgetUsd),
          rateLimitPerMinute: form.rateLimitPerMinute,
          concurrencyLimit: form.concurrencyLimit,
          dataRetentionDays: form.dataRetentionDays,
          allowedToolDomains: domains,
          piiMaskingEnabled: form.piiMaskingEnabled,
        },
      });
      toast.push('工作區設定已儲存');
      await query.refetch();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setSaving(false);
    }
  };
  if (query.loading) return <FullPageLoading label="載入系統設定" />;
  if (query.error)
    return (
      <ErrorState title="無法載入設定" error={query.error} onRetry={() => void query.refetch()} />
    );
  return (
    <div className="animate-enter">
      <PageHeader
        title="系統設定"
        description="工作區預算、執行限制、資料保留與工具安全政策。"
        actions={
          <Button disabled={!canManage} loading={saving} onClick={() => void save()}>
            <Save className="size-4" />
            儲存設定
          </Button>
        }
      />
      {error ? (
        <div className="mb-4 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-4 py-3 text-sm text-[#98281f]">
          {error}
        </div>
      ) : null}
      <div className="space-y-5">
        <Panel>
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">工作區資料</h2>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="名稱" required>
              <Input
                disabled={!canManage}
                value={form.name}
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            <Field className="sm:col-span-2" label="描述">
              <Textarea
                disabled={!canManage}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </Field>
          </div>
        </Panel>
        <Panel>
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">預算與執行限制</h2>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="每月預算（USD）" hint="留空表示不設上限">
              <Input
                disabled={!canManage}
                type="number"
                min="0"
                step="0.01"
                value={form.monthlyBudgetUsd}
                onChange={(event) => set('monthlyBudgetUsd', event.target.value)}
              />
            </Field>
            <Field label="每分鐘執行數">
              <Input
                disabled={!canManage}
                type="number"
                min="1"
                max="10000"
                value={form.rateLimitPerMinute}
                onChange={(event) => set('rateLimitPerMinute', Number(event.target.value))}
              />
            </Field>
            <Field label="同時執行上限">
              <Input
                disabled={!canManage}
                type="number"
                min="1"
                max="1000"
                value={form.concurrencyLimit}
                onChange={(event) => set('concurrencyLimit', Number(event.target.value))}
              />
            </Field>
            <Field label="資料保留天數">
              <Input
                disabled={!canManage}
                type="number"
                min="1"
                max="3650"
                value={form.dataRetentionDays}
                onChange={(event) => set('dataRetentionDays', Number(event.target.value))}
              />
            </Field>
          </div>
        </Panel>
        <Panel>
          <div className="border-b px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" />
              安全政策
            </h2>
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[1fr_320px]">
            <Field
              label="工具目的地 allowlist"
              hint="每行一個 hostname，不包含協定、port 或 path。"
            >
              <Textarea
                disabled={!canManage}
                className="min-h-40 font-mono text-xs"
                value={form.allowedToolDomains}
                onChange={(event) => set('allowedToolDomains', event.target.value)}
                placeholder={'api.example.com\nhooks.example.com'}
              />
            </Field>
            <div className="flex items-start justify-between gap-4 rounded-md border p-4">
              <span>
                <span className="block text-sm font-medium">敏感資料遮罩</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                  Run preview、錯誤與審計記錄使用安全投影。
                </span>
              </span>
              <Switch
                label="敏感資料遮罩"
                disabled={!canManage}
                checked={form.piiMaskingEnabled}
                onCheckedChange={(value) => set('piiMaskingEnabled', value)}
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
