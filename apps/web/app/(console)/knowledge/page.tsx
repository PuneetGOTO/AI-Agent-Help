'use client';

import { Database, FileText, Plus, Trash2, Upload } from 'lucide-react';
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
  Textarea,
  useToast,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { KnowledgeBase, KnowledgeDocument } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatDate, toMessage } from '@/lib/utils';

export default function KnowledgePage() {
  const auth = useAuth();
  const query = useApiQuery<unknown>('/knowledge-bases');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const bases = asPaginated<KnowledgeBase>(query.data).items;
  const canManage = auth.can('knowledge:manage');
  return (
    <div className="animate-enter">
      <PageHeader
        title="知識庫"
        description="管理文字型 RAG 文件與處理狀態。"
        actions={
          <Button disabled={!canManage} onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            建立知識庫
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(460px,1.2fr)]">
        <Panel>
          {query.loading ? (
            <SkeletonRows rows={6} />
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : bases.length ? (
            <div className="divide-y">
              {bases.map((base) => (
                <button
                  key={base.id}
                  type="button"
                  onClick={() => setSelectedId(base.id)}
                  className={`flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-[#fafbfa] ${selectedId === base.id ? 'bg-[#edf6f1]' : ''}`}
                >
                  <span className="grid size-9 place-items-center rounded-md bg-[#e8efea] text-[#315a43]">
                    <Database className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{base.name}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {base.description || '未填寫描述'}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {base.documentCount ?? base._count?.documents ?? 0} 文件
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="尚未建立知識庫"
              description="建立知識庫並上傳文件，供 Agent 進行檢索。"
              icon={<Database className="size-5" />}
              action={
                canManage ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" />
                    建立知識庫
                  </Button>
                ) : undefined
              }
            />
          )}
        </Panel>
        {selectedId ? (
          <KnowledgeDetail
            id={selectedId}
            canManage={canManage}
            onDeleted={async () => {
              setSelectedId(undefined);
              await query.refetch();
            }}
          />
        ) : (
          <Panel>
            <EmptyState
              title="選擇知識庫"
              description="檢視文件、索引狀態與嵌入設定。"
              icon={<FileText className="size-5" />}
            />
          </Panel>
        )}
      </div>
      <CreateKnowledgeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (base) => {
          setCreateOpen(false);
          setSelectedId(base.id);
          await query.refetch();
        }}
      />
    </div>
  );
}

function KnowledgeDetail({
  id,
  canManage,
  onDeleted,
}: {
  id: string;
  canManage: boolean;
  onDeleted: () => Promise<void>;
}) {
  const query = useApiQuery<KnowledgeBase>(`/knowledge-bases/${id}`);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiRequest(`/knowledge-bases/${id}/documents`, { method: 'POST', rawBody: form });
      toast.push('文件已上傳');
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setUploading(false);
    }
  };
  const removeDocument = async (document: KnowledgeDocument) => {
    try {
      await apiRequest(`/knowledge-bases/${id}/documents/${document.id}`, { method: 'DELETE' });
      toast.push('文件已移除');
      await query.refetch();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    }
  };
  const removeBase = async () => {
    setRemoving(true);
    try {
      await apiRequest(`/knowledge-bases/${id}`, { method: 'DELETE' });
      toast.push('知識庫已刪除');
      await onDeleted();
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setRemoving(false);
    }
  };
  if (query.loading)
    return (
      <Panel>
        <SkeletonRows rows={6} />
      </Panel>
    );
  if (query.error)
    return (
      <Panel>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Panel>
    );
  const base = query.data;
  if (!base) return null;
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{base.name}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">文字檢索</p>
        </div>
        {canManage ? (
          <>
            <label
              className={`inline-flex h-8 items-center gap-2 rounded-md border bg-white px-3 text-xs font-medium hover:bg-[#f3f5f3] ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              <Upload className="size-3.5" />
              {uploading ? '上傳中' : '上傳文件'}
              <input
                type="file"
                className="sr-only"
                accept=".txt,.md,.pdf,.json,.csv,text/plain,text/markdown,application/pdf,application/json,text/csv"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = '';
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              loading={removing}
              onClick={() => void removeBase()}
              aria-label="刪除知識庫"
            >
              {!removing ? <Trash2 className="size-4 text-[var(--danger)]" /> : null}
            </Button>
          </>
        ) : null}
      </div>
      {base.documents?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2.5">文件</th>
                <th className="px-4 py-2.5">狀態</th>
                <th className="px-4 py-2.5">Chunks</th>
                <th className="px-4 py-2.5">大小</th>
                <th className="px-4 py-2.5">上傳時間</th>
                <th className="w-14 px-4 py-2.5">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {base.documents.map((document) => (
                <tr key={document.id}>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="size-4 text-[var(--muted)]" />
                      {document.name ?? document.fileName ?? '文件'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{document.status ?? 'READY'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums text-[var(--muted)]">
                    {document.chunkCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {formatBytes(document.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {formatDate(document.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void removeDocument(document)}
                        aria-label="移除文件"
                      >
                        <Trash2 className="size-4 text-[var(--danger)]" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          compact
          title="尚未上傳文件"
          description="支援 TXT、Markdown、PDF、JSON 與 CSV，單檔上限 20 MB。"
        />
      )}
    </Panel>
  );
}

function CreateKnowledgeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (base: KnowledgeBase) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      if (name.trim().length < 2) throw new Error('名稱至少需要 2 個字元');
      const base = await apiRequest<KnowledgeBase>('/knowledge-bases', {
        method: 'POST',
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
        },
      });
      setName('');
      setDescription('');
      await onCreated(base);
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
      title="建立知識庫"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            建立
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="名稱" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="描述">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
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

function formatBytes(value?: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
