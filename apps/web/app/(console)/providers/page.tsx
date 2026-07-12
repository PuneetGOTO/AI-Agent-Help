'use client';

import {
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
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
import type { ProviderConnection, ProviderType } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, cn, formatDate, toMessage } from '@/lib/utils';

const providerLabels: Record<ProviderType, string> = {
  OPENAI: 'OpenAI',
  AZURE_OPENAI: 'Azure OpenAI',
  ANTHROPIC: 'Anthropic',
  GOOGLE_GEMINI: 'Google Gemini',
  AWS_BEDROCK: 'AWS Bedrock',
  OLLAMA: 'Ollama',
  OPENAI_COMPATIBLE: 'OpenAI-compatible',
};

export default function ProvidersPage() {
  const auth = useAuth();
  const query = useApiQuery<unknown>('/providers');
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [validating, setValidating] = useState<string>();
  const [removing, setRemoving] = useState<ProviderConnection>();
  const [busyRemove, setBusyRemove] = useState(false);
  const providers = asPaginated<ProviderConnection>(query.data).items;
  const canManage = auth.can('provider:manage');

  const validate = async (provider: ProviderConnection) => {
    setValidating(provider.id);
    try {
      await apiRequest(`/providers/${provider.id}/validate`, { method: 'POST' });
      toast.push(`「${provider.name}」驗證成功`);
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setValidating(undefined);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusyRemove(true);
    try {
      await apiRequest(`/providers/${removing.id}`, { method: 'DELETE' });
      toast.push(`已移除「${removing.name}」`);
      setRemoving(undefined);
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setBusyRemove(false);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        title="Provider 連接"
        description="管理模型供應商憑證、端點與能力檢測。密鑰只會加密儲存在後端。"
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={!canManage}
            title={!canManage ? '需要 provider:manage 權限' : undefined}
          >
            <Plus className="size-4" />
            新增連接
          </Button>
        }
      />
      <Panel>
        {query.loading ? (
          <SkeletonRows rows={6} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : providers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">連接</th>
                  <th className="px-4 py-2.5 font-semibold">能力</th>
                  <th className="px-4 py-2.5 font-semibold">憑證</th>
                  <th className="px-4 py-2.5 font-semibold">最後驗證</th>
                  <th className="px-4 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {providers.map((provider) => (
                  <tr key={provider.id} className="align-top hover:bg-[#fafbfa]">
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <span className="grid size-9 place-items-center rounded-md bg-[#ecefeb] text-[#465149]">
                          <ServerCog className="size-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{provider.name}</span>
                          <span className="block text-xs text-[var(--muted)]">
                            {providerLabels[provider.type as ProviderType] ?? provider.type}
                          </span>
                          {provider.baseUrl ? (
                            <span className="mt-1 block max-w-xs truncate font-mono text-[10px] text-[#7b857e]">
                              {provider.baseUrl}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {capabilityNames(provider.capabilities).length ? (
                          capabilityNames(provider.capabilities)
                            .slice(0, 5)
                            .map((capability) => (
                              <Badge key={capability} tone="neutral">
                                {capability}
                              </Badge>
                            ))
                        ) : (
                          <span className="text-xs text-[var(--muted)]">尚未偵測</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 font-mono text-xs text-[var(--muted)]">
                        <KeyRound className="size-3.5" />
                        {provider.credentialFingerprint ?? '已加密'}
                      </span>
                      <Badge tone={provider.isEnabled === false ? 'neutral' : 'success'}>
                        {provider.isEnabled === false ? 'Disabled' : 'Enabled'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[var(--muted)]">
                        {formatDate(provider.lastValidatedAt)}
                      </span>
                      {provider.lastValidationError ? (
                        <span className="mt-1 flex max-w-xs items-start gap-1 text-[11px] text-[var(--danger)]">
                          <ShieldAlert className="mt-0.5 size-3 shrink-0" />
                          {provider.lastValidationError}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={validating === provider.id}
                          onClick={() => void validate(provider)}
                          disabled={!canManage}
                        >
                          {validating !== provider.id ? <RefreshCw className="size-3.5" /> : null}
                          驗證
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRemoving(provider)}
                          disabled={!canManage}
                          aria-label={`移除 ${provider.name}`}
                        >
                          <Trash2 className="size-4 text-[var(--danger)]" />
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
            title="尚未配置 Provider"
            description="新增供應商連接後，Agent 才能選擇及調用模型。"
            icon={<ServerCog className="size-5" />}
            action={
              canManage ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  新增連接
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
      <CreateProviderDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await query.refetch();
        }}
      />
      <Dialog
        open={Boolean(removing)}
        onClose={() => setRemoving(undefined)}
        title="移除 Provider 連接"
        description="被 Agent 版本引用的連接無法移除。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(undefined)}>
              取消
            </Button>
            <Button variant="danger" loading={busyRemove} onClick={() => void remove()}>
              <Trash2 className="size-4" />
              確認移除
            </Button>
          </>
        }
      >
        <p className="text-sm">確定移除「{removing?.name}」？密鑰與連接設定會永久刪除。</p>
      </Dialog>
    </div>
  );
}

interface ProviderForm {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  organization: string;
  azureApiVersion: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
  geminiAuthMode: 'api-key' | 'vertex-adc';
  projectId: string;
  location: string;
}

const initialForm: ProviderForm = {
  name: '',
  type: 'OPENAI',
  baseUrl: '',
  apiKey: '',
  organization: '',
  azureApiVersion: '2024-10-21',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  region: 'us-east-1',
  geminiAuthMode: 'api-key',
  projectId: '',
  location: 'us-central1',
};

function CreateProviderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState<ProviderForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const set = <Key extends keyof ProviderForm>(key: Key, value: ProviderForm[Key]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const requiresBaseUrl = ['AZURE_OPENAI', 'OPENAI_COMPATIBLE', 'OLLAMA'].includes(form.type);
  const isAws = form.type === 'AWS_BEDROCK';
  const isGemini = form.type === 'GOOGLE_GEMINI';
  const isVertexAdc = isGemini && form.geminiAuthMode === 'vertex-adc';

  const submit = async () => {
    if (form.name.trim().length < 2) {
      setError('連接名稱至少需要 2 個字元');
      return;
    }
    if (requiresBaseUrl && !form.baseUrl) {
      setError('此 Provider 需要 Base URL');
      return;
    }
    if (isAws && (!form.accessKeyId || !form.secretAccessKey)) {
      setError('請輸入 AWS Access Key ID 與 Secret Access Key');
      return;
    }
    if (isVertexAdc && (!form.projectId.trim() || !form.location.trim())) {
      setError('請輸入 Vertex AI Project ID 與 Location');
      return;
    }
    if (!isAws && form.type !== 'OLLAMA' && !isVertexAdc && !form.apiKey) {
      setError('請輸入 API Key');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const credentials = isAws
        ? {
            accessKeyId: form.accessKeyId,
            secretAccessKey: form.secretAccessKey,
            ...(form.sessionToken ? { sessionToken: form.sessionToken } : {}),
            region: form.region,
          }
        : isVertexAdc
          ? {
              projectId: form.projectId.trim(),
              location: form.location.trim(),
            }
          : {
              apiKey: form.apiKey,
              ...(form.organization ? { organization: form.organization } : {}),
              ...(form.type === 'AZURE_OPENAI' ? { azureApiVersion: form.azureApiVersion } : {}),
            };
      await apiRequest('/providers', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          type: form.type,
          ...(form.baseUrl ? { baseUrl: form.baseUrl.trim() } : {}),
          credentials,
          ...(isVertexAdc ? { config: { enterprise: true } } : {}),
        },
      });
      setForm(initialForm);
      toast.push('Provider 連接已建立');
      await onCreated();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新增 Provider 連接"
      description="憑證送達後端後會以 AES-256-GCM 加密，前端不會保存。"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            <CheckCircle2 className="size-4" />
            建立連接
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="連接名稱" required>
          <Input
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            autoFocus
            placeholder="Production OpenAI"
          />
        </Field>
        <Field label="Provider" required>
          <Select
            value={form.type}
            onChange={(event) => set('type', event.target.value as ProviderType)}
          >
            {Object.entries(providerLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          className="sm:col-span-2"
          label="Base URL"
          required={requiresBaseUrl}
          hint={
            form.type === 'OLLAMA'
              ? '端點必須由部署端 Ollama allowlist 批准。'
              : '留空使用供應商官方端點；自訂端點必須使用 HTTPS。'
          }
        >
          <Input
            type="url"
            value={form.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            placeholder={
              form.type === 'OLLAMA'
                ? 'http://host.docker.internal:11434/v1'
                : 'https://api.example.com'
            }
          />
        </Field>
        {isGemini ? (
          <Field className="sm:col-span-2" label="認證模式" required>
            <div className="grid grid-cols-2 rounded-md border bg-[#f6f8f6] p-1">
              {(
                [
                  ['api-key', 'Gemini API Key'],
                  ['vertex-adc', 'Vertex AI ADC'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.geminiAuthMode === value}
                  onClick={() => set('geminiAuthMode', value)}
                  className={cn(
                    'h-8 rounded text-xs font-medium transition-colors',
                    form.geminiAuthMode === value
                      ? 'bg-white text-[var(--foreground)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--foreground)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        ) : null}
        {isAws ? (
          <>
            <Field label="Access Key ID" required>
              <Input
                type="password"
                autoComplete="off"
                value={form.accessKeyId}
                onChange={(event) => set('accessKeyId', event.target.value)}
              />
            </Field>
            <Field label="Secret Access Key" required>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.secretAccessKey}
                onChange={(event) => set('secretAccessKey', event.target.value)}
              />
            </Field>
            <Field label="Region" required>
              <Input value={form.region} onChange={(event) => set('region', event.target.value)} />
            </Field>
            <Field label="Session Token">
              <Input
                type="password"
                autoComplete="off"
                value={form.sessionToken}
                onChange={(event) => set('sessionToken', event.target.value)}
              />
            </Field>
          </>
        ) : form.type !== 'OLLAMA' && !isVertexAdc ? (
          <Field className="sm:col-span-2" label="API Key" required>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(event) => set('apiKey', event.target.value)}
            />
          </Field>
        ) : null}
        {isVertexAdc ? (
          <>
            <Field label="Project ID" required>
              <Input
                value={form.projectId}
                onChange={(event) => set('projectId', event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Location" required>
              <Input
                value={form.location}
                onChange={(event) => set('location', event.target.value)}
                placeholder="us-central1"
              />
            </Field>
          </>
        ) : null}
        {form.type === 'OPENAI' ? (
          <Field label="Organization ID">
            <Input
              value={form.organization}
              onChange={(event) => set('organization', event.target.value)}
            />
          </Field>
        ) : null}
        {form.type === 'AZURE_OPENAI' ? (
          <Field label="API Version">
            <Input
              value={form.azureApiVersion}
              onChange={(event) => set('azureApiVersion', event.target.value)}
            />
          </Field>
        ) : null}
      </div>
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

function capabilityNames(value?: string[] | Record<string, boolean>) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return Object.entries(value ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}
