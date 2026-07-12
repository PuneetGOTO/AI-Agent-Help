'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, setAccessToken, setTenantContext } from '@/lib/api';
import type { AuthSession, Workspace } from '@/lib/types';
import { ErrorState, FullPageLoading } from './states';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  error: Error | null;
  login: (email: string, password: string) => Promise<void>;
  acceptSession: (session: AuthSession) => void;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  switchWorkspace: (workspace: Workspace) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applySession(value: AuthSession) {
  if (value.accessToken) setAccessToken(value.accessToken);
  const organizationId = value.activeOrganizationId ?? value.organizations?.[0]?.id;
  const workspaceId =
    value.activeWorkspaceId ??
    value.workspaces?.[0]?.id ??
    value.organizations?.[0]?.workspaces?.[0]?.id;
  const activeOrganization = value.organizations?.find(
    (organization) => organization.id === organizationId,
  );
  setTenantContext(organizationId, workspaceId);
  return {
    ...value,
    activeOrganizationId: organizationId,
    activeWorkspaceId: workspaceId,
    permissions: value.permissions ?? activeOrganization?.permissions ?? [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const restored = await apiRequest<RestoreSessionResponse>('/auth/session', {
        method: 'POST',
        skipAuthRefresh: true,
      });
      if (!restored.authenticated) {
        setAccessToken(null);
        setTenantContext(null, null);
        setSession(null);
        return;
      }
      setSession(applySession(restored));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error(String(requestError)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = useCallback(async (email: string, password: string) => {
    const next = await apiRequest<AuthSession>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRefresh: true,
    });
    setSession(applySession(next));
    setError(null);
  }, []);

  const acceptSession = useCallback((next: AuthSession) => {
    setSession(applySession(next));
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST', skipAuthRefresh: true });
    } finally {
      setAccessToken(null);
      setTenantContext(null, null);
      setSession(null);
    }
  }, []);

  const switchWorkspace = useCallback((workspace: Workspace) => {
    setTenantContext(workspace.organizationId, workspace.id);
    setSession((current) => {
      if (!current) return current;
      const organization = current.organizations?.find(
        (item) => item.id === workspace.organizationId,
      );
      return {
        ...current,
        activeOrganizationId: workspace.organizationId,
        activeWorkspaceId: workspace.id,
        permissions: organization?.permissions ?? [],
      };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      error,
      login,
      acceptSession,
      logout,
      reload,
      switchWorkspace,
      can: (permission) => {
        const roles =
          session?.organizations?.map((organization) => organization.role?.toLowerCase()) ?? [];
        return Boolean(
          session?.permissions?.includes(permission) ||
          session?.permissions?.includes('*') ||
          roles.some((role) => role === 'owner' || role === 'admin'),
        );
      },
    }),
    [session, loading, error, login, acceptSession, logout, reload, switchWorkspace],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

type RestoreSessionResponse = { authenticated: false } | (AuthSession & { authenticated: true });

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!auth.loading && !auth.session && !auth.error)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.loading, auth.session, auth.error, router, pathname]);
  if (auth.loading) return <FullPageLoading label="驗證登入狀態" />;
  if (auth.error)
    return (
      <ErrorState title="無法驗證登入狀態" error={auth.error} onRetry={() => void auth.reload()} />
    );
  if (!auth.session) return <FullPageLoading label="前往登入頁" />;
  return children;
}
