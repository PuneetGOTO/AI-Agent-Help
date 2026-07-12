'use client';

import {
  Bot,
  Braces,
  ChevronLeft,
  Clock3,
  Code2,
  Database,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from './states';
import {
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Panel,
  Select,
  Switch,
  Textarea,
  useToast,
} from './ui';
import { apiRequest } from '@/lib/api';
import type {
  Agent,
  AgentVersion,
  KnowledgeBase,
  ModelInfo,
  ProviderConnection,
  Tool,
} from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, cn, formatDate, toMessage } from '@/lib/utils';

type Section = 'identity' | 'prompt' | 'tools' | 'advanced' | 'versions';

interface EditorForm {
  name: string;
  icon: string;
  description: string;
  tags: string;
  providerConnectionId: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  retryCount: number;
  streamEnabled: boolean;
  structuredOutputSchema: string;
  toolIds: string[];
  knowledgeBaseIds: string[];
  memoryMode: string;
  budgetUsd: string;
  changeNote: string;
}

const emptyForm: EditorForm = {
  name: '',
  icon: '',
  description: '',
  tags: '',
  providerConnectionId: '',
  model: '',
  systemPrompt: 'You are a precise and helpful enterprise assistant.',
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 60000,
  retryCount: 2,
  streamEnabled: true,
  structuredOutputSchema: '',
  toolIds: [],
  knowledgeBaseIds: [],
  memoryMode: 'SHORT_TERM',
  budgetUsd: '',
  changeNote: '',
};

function formFromAgent(agent: Agent): EditorForm {
  const version = agent.currentVersion ?? agent.publishedVersion;
  return {
    ...emptyForm,
    name: agent.name,
    icon: agent.icon ?? '',
    description: agent.description ?? '',
    tags: (agent.tags ?? []).join(', '),
    providerConnectionId: version?.providerConnectionId ?? '',
    model: version?.model ?? '',
    systemPrompt: version?.systemPrompt ?? emptyForm.systemPrompt,
    temperature: version?.temperature ?? 0.2,
    maxTokens: version?.maxTokens ?? 2048,
    timeoutMs: version?.timeoutMs ?? 60000,
    retryCount: version?.retryCount ?? 2,
    streamEnabled: version?.streamEnabled ?? true,
    structuredOutputSchema: version?.structuredOutputSchema
      ? JSON.stringify(version.structuredOutputSchema, null, 2)
      : '',
    toolIds: version?.toolIds ?? [],
    knowledgeBaseIds: version?.knowledgeBaseIds ?? [],
    memoryMode: version?.memoryMode ?? 'SHORT_TERM',
    budgetUsd: version?.budgetUsd == null ? '' : String(version.budgetUsd),
    changeNote: '',
  };
}

export function AgentEditor({ agent }: { agent?: Agent }) {
  const router = useRouter();
  const toast = useToast();
  const [section, setSection] = useState<Section>('identity');
  const [form, setForm] = useState<EditorForm>(() => (agent ? formFromAgent(agent) : emptyForm));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string>();
  const providersQuery = useApiQuery<unknown>('/providers');
  const toolsQuery = useApiQuery<unknown>('/tools?pageSize=100');
  const knowledgeQuery = useApiQuery<unknown>('/knowledge-bases?pageSize=100');
  const modelsQuery = useApiQuery<unknown>(
    form.providerConnectionId ? `/providers/${form.providerConnectionId}/models` : null,
  );
  const versionsQuery = useApiQuery<unknown>(
    agent ? `/agents/${agent.id}/versions?pageSize=100` : null,
  );
  const providers = asPaginated<ProviderConnection>(providersQuery.data).items.filter(
    (provider) => provider.isEnabled !== false,
  );
  const tools = asPaginated<Tool>(toolsQuery.data).items;
  const knowledgeBases = asPaginated<KnowledgeBase>(knowledgeQuery.data).items;
  const models = asPaginated<ModelInfo | string>(modelsQuery.data).items;
  const versions = asPaginated<AgentVersion>(versionsQuery.data).items;
  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!form.providerConnectionId && providers[0]) set('providerConnectionId', providers[0].id);
  }, [providers, form.providerConnectionId]);

  useEffect(() => {
    if (!form.model && models[0])
      set('model', typeof models[0] === 'string' ? models[0] : models[0].id);
  }, [models, form.model]);

  const configBody = () => {
    let schema: Record<string, unknown> | undefined;
    if (form.structuredOutputSchema.trim()) {
      const parsed: unknown = JSON.parse(form.structuredOutputSchema);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('JSON Schema 必須是一個物件');
      schema = parsed as Record<string, unknown>;
    }
    return {
      providerConnectionId: form.providerConnectionId,
      model: form.model.trim(),
      systemPrompt: form.systemPrompt,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      timeoutMs: form.timeoutMs,
      retryCount: form.retryCount,
      streamEnabled: form.streamEnabled,
      structuredOutputSchema: schema,
      toolIds: form.toolIds,
      knowledgeBaseIds: form.knowledgeBaseIds,
      memoryMode: form.memoryMode,
      budgetUsd: form.budgetUsd === '' ? undefined : Number(form.budgetUsd),
    };
  };

  const validate = () => {
    if (form.name.trim().length < 2) throw new Error('Agent 名稱至少需要 2 個字元');
    if (!form.providerConnectionId) throw new Error('請選擇 Provider 連接');
    if (!form.model.trim()) throw new Error('請選擇或輸入模型 ID');
    if (!form.systemPrompt.trim()) throw new Error('System Prompt 不可留空');
    if (form.temperature < 0 || form.temperature > 2)
      throw new Error('Temperature 必須介乎 0 至 2');
    return configBody();
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const config = validate();
      const metadata = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        icon: form.icon.trim() || undefined,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      if (!agent) {
        const created = await apiRequest<Agent>('/agents', {
          method: 'POST',
          body: { ...metadata, ...config },
        });
        toast.push('Agent 已建立');
        router.replace(`/agents/${created.id}`);
      } else {
        await apiRequest(`/agents/${agent.id}`, { method: 'PATCH', body: metadata });
        await apiRequest(`/agents/${agent.id}/versions`, {
          method: 'POST',
          body: { ...config, changeNote: form.changeNote.trim() || undefined },
        });
        toast.push('新版本草稿已儲存');
        router.refresh();
        await versionsQuery.refetch();
      }
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!agent) return;
    setPublishing(true);
    setError(undefined);
    try {
      await apiRequest(`/agents/${agent.id}/publish`, {
        method: 'POST',
        body: { versionId: agent.currentVersion?.id },
      });
      toast.push('Agent 已發布');
      router.refresh();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setPublishing(false);
    }
  };

  const rollback = async (version: AgentVersion) => {
    if (!agent) return;
    try {
      await apiRequest(`/agents/${agent.id}/rollback`, {
        method: 'POST',
        body: { versionId: version.id },
      });
      toast.push(`已回滾至 v${version.version ?? version.versionNumber}`);
      router.refresh();
      await versionsQuery.refetch();
    } catch (requestError) {
      toast.push(toMessage(requestError), 'danger');
    }
  };

  const remove = async () => {
    if (!agent) return;
    setDeleting(true);
    try {
      await apiRequest(`/agents/${agent.id}`, { method: 'DELETE' });
      toast.push('Agent 已刪除');
      router.replace('/agents');
    } catch (requestError) {
      toast.push(toMessage(requestError), 'danger');
      setDeleting(false);
    }
  };

  const sections: Array<{ id: Section; label: string; icon: typeof Bot; disabled?: boolean }> = [
    { id: 'identity', label: '基本設定', icon: Bot },
    { id: 'prompt', label: 'Prompt 與模型', icon: Code2 },
    { id: 'tools', label: '工具與記憶', icon: Wrench },
    { id: 'advanced', label: '進階設定', icon: SlidersHorizontal },
    { id: 'versions', label: '版本記錄', icon: Clock3, disabled: !agent },
  ];

  return (
    <div className="animate-enter">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/agents" aria-label="返回 Agents">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        <span className="grid size-9 place-items-center rounded-md bg-[#e9f3ed] text-base">
          {form.icon || <Bot className="size-4 text-[#18794e]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{agent ? agent.name : '建立 Agent'}</h1>
            {agent ? <Badge>{agent.status}</Badge> : <Badge tone="neutral">Draft</Badge>}
          </div>
          <p className="truncate text-xs text-[var(--muted)]">
            {agent ? `最後更新 ${formatDate(agent.updatedAt)}` : '配置第一個版本'}
          </p>
        </div>
        {agent ? (
          <Button asChild variant="secondary">
            <Link href={`/agents/${agent.id}/playground`}>
              <Play className="size-4" />
              Playground
            </Link>
          </Button>
        ) : null}
        <Button variant="secondary" loading={saving} onClick={() => void save()}>
          <Save className="size-4" />
          {agent ? '儲存新版本' : '建立'}
        </Button>
        {agent ? (
          <Button loading={publishing} onClick={() => void publish()}>
            <Rocket className="size-4" />
            發布
          </Button>
        ) : null}
      </div>
      <div className="grid gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto xl:block">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => setSection(item.id)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm text-[var(--muted)] hover:bg-white hover:text-[var(--foreground)] disabled:opacity-40 xl:mb-1 xl:w-full',
                section === item.id && 'bg-white font-medium text-[var(--accent)] shadow-xs',
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {error ? (
            <div className="mb-4 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-4 py-3 text-sm text-[#98281f]">
              {error}
            </div>
          ) : null}
          {section === 'identity' ? (
            <IdentitySection
              form={form}
              set={set}
              agent={agent}
              onDelete={() => setDeleteOpen(true)}
            />
          ) : null}
          {section === 'prompt' ? (
            <PromptSection
              form={form}
              set={set}
              providers={providers}
              models={models}
              providersLoading={providersQuery.loading}
              modelsLoading={modelsQuery.loading}
            />
          ) : null}
          {section === 'tools' ? (
            <ToolsSection
              form={form}
              set={set}
              tools={tools}
              knowledgeBases={knowledgeBases}
              loading={toolsQuery.loading}
              error={toolsQuery.error}
              knowledgeLoading={knowledgeQuery.loading}
              knowledgeError={knowledgeQuery.error}
            />
          ) : null}
          {section === 'advanced' ? <AdvancedSection form={form} set={set} /> : null}
          {section === 'versions' && agent ? (
            <VersionsSection
              versions={versions}
              loading={versionsQuery.loading}
              error={versionsQuery.error}
              publishedVersionId={agent.publishedVersion?.id}
              onRollback={rollback}
            />
          ) : null}
        </div>
      </div>
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="刪除 Agent"
        description="Agent 會被封存並從工作區列表隱藏，既有執行與審計記錄會保留。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              <Trash2 className="size-4" />
              確認刪除
            </Button>
          </>
        }
      >
        <p className="text-sm">確定封存「{agent?.name}」？</p>
      </Dialog>
    </div>
  );
}

function IdentitySection({
  form,
  set,
  agent,
  onDelete,
}: {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
  agent?: Agent;
  onDelete: () => void;
}) {
  return (
    <Panel>
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">基本設定</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Agent 在管理介面與嵌入元件中顯示的資料。</p>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[100px_1fr]">
        <Field label="圖標">
          <Input
            value={form.icon}
            onChange={(event) => set('icon', event.target.value)}
            maxLength={8}
            placeholder="AI"
          />
        </Field>
        <Field label="名稱" required>
          <Input
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            maxLength={100}
            autoFocus
          />
        </Field>
        <Field className="sm:col-span-2" label="描述">
          <Textarea
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            maxLength={500}
          />
        </Field>
        <Field className="sm:col-span-2" label="標籤" hint="以逗號分隔">
          <Input
            value={form.tags}
            onChange={(event) => set('tags', event.target.value)}
            placeholder="support, production"
          />
        </Field>
        {agent ? (
          <div className="sm:col-span-2 mt-3 border-t pt-5">
            <p className="text-xs font-semibold text-[var(--danger)]">危險操作</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 text-[var(--danger)]"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              刪除 Agent
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function PromptSection({
  form,
  set,
  providers,
  models,
  providersLoading,
  modelsLoading,
}: {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
  providers: ProviderConnection[];
  models: Array<ModelInfo | string>;
  providersLoading: boolean;
  modelsLoading: boolean;
}) {
  return (
    <div className="space-y-5">
      <Panel>
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">模型</h2>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Provider 連接" required>
            <Select
              value={form.providerConnectionId}
              disabled={providersLoading}
              onChange={(event) => {
                set('providerConnectionId', event.target.value);
                set('model', '');
              }}
            >
              <option value="">選擇連接</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.type}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="模型 ID"
            required
            hint={modelsLoading ? '正在從 Provider 讀取模型' : undefined}
          >
            <Input
              list="provider-models"
              value={form.model}
              onChange={(event) => set('model', event.target.value)}
              placeholder="gpt-4.1-mini"
            />
            <datalist id="provider-models">
              {models.map((model) => {
                const id = typeof model === 'string' ? model : model.id;
                return (
                  <option key={id} value={id}>
                    {typeof model === 'string' ? model : model.name}
                  </option>
                );
              })}
            </datalist>
          </Field>
          <Field label="Temperature">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={form.temperature}
                onChange={(event) => set('temperature', Number(event.target.value))}
                className="h-2 flex-1 accent-[#18794e]"
              />
              <Input
                type="number"
                min="0"
                max="2"
                step="0.1"
                className="w-20"
                value={form.temperature}
                onChange={(event) => set('temperature', Number(event.target.value))}
              />
            </div>
          </Field>
          <Field label="最大輸出 Token">
            <Input
              type="number"
              min="1"
              max="128000"
              value={form.maxTokens}
              onChange={(event) => set('maxTokens', Number(event.target.value))}
            />
          </Field>
        </div>
      </Panel>
      <Panel>
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">System Prompt</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">定義角色、邊界與回應要求。</p>
        </div>
        <div className="p-5">
          <Textarea
            className="min-h-[320px] font-mono text-[13px]"
            value={form.systemPrompt}
            onChange={(event) => set('systemPrompt', event.target.value)}
            spellCheck={false}
          />
        </div>
      </Panel>
    </div>
  );
}

function ToolsSection({
  form,
  set,
  tools,
  knowledgeBases,
  loading,
  error,
  knowledgeLoading,
  knowledgeError,
}: {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
  tools: Tool[];
  knowledgeBases: KnowledgeBase[];
  loading: boolean;
  error?: Error;
  knowledgeLoading: boolean;
  knowledgeError?: Error;
}) {
  const toggle = (id: string) =>
    set(
      'toolIds',
      form.toolIds.includes(id)
        ? form.toolIds.filter((value) => value !== id)
        : [...form.toolIds, id],
    );
  const toggleKnowledge = (id: string) =>
    set(
      'knowledgeBaseIds',
      form.knowledgeBaseIds.includes(id)
        ? form.knowledgeBaseIds.filter((value) => value !== id)
        : [...form.knowledgeBaseIds, id],
    );
  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">工具</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">只會執行已配置且通過參數驗證的工具。</p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/tools">
              <Plus className="size-3.5" />
              管理工具
            </Link>
          </Button>
        </div>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : error ? (
          <ErrorState error={error} compact />
        ) : tools.length ? (
          <div className="divide-y">
            {tools.map((tool) => (
              <label key={tool.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafbfa]">
                <input
                  type="checkbox"
                  checked={form.toolIds.includes(tool.id)}
                  onChange={() => toggle(tool.id)}
                  className="size-4 accent-[#18794e]"
                />
                <span className="grid size-8 place-items-center rounded-md bg-[#f0f2ef]">
                  <Wrench className="size-4 text-[var(--muted)]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{tool.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {tool.description || tool.type}
                  </span>
                </span>
                {tool.requiresApproval ? <Badge tone="warning">需審批</Badge> : null}
              </label>
            ))}
          </div>
        ) : (
          <EmptyState compact title="尚無可用工具" description="先建立工具，再將其配置給 Agent。" />
        )}
      </Panel>
      <Panel>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">知識庫與 RAG</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              執行時只檢索此版本明確綁定的工作區文件。
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/knowledge">
              <Plus className="size-3.5" />
              管理知識庫
            </Link>
          </Button>
        </div>
        {knowledgeLoading ? (
          <SkeletonRows rows={3} />
        ) : knowledgeError ? (
          <ErrorState error={knowledgeError} compact />
        ) : knowledgeBases.length ? (
          <div className="divide-y">
            {knowledgeBases.map((knowledgeBase) => (
              <label
                key={knowledgeBase.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafbfa]"
              >
                <input
                  type="checkbox"
                  checked={form.knowledgeBaseIds.includes(knowledgeBase.id)}
                  onChange={() => toggleKnowledge(knowledgeBase.id)}
                  className="size-4 accent-[#18794e]"
                />
                <span className="grid size-8 place-items-center rounded-md bg-[#edf0ed]">
                  <Database className="size-4 text-[var(--muted)]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{knowledgeBase.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {knowledgeBase.description ||
                      `${knowledgeBase.documentCount ?? knowledgeBase._count?.documents ?? 0} 份文件`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <EmptyState compact title="尚無知識庫" description="上傳文字文件後即可配置檢索增強。" />
        )}
      </Panel>
      <Panel>
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">記憶</h2>
        </div>
        <div className="p-5">
          <Field label="記憶模式">
            <Select
              value={form.memoryMode}
              onChange={(event) => set('memoryMode', event.target.value)}
            >
              <option value="NONE">不保留</option>
              <option value="SHORT_TERM">短期對話記憶</option>
              <option value="LONG_TERM" disabled>
                長期記憶（尚未啟用）
              </option>
            </Select>
          </Field>
        </div>
      </Panel>
    </div>
  );
}

function AdvancedSection({
  form,
  set,
}: {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <Panel>
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">執行策略</h2>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="逾時（毫秒）">
            <Input
              type="number"
              min="1000"
              max="300000"
              step="1000"
              value={form.timeoutMs}
              onChange={(event) => set('timeoutMs', Number(event.target.value))}
            />
          </Field>
          <Field label="重試次數">
            <Input
              type="number"
              min="0"
              max="3"
              value={form.retryCount}
              onChange={(event) => set('retryCount', Number(event.target.value))}
            />
          </Field>
          <Field label="每次執行預算（USD）" hint="留空表示沿用工作區預算">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.budgetUsd}
              onChange={(event) => set('budgetUsd', event.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <span>
              <span className="block text-xs font-medium">串流回答</span>
              <span className="block text-[11px] text-[var(--muted)]">透過 SSE 即時輸出</span>
            </span>
            <Switch
              label="串流回答"
              checked={form.streamEnabled}
              onCheckedChange={(value) => set('streamEnabled', value)}
            />
          </div>
        </div>
      </Panel>
      <Panel>
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Braces className="size-4" />
            <h2 className="text-sm font-semibold">結構化輸出</h2>
          </div>
        </div>
        <div className="p-5">
          <Field label="JSON Schema" hint="留空表示一般文字回答">
            <Textarea
              className="min-h-64 font-mono text-xs"
              value={form.structuredOutputSchema}
              onChange={(event) => set('structuredOutputSchema', event.target.value)}
              spellCheck={false}
              placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
            />
          </Field>
        </div>
      </Panel>
      <Panel>
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">版本說明</h2>
        </div>
        <div className="p-5">
          <Field label="Change note" hint="儲存既有 Agent 時會建立新草稿版本">
            <Input
              value={form.changeNote}
              onChange={(event) => set('changeNote', event.target.value)}
              maxLength={200}
              placeholder="例如：調整回應格式與工具權限"
            />
          </Field>
        </div>
      </Panel>
    </div>
  );
}

function VersionsSection({
  versions,
  loading,
  error,
  publishedVersionId,
  onRollback,
}: {
  versions: AgentVersion[];
  loading: boolean;
  error?: Error;
  publishedVersionId?: string;
  onRollback: (version: AgentVersion) => Promise<void>;
}) {
  return (
    <Panel>
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">版本記錄</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">發布、草稿與回滾紀錄。</p>
      </div>
      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState error={error} compact />
      ) : versions.length ? (
        <div className="divide-y">
          {versions.map((version) => (
            <div key={version.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span className="grid size-9 place-items-center rounded-md bg-[#eef1ee] text-xs font-semibold">
                v{version.version ?? version.versionNumber}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {version.model}
                  {publishedVersionId === version.id ? (
                    <Badge tone="success">Published</Badge>
                  ) : version.status ? (
                    <Badge>{version.status}</Badge>
                  ) : null}
                </span>
                <span className="block text-xs text-[var(--muted)]">
                  {version.changeNote || '無版本說明'} · {formatDate(version.createdAt)}
                </span>
              </span>
              {publishedVersionId !== version.id ? (
                <Button variant="secondary" size="sm" onClick={() => void onRollback(version)}>
                  <RotateCcw className="size-3.5" />
                  回滾
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact title="尚無版本記錄" />
      )}
    </Panel>
  );
}
