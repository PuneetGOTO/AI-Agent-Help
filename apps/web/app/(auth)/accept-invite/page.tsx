'use client';

import { CheckCircle2, KeyRound, UserPlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { FullPageLoading } from '@/components/states';
import { Button, Field, Input, Panel } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { toMessage } from '@/lib/utils';

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<FullPageLoading label="載入邀請" />}>
      <AcceptInvite />
    </Suspense>
  );
}

function AcceptInvite() {
  const auth = useAuth();
  const search = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState(search.get('token') ?? '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [accepted, setAccepted] = useState(false);
  if (auth.loading) return <FullPageLoading label="驗證帳戶" />;
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (auth.session) {
        await apiRequest('/invitations/accept', { method: 'POST', body: { token } });
        await auth.reload();
        setAccepted(true);
      } else {
        await apiRequest('/invitations/register', {
          method: 'POST',
          body: { token, name: name.trim(), password },
          skipAuthRefresh: true,
        });
        setAccepted(true);
      }
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f5] p-5">
      <Panel className="w-full max-w-lg p-6 sm:p-8">
        {accepted ? (
          <div className="text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-lg bg-[#e8f5ee] text-[#12643f]">
              <CheckCircle2 className="size-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold">邀請已接受</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {auth.session ? '新組織已加入你的帳戶。' : '帳戶已建立，現在可以登入工作台。'}
            </p>
            <Button
              className="mt-6"
              onClick={() => router.replace(auth.session ? '/dashboard' : '/login')}
            >
              前往工作台
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <span className="mb-4 grid size-10 place-items-center rounded-md bg-[#e8f5ee] text-[#12643f]">
                <UserPlus className="size-5" />
              </span>
              <h1 className="text-xl font-semibold">接受組織邀請</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {auth.session
                  ? `將邀請加入 ${auth.session.user.email}`
                  : '建立帳戶並加入受邀組織。'}
              </p>
            </div>
            <div className="space-y-4">
              <Field label="邀請 Token" required>
                <Input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  className="font-mono text-xs"
                />
              </Field>
              {!auth.session ? (
                <>
                  <Field label="姓名" required>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                    />
                  </Field>
                  <Field label="密碼" required hint="至少 12 字元，包含大小寫、數字與符號">
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              ) : null}
              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-[#efc1bc] bg-[#fff7f6] px-3 py-2 text-sm text-[#98281f]"
                >
                  {error}
                </p>
              ) : null}
              <Button
                className="w-full"
                loading={busy}
                disabled={
                  token.length < 32 ||
                  (!auth.session &&
                    (name.trim().length < 2 ||
                      password.length < 12 ||
                      new TextEncoder().encode(password).length > 72))
                }
                onClick={() => void submit()}
              >
                <KeyRound className="size-4" />
                接受邀請
              </Button>
            </div>
          </>
        )}
      </Panel>
    </main>
  );
}
