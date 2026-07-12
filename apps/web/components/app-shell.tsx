'use client';

import {
  Activity,
  Bot,
  Boxes,
  ChevronsUpDown,
  CircleDollarSign,
  Database,
  FileClock,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  MessageSquareText,
  Plus,
  ServerCog,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { asPaginated, cn, initials } from '@/lib/utils';
import type { Workspace } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { AuthGuard, useAuth } from './auth-provider';
import { CreateWorkspaceDialog } from './create-workspace-dialog';
import { ErrorState, FullPageLoading } from './states';
import { Button } from './ui';

const navigation = [
  { label: 'Dashboard', href: '/dashboard', icon: Gauge },
  { label: 'Agents', href: '/agents', icon: Bot },
  { label: 'Playground', href: '/agents', icon: Sparkles },
  { label: '對話記錄', href: '/conversations', icon: MessageSquareText },
  { label: 'Provider 連接', href: '/providers', icon: ServerCog },
  { label: '模型', href: '/models', icon: Boxes },
  { label: '工具', href: '/tools', icon: Wrench },
  { label: '知識庫', href: '/knowledge', icon: Database },
  { label: '用量與成本', href: '/usage', icon: CircleDollarSign },
  { label: '成員與角色', href: '/members', icon: Users },
  { label: 'API Keys', href: '/api-keys', icon: KeyRound },
  { label: '審計日誌', href: '/audit', icon: FileClock },
  { label: '系統設定', href: '/settings', icon: Settings },
] as const;

const pageNames: Record<string, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  conversations: '對話記錄',
  providers: 'Provider 連接',
  models: '模型',
  tools: '工具',
  knowledge: '知識庫',
  usage: '用量與成本',
  members: '成員與角色',
  'api-keys': 'API Keys',
  audit: '審計日誌',
  settings: '系統設定',
  playground: 'Playground',
  new: '建立 Agent',
};

function Sidebar({ mobile, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        'flex h-full w-[232px] shrink-0 flex-col bg-[var(--sidebar)] text-white',
        !mobile && 'fixed inset-y-0 left-0 z-30 hidden lg:flex',
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <span className="grid size-8 place-items-center rounded-md bg-[#e8f5ee] text-[#12643f]">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">AgentOps</p>
          <p className="text-[11px] text-[var(--sidebar-muted)]">Enterprise Console</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="主要導覽">
        {navigation.map((item, index) => {
          const active =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
          return (
            <div key={`${item.href}-${index}`}>
              {index === 4 || index === 8 ? (
                <div className="mx-2 my-2 border-t border-white/10" />
              ) : null}
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'mb-0.5 flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-[#c8d0ca] transition-colors hover:bg-white/7 hover:text-white',
                  active && 'bg-white/10 font-medium text-white',
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3 text-[11px] text-[var(--sidebar-muted)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3.5" />
          <span>租戶隔離已啟用</span>
        </div>
      </div>
    </aside>
  );
}

function WorkspaceSelector() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const workspacesQuery = useApiQuery<unknown>(auth.session ? '/workspaces?pageSize=100' : null);
  const workspaces = useMemo(() => {
    const queried = asPaginated<Workspace>(workspacesQuery.data).items;
    const embedded =
      auth.session?.workspaces ??
      auth.session?.organizations?.flatMap((organization) => organization.workspaces ?? []) ??
      [];
    const unique = new Map<string, Workspace>();
    [...queried, ...embedded].forEach((workspace) => unique.set(workspace.id, workspace));
    return [...unique.values()];
  }, [workspacesQuery.data, auth.session]);
  const active = workspaces.find((workspace) => workspace.id === auth.session?.activeWorkspaceId);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 max-w-[240px] items-center gap-2 rounded-md border bg-white px-2.5 text-left hover:bg-[#fafbfa]"
        aria-expanded={open}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded bg-[#e9eeea] text-[11px] font-semibold text-[#3d4941]">
          {initials(active?.name ?? 'W')}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {active?.name ?? (workspacesQuery.loading ? '載入工作區' : '選擇工作區')}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-[var(--muted)]" />
      </button>
      {open ? (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="關閉工作區選單"
          />
          <div className="absolute left-0 top-11 z-40 w-64 rounded-md border bg-white p-1 shadow-xl animate-enter">
            <p className="px-2 py-1.5 text-[11px] font-semibold uppercase text-[var(--muted)]">
              工作區
            </p>
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => {
                  auth.switchWorkspace(workspace);
                  setOpen(false);
                  router.replace(pathname);
                  router.refresh();
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f4f1]',
                  workspace.id === active?.id && 'bg-[#edf6f1] text-[#12643f]',
                )}
              >
                <span className="grid size-6 place-items-center rounded bg-[#e9eeea] text-[10px] font-semibold">
                  {initials(workspace.name)}
                </span>
                <span className="truncate">{workspace.name}</span>
              </button>
            ))}
            {workspacesQuery.error ? (
              <p className="px-2 py-2 text-xs text-[var(--danger)]">
                {workspacesQuery.error.message}
              </p>
            ) : null}
            <div className="my-1 border-t" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[#f1f4f1]"
            >
              <Plus className="size-4" />
              建立工作區
            </button>
          </div>
        </>
      ) : null}
      <CreateWorkspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function AccountMenu() {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const user = auth.session?.user;
  return (
    <div className="relative">
      <button
        type="button"
        className="grid size-9 place-items-center rounded-md bg-[#e5e9e6] text-xs font-semibold text-[#3d4740]"
        onClick={() => setOpen((value) => !value)}
        aria-label="帳戶選單"
      >
        {initials(user?.name)}
      </button>
      {open ? (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="關閉帳戶選單"
          />
          <div className="absolute right-0 top-11 z-40 w-64 rounded-md border bg-white p-2 shadow-xl animate-enter">
            <div className="border-b px-2 pb-2">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              className="mt-1 w-full justify-start"
              loading={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                await auth.logout();
                router.replace('/login');
              }}
            >
              <LogOut className="size-4" />
              登出
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const segment = pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard';
  const title = pageNames[segment] ?? (pathname.includes('/agents/') ? 'Agent 編輯器' : '工作台');
  return (
    <div className="min-h-screen">
      <Sidebar />
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-label="關閉導覽"
          />
          <div className="relative">
            <Sidebar mobile onNavigate={() => setMobileOpen(false)} />
          </div>
          <Button
            variant="secondary"
            size="icon"
            className="absolute left-[244px] top-3"
            onClick={() => setMobileOpen(false)}
            aria-label="關閉導覽"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
      <div className="lg:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-white/95 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="開啟導覽"
          >
            <Menu className="size-5" />
          </Button>
          <WorkspaceSelector />
          <div className="hidden h-5 border-l sm:block" />
          <p className="hidden truncate text-sm font-medium sm:block">{title}</p>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/usage"
              className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[#f1f3f1] sm:flex"
            >
              <Activity className="size-3.5" />
              用量
            </Link>
            <AccountMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <FullPageLoading label="驗證登入狀態" />;
  if (auth.error)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <ErrorState
          title="無法連接管理平台"
          error={auth.error}
          onRetry={() => void auth.reload()}
        />
      </main>
    );
  return (
    <AuthGuard>
      <ShellContent>{children}</ShellContent>
    </AuthGuard>
  );
}
