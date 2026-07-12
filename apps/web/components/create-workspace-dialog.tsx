'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { toMessage } from '@/lib/utils';
import { useAuth } from './auth-provider';
import { Button, Dialog, Field, Input, useToast } from './ui';

export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      setError('工作區名稱至少需要 2 個字元');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const workspace = await apiRequest<Workspace>('/workspaces', {
        method: 'POST',
        body: { name: cleanName, organizationId: auth.session?.activeOrganizationId },
      });
      auth.switchWorkspace(workspace);
      toast.push(`已建立工作區「${workspace.name}」`);
      setName('');
      onClose();
      window.location.reload();
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
      title="建立工作區"
      description="工作區會隔離 Agent、Provider、工具、用量與成員設定。"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="button" loading={submitting} onClick={() => void submit()}>
            建立
          </Button>
        </>
      }
    >
      <Field label="工作區名稱" required error={error}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          autoFocus
          placeholder="例如：客戶服務自動化"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
      </Field>
    </Dialog>
  );
}
