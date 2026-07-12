'use client';

import { useParams } from 'next/navigation';
import { AgentEditor } from '@/components/agent-editor';
import { ErrorState, FullPageLoading } from '@/components/states';
import type { Agent } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';

export default function EditAgentPage() {
  const params = useParams<{ id: string }>();
  const query = useApiQuery<Agent>(params.id ? `/agents/${params.id}` : null);
  if (query.loading) return <FullPageLoading label="載入 Agent 配置" />;
  if (query.error)
    return (
      <ErrorState title="無法載入 Agent" error={query.error} onRetry={() => void query.refetch()} />
    );
  if (!query.data) return null;
  return <AgentEditor key={`${query.data.id}-${query.data.updatedAt}`} agent={query.data} />;
}
