'use client';

import { Boxes, CircleDollarSign, RefreshCw, ServerCog } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';
import {
  Badge,
  Button,
  Dialog,
  Field,
  PageHeader,
  Panel,
  Textarea,
  useToast,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { ModelInfo, ProviderConnection } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatNumber, toMessage } from '@/lib/utils';

export default function ModelsPage() {
  const providersQuery = useApiQuery<unknown>('/providers');
  const providers = asPaginated<ProviderConnection>(providersQuery.data).items.filter(
    (provider) => provider.isEnabled !== false,
  );
  return (
    <div className="animate-enter">
      <PageHeader title="模型" description="從已配置 Provider 即時讀取可用模型與能力。" />
      {providersQuery.loading ? (
        <Panel>
          <SkeletonRows rows={7} />
        </Panel>
      ) : providersQuery.error ? (
        <Panel>
          <ErrorState error={providersQuery.error} onRetry={() => void providersQuery.refetch()} />
        </Panel>
      ) : providers.length ? (
        <div className="space-y-5">
          {providers.map((provider) => (
            <ProviderModels
              key={provider.id}
              provider={provider}
              onProviderUpdated={async () => {
                await providersQuery.refetch();
              }}
            />
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            title="尚無 Provider 連接"
            description="先配置 Provider，再同步模型清單。"
            icon={<ServerCog className="size-5" />}
          />
        </Panel>
      )}
    </div>
  );
}

function ProviderModels({
  provider,
  onProviderUpdated,
}: {
  provider: ProviderConnection;
  onProviderUpdated: () => Promise<void>;
}) {
  const auth = useAuth();
  const toast = useToast();
  const query = useApiQuery<unknown>(`/providers/${provider.id}/models`);
  const models = asPaginated<ModelInfo | string>(query.data).items;
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricing, setPricing] = useState('');
  const [pricingError, setPricingError] = useState<string>();
  const [savingPricing, setSavingPricing] = useState(false);
  const openPricing = () => {
    setPricing(JSON.stringify(asRecord(provider.config?.pricing), null, 2));
    setPricingError(undefined);
    setPricingOpen(true);
  };
  const savePricing = async () => {
    let value: unknown;
    try {
      value = JSON.parse(pricing || '{}');
      validatePricing(value);
    } catch (error) {
      setPricingError(toMessage(error));
      return;
    }
    setSavingPricing(true);
    setPricingError(undefined);
    try {
      await apiRequest(`/providers/${provider.id}`, {
        method: 'PATCH',
        body: { config: { ...(provider.config ?? {}), pricing: value } },
      });
      toast.push(`已更新「${provider.name}」定價`);
      setPricingOpen(false);
      await onProviderUpdated();
    } catch (error) {
      setPricingError(toMessage(error));
    } finally {
      setSavingPricing(false);
    }
  };
  return (
    <>
      <Panel>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <span className="grid size-8 place-items-center rounded-md bg-[#edf0ed]">
            <ServerCog className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{provider.name}</h2>
            <p className="text-[11px] text-[var(--muted)]">{provider.type}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={openPricing}
            disabled={!auth.can('provider:manage')}
          >
            <CircleDollarSign className="size-3.5" />
            定價
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void query.refetch()}
            aria-label={`重新同步 ${provider.name}`}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {query.loading ? (
          <SkeletonRows rows={3} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : models.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left">
              <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5">模型</th>
                  <th className="px-4 py-2.5">Context</th>
                  <th className="px-4 py-2.5">能力</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {models.map((model) => {
                  const item = typeof model === 'string' ? { id: model, name: model } : model;
                  const capabilities = capabilityNames(item.capabilities);
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Boxes className="size-4 text-[var(--muted)]" />
                          {item.name ?? item.id}
                        </span>
                        <span className="ml-6 block font-mono text-[10px] text-[var(--muted)]">
                          {item.id}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {item.contextWindow ? formatNumber(item.contextWindow) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {capabilities.length ? (
                            capabilities.map((capability) => (
                              <Badge key={capability} tone="neutral">
                                {capability}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--muted)]">Provider 未回傳</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState compact title="Provider 沒有回傳模型" />
        )}
      </Panel>
      <Dialog
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        title={`${provider.name} 定價`}
        description="以每百萬 Token 的美元價格記錄模型成本。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPricingOpen(false)}>
              取消
            </Button>
            <Button loading={savingPricing} onClick={() => void savePricing()}>
              儲存定價
            </Button>
          </>
        }
      >
        <Field
          label="Pricing JSON"
          required
          hint='格式：{"model-id":{"inputPerMillion":1,"outputPerMillion":2}}'
          error={pricingError}
        >
          <Textarea
            className="min-h-56 font-mono text-xs"
            value={pricing}
            onChange={(event) => setPricing(event.target.value)}
            spellCheck={false}
          />
        </Field>
      </Dialog>
    </>
  );
}

function capabilityNames(value?: string[] | Record<string, boolean>): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return Object.entries(value ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validatePricing(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pricing 必須是 JSON object');
  }
  for (const [model, rawPricing] of Object.entries(value)) {
    const pricing = asRecord(rawPricing);
    for (const field of ['inputPerMillion', 'outputPerMillion']) {
      const price = pricing[field];
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
        throw new Error(`${model}.${field} 必須是非負數字`);
      }
    }
  }
}
