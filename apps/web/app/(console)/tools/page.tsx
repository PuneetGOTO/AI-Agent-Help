'use client';

import { Database, Globe2, Plus, RadioTower, TerminalSquare, Trash2, Wrench } from 'lucide-react';
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
  Switch,
  Textarea,
  useToast,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { Tool } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatDate, toMessage } from '@/lib/utils';

const toolTypes = {
  HTTP_REQUEST: { label: 'HTTP Request', icon: Globe2 },
  WEBHOOK: { label: 'Webhook', icon: RadioTower },
  DATABASE_QUERY: { label: 'Database Query（需註冊 handler）', icon: Database },
  CUSTOM_FUNCTION: { label: 'Custom Function（需註冊 handler）', icon: TerminalSquare },
} as const;

type ToolType = keyof typeof toolTypes;

export default function ToolsPage() {
  const auth = useAuth();
  const query = useApiQuery<unknown>('/tools');
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [removing, setRemoving] = useState<Tool>();
  const [removeBusy, setRemoveBusy] = useState(false);
  const tools = asPaginated<Tool>(query.data).items;
  const canManage = auth.can('tool:manage');
  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await apiRequest(`/tools/${removing.id}`, { method: 'DELETE' });
      toast.push('工具已刪除');
      setRemoving(undefined);
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setRemoveBusy(false);
    }
  };
  return (
    <div className="animate-enter">
      <PageHeader
        title="工具"
        description="管理 Agent 可調用的外部操作、參數 Schema、審批與逾時策略。"
        actions={
          <Button disabled={!canManage} onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            建立工具
          </Button>
        }
      />
      <Panel>
        {query.loading ? (
          <SkeletonRows rows={7} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : tools.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5">工具</th>
                  <th className="px-4 py-2.5">類型</th>
                  <th className="px-4 py-2.5">保護</th>
                  <th className="px-4 py-2.5">逾時 / 重試</th>
                  <th className="px-4 py-2.5">更新</th>
                  <th className="w-14 px-4 py-2.5">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tools.map((tool) => {
                  const definition = toolTypes[tool.type as ToolType];
                  const Icon = definition?.icon ?? Wrench;
                  return (
                    <tr key={tool.id} className="hover:bg-[#fafbfa]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-md bg-[#edf0ed]">
                            <Icon className="size-4 text-[#4d5951]" />
                          </span>
                          <span>
                            <span className="block text-sm font-medium">{tool.name}</span>
                            <span className="block max-w-xs truncate text-xs text-[var(--muted)]">
                              {tool.description}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral">{definition?.label ?? tool.type}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {tool.requiresApproval ? (
                          <Badge tone="warning">人工審批</Badge>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">自動執行</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {tool.timeoutMs ?? 30000} ms · {tool.retryCount ?? 0} 次
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {formatDate(tool.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!canManage}
                          onClick={() => setRemoving(tool)}
                          aria-label={`刪除 ${tool.name}`}
                        >
                          <Trash2 className="size-4 text-[var(--danger)]" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="尚未建立工具"
            description="建立可執行的 HTTP 或 Webhook 工具，並將它配置給 Agent。"
            icon={<Wrench className="size-5" />}
            action={
              canManage ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  建立工具
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
      <CreateToolDialog
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
        title="刪除工具"
        description="被任何 Agent 版本引用的工具無法刪除。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(undefined)}>
              取消
            </Button>
            <Button variant="danger" loading={removeBusy} onClick={() => void remove()}>
              <Trash2 className="size-4" />
              確認刪除
            </Button>
          </>
        }
      >
        <p className="text-sm">確定刪除「{removing?.name}」？</p>
      </Dialog>
    </div>
  );
}

const defaultSchema = JSON.stringify(
  { type: 'object', properties: {}, additionalProperties: false },
  null,
  2,
);
const configs: Record<ToolType, string> = {
  HTTP_REQUEST: JSON.stringify({ url: 'https://api.example.com/resource', method: 'GET' }, null, 2),
  WEBHOOK: JSON.stringify({ url: 'https://hooks.example.com/agent', method: 'POST' }, null, 2),
  DATABASE_QUERY: JSON.stringify({ handlerId: 'registered_readonly_query' }, null, 2),
  CUSTOM_FUNCTION: JSON.stringify({ handlerId: 'registered_function' }, null, 2),
};

function CreateToolDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ToolType>('HTTP_REQUEST');
  const [inputSchema, setInputSchema] = useState(defaultSchema);
  const [config, setConfig] = useState(configs.HTTP_REQUEST);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [retryCount, setRetryCount] = useState(1);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const changeType = (value: ToolType) => {
    setType(value);
    setConfig(configs[value]);
    if (value === 'DATABASE_QUERY' || value === 'CUSTOM_FUNCTION') setRequiresApproval(true);
  };
  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      if (name.trim().length < 2 || description.trim().length < 2)
        throw new Error('名稱與描述至少需要 2 個字元');
      const schemaValue = JSON.parse(inputSchema) as unknown;
      const configValue = JSON.parse(config) as unknown;
      if (
        !schemaValue ||
        typeof schemaValue !== 'object' ||
        Array.isArray(schemaValue) ||
        !configValue ||
        typeof configValue !== 'object' ||
        Array.isArray(configValue)
      )
        throw new Error('Schema 與執行配置必須是 JSON 物件');
      await apiRequest('/tools', {
        method: 'POST',
        body: {
          name: name.trim(),
          description: description.trim(),
          type,
          inputSchema: schemaValue,
          config: configValue,
          requiresApproval,
          timeoutMs,
          retryCount,
        },
      });
      toast.push('工具已建立');
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
      title="建立工具"
      description="後端會再次驗證參數 Schema、執行配置與目標網域。"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            建立工具
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名稱" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="類型" required>
          <Select value={type} onChange={(event) => changeType(event.target.value as ToolType)}>
            {Object.entries(toolTypes).map(([value, item]) => (
              <option
                key={value}
                value={value}
                disabled={value === 'DATABASE_QUERY' || value === 'CUSTOM_FUNCTION'}
              >
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field className="sm:col-span-2" label="描述" required>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="逾時（毫秒）">
          <Input
            type="number"
            min="1000"
            max="120000"
            step="1000"
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(Number(event.target.value))}
          />
        </Field>
        <Field label="重試次數">
          <Input
            type="number"
            min="0"
            max="3"
            value={retryCount}
            onChange={(event) => setRetryCount(Number(event.target.value))}
          />
        </Field>
        <div className="sm:col-span-2 flex items-center justify-between rounded-md border p-3">
          <span>
            <span className="block text-xs font-medium">需要人工審批</span>
            <span className="block text-[11px] text-[var(--muted)]">執行前建立等待確認節點</span>
          </span>
          <Switch
            label="需要人工審批"
            checked={requiresApproval}
            onCheckedChange={setRequiresApproval}
          />
        </div>
        <Field label="Input JSON Schema">
          <Textarea
            className="min-h-56 font-mono text-xs"
            value={inputSchema}
            onChange={(event) => setInputSchema(event.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label="執行配置">
          <Textarea
            className="min-h-56 font-mono text-xs"
            value={config}
            onChange={(event) => setConfig(event.target.value)}
            spellCheck={false}
          />
        </Field>
      </div>
      {error ? (
        <p className="mt-4 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-3 py-2 text-sm text-[#98281f]">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
