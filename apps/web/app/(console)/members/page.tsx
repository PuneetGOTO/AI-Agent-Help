'use client';

import { Check, Clipboard, MailPlus, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import type { Invitation, Member, Role } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { asPaginated, formatDate, initials, toMessage } from '@/lib/utils';

const permissionOptions = [
  'workspace:read',
  'workspace:update',
  'member:read',
  'member:manage',
  'provider:read',
  'provider:manage',
  'agent:read',
  'agent:write',
  'agent:publish',
  'agent:run',
  'tool:read',
  'tool:manage',
  'knowledge:read',
  'knowledge:manage',
  'usage:read',
  'audit:read',
  'api-key:manage',
];

export default function MembersPage() {
  const auth = useAuth();
  const membersQuery = useApiQuery<unknown>('/members?pageSize=100');
  const rolesQuery = useApiQuery<unknown>('/roles?pageSize=100');
  const invitationsQuery = useApiQuery<unknown>('/invitations?pageSize=100');
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [busyMember, setBusyMember] = useState<string>();
  const members = asPaginated<Member>(membersQuery.data).items;
  const roles = asPaginated<Role>(rolesQuery.data).items;
  const invitations = asPaginated<Invitation>(invitationsQuery.data).items;
  const canManage = auth.can('member:manage');

  const updateRole = async (member: Member, roleId: string) => {
    const id = member.membershipId ?? member.id;
    if (!id) return;
    setBusyMember(id);
    try {
      await apiRequest(`/members/${id}`, { method: 'PATCH', body: { roleId } });
      toast.push('成員角色已更新');
      await Promise.all([membersQuery.refetch(), rolesQuery.refetch()]);
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setBusyMember(undefined);
    }
  };

  const removeMember = async (member: Member) => {
    const id = member.membershipId ?? member.id;
    if (!id || !window.confirm(`移除 ${member.user?.name ?? member.name ?? '此成員'}？`)) return;
    setBusyMember(id);
    try {
      await apiRequest(`/members/${id}`, { method: 'DELETE' });
      toast.push('成員已移除');
      await Promise.all([membersQuery.refetch(), rolesQuery.refetch()]);
    } catch (error) {
      toast.push(toMessage(error), 'danger');
    } finally {
      setBusyMember(undefined);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        title="成員與角色"
        description="管理組織成員、邀請、預設角色與自訂權限。"
        actions={
          <>
            <Button variant="secondary" disabled={!canManage} onClick={() => setRoleOpen(true)}>
              <ShieldCheck className="size-4" />
              建立角色
            </Button>
            <Button disabled={!canManage || !roles.length} onClick={() => setInviteOpen(true)}>
              <MailPlus className="size-4" />
              邀請成員
            </Button>
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.7fr)]">
        <Panel>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">組織成員</h2>
          </div>
          {membersQuery.loading ? (
            <SkeletonRows rows={6} />
          ) : membersQuery.error ? (
            <ErrorState
              error={membersQuery.error}
              onRetry={() => void membersQuery.refetch()}
              compact
            />
          ) : members.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead className="border-b bg-[#fafbfa] text-[11px] uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2.5">成員</th>
                    <th className="px-4 py-2.5">角色</th>
                    <th className="px-4 py-2.5">狀態</th>
                    <th className="px-4 py-2.5">加入時間</th>
                    <th className="w-14 px-4 py-2.5">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map((member) => {
                    const role =
                      typeof member.role === 'object'
                        ? member.role
                        : roles.find((item) => item.name === member.role);
                    const id = member.membershipId ?? member.id ?? '';
                    return (
                      <tr key={id} className="hover:bg-[#fafbfa]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 place-items-center rounded-md bg-[#e8eee9] text-xs font-semibold">
                              {initials(member.user?.name ?? member.name)}
                            </span>
                            <span>
                              <span className="block text-sm font-medium">
                                {member.user?.name ?? member.name}
                              </span>
                              <span className="block text-xs text-[var(--muted)]">
                                {member.user?.email ?? member.email}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            className="w-40"
                            disabled={!canManage || busyMember === id}
                            value={role?.id ?? ''}
                            onChange={(event) => void updateRole(member, event.target.value)}
                          >
                            {roles.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Badge>{member.status ?? 'ACTIVE'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--muted)]">
                          {formatDate(member.joinedAt ?? member.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canManage || busyMember === id}
                            onClick={() => void removeMember(member)}
                            aria-label="移除成員"
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
            <EmptyState compact title="尚無成員" icon={<UserRound className="size-5" />} />
          )}
        </Panel>
        <div className="space-y-5">
          <Panel>
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">角色</h2>
            </div>
            {rolesQuery.loading ? (
              <SkeletonRows rows={5} />
            ) : rolesQuery.error ? (
              <ErrorState error={rolesQuery.error} compact />
            ) : (
              <div className="divide-y">
                {roles.map((role) => (
                  <div key={role.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{role.name}</span>
                      <Badge tone={role.system ? 'neutral' : 'success'}>
                        {role.system ? 'Built-in' : 'Custom'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {role.permissions?.length ?? 0} 個權限 · {role.memberCount ?? 0} 位成員
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel>
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">待處理邀請</h2>
            </div>
            {invitationsQuery.loading ? (
              <SkeletonRows rows={3} />
            ) : invitationsQuery.error ? (
              <ErrorState error={invitationsQuery.error} compact />
            ) : invitations.filter((item) => item.status === 'PENDING').length ? (
              <div className="divide-y">
                {invitations
                  .filter((item) => item.status === 'PENDING')
                  .map((invitation) => (
                    <div key={invitation.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {invitation.email}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          {typeof invitation.role === 'object'
                            ? invitation.role.name
                            : invitation.role}{' '}
                          · 到期 {formatDate(invitation.expiresAt)}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canManage}
                        onClick={async () => {
                          try {
                            await apiRequest(`/invitations/${invitation.id}`, { method: 'DELETE' });
                            await invitationsQuery.refetch();
                          } catch (error) {
                            toast.push(toMessage(error), 'danger');
                          }
                        }}
                        aria-label="撤銷邀請"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState compact title="沒有待處理邀請" />
            )}
          </Panel>
        </div>
      </div>
      <InviteDialog
        open={inviteOpen}
        roles={roles}
        onClose={() => setInviteOpen(false)}
        onCreated={async () => {
          await invitationsQuery.refetch();
        }}
      />
      <RoleDialog
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        onCreated={async () => {
          setRoleOpen(false);
          await rolesQuery.refetch();
        }}
      />
    </div>
  );
}

function InviteDialog({
  open,
  roles,
  onClose,
  onCreated,
}: {
  open: boolean;
  roles: Role[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selectedRoleId = roleId || roles[0]?.id || '';
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const invitation = await apiRequest<Invitation>('/invitations', {
        method: 'POST',
        body: { email: email.trim(), roleId: selectedRoleId },
      });
      const url = `${window.location.origin}/accept-invite?token=${encodeURIComponent(invitation.token ?? '')}`;
      setInviteUrl(url);
      await onCreated();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setEmail('');
    setRoleId('');
    setInviteUrl('');
    setError(undefined);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="邀請成員"
      description="邀請連結只會顯示一次，伺服器只保存 token hash。"
      footer={
        inviteUrl ? (
          <Button onClick={close}>
            <Check className="size-4" />
            完成
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              loading={busy}
              disabled={!email.trim() || !selectedRoleId}
              onClick={() => void submit()}
            >
              建立邀請
            </Button>
          </>
        )
      }
    >
      {inviteUrl ? (
        <div>
          <Field label="邀請連結">
            <div className="flex gap-2">
              <Input readOnly value={inviteUrl} />
              <Button
                variant="secondary"
                size="icon"
                onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                aria-label="複製邀請連結"
              >
                <Clipboard className="size-4" />
              </Button>
            </div>
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="電郵地址" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="角色" required>
            <Select value={selectedRoleId} onChange={(event) => setRoleId(event.target.value)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
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

function RoleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<string[]>(['workspace:read', 'agent:read']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const grouped = useMemo(() => permissionOptions, []);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest('/roles', { method: 'POST', body: { name: name.trim(), permissions } });
      setName('');
      setPermissions(['workspace:read', 'agent:read']);
      await onCreated();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="建立自訂角色"
      description="權限採最小授權，之後可透過 API 更新。"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={busy}
            disabled={name.trim().length < 2 || !permissions.length}
            onClick={() => void submit()}
          >
            <Plus className="size-4" />
            建立角色
          </Button>
        </>
      }
    >
      <Field label="角色名稱" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {grouped.map((permission) => (
          <label
            key={permission}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
          >
            <input
              type="checkbox"
              checked={permissions.includes(permission)}
              onChange={() =>
                setPermissions((current) =>
                  current.includes(permission)
                    ? current.filter((item) => item !== permission)
                    : [...current, permission],
                )
              }
              className="accent-[#18794e]"
            />
            <span className="font-mono">{permission}</span>
          </label>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}
    </Dialog>
  );
}
