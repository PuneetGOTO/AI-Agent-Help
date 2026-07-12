'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, Building2, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth-provider';
import { Button, Field, Input } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import type { AuthSession } from '@/lib/types';
import { toMessage } from '@/lib/utils';

const loginSchema = z.object({
  email: z.string().email('請輸入有效的電郵地址'),
  password: z.string().min(1, '請輸入密碼'),
});

const bootstrapSchema = z.object({
  name: z.string().min(2, '名稱至少需要 2 個字元').max(80),
  email: z.string().email('請輸入有效的電郵地址'),
  password: z
    .string()
    .min(12, '密碼至少需要 12 個字元')
    .regex(/[A-Z]/, '需要至少一個大寫英文字母')
    .regex(/[a-z]/, '需要至少一個小寫英文字母')
    .regex(/[0-9]/, '需要至少一個數字')
    .refine((value) => new TextEncoder().encode(value).length <= 72, '密碼不可超過 72 UTF-8 bytes'),
  organizationName: z.string().min(2, '組織名稱至少需要 2 個字元').max(100),
  workspaceName: z.string().min(2, '工作區名稱至少需要 2 個字元').max(100),
  bootstrapToken: z.string().max(512, '初始化令牌過長').optional(),
});

type LoginValues = z.infer<typeof loginSchema>;
type BootstrapValues = z.infer<typeof bootstrapSchema>;

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [bootstrapRequired, setBootstrapRequired] = useState<boolean>();
  const [bootstrapTokenRequired, setBootstrapTokenRequired] = useState(false);
  const [statusError, setStatusError] = useState<string>();

  useEffect(() => {
    if (auth.session) router.replace('/dashboard');
  }, [auth.session, router]);

  useEffect(() => {
    let active = true;
    apiRequest<{ required?: boolean; initialized?: boolean; tokenRequired?: boolean }>(
      '/auth/bootstrap/status',
      {
        skipAuthRefresh: true,
      },
    )
      .then((status) => {
        if (active) {
          setBootstrapRequired(status.required ?? status.initialized === false);
          setBootstrapTokenRequired(Boolean(status.tokenRequired));
        }
      })
      .catch((error) => {
        if (active) setStatusError(toMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(320px,0.82fr)_minmax(540px,1.18fr)]">
      <section className="relative hidden overflow-hidden bg-[#202823] p-10 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-[#e8f5ee] text-[#12643f]">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="font-semibold">AgentOps</p>
            <p className="text-xs text-[#aab7ad]">Enterprise Console</p>
          </div>
        </div>
        <div className="my-auto max-w-md">
          <div className="mb-8 grid grid-cols-2 gap-3" aria-hidden="true">
            <div className="flex h-28 flex-col justify-between rounded-lg border border-white/10 bg-white/5 p-4">
              <Bot className="size-5 text-[#8fd5ad]" />
              <span className="h-2 w-20 rounded bg-white/15" />
            </div>
            <div className="flex h-28 flex-col justify-between rounded-lg border border-white/10 bg-white/5 p-4">
              <ShieldCheck className="size-5 text-[#f3bd62]" />
              <span className="h-2 w-28 rounded bg-white/15" />
            </div>
            <div className="col-span-2 flex h-16 items-center gap-4 rounded-lg border border-white/10 bg-white/5 px-4">
              <span className="size-7 rounded bg-[#3d4b42]" />
              <span className="flex-1">
                <span className="mb-2 block h-2 w-2/5 rounded bg-white/20" />
                <span className="block h-1.5 w-3/5 rounded bg-white/10" />
              </span>
            </div>
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-tight">
            企業 AI Agent 的統一控制台
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#b8c2ba]">
            集中管理 Agent 版本、模型連接、工具權限、執行軌跡與成本。
          </p>
        </div>
        <p className="text-xs text-[#87968a]">Secure multi-tenant operations</p>
      </section>
      <section className="flex min-h-screen items-center justify-center bg-[#f7f8f6] p-5 sm:p-10">
        <div className="w-full max-w-[430px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-md bg-[#dff2e7] text-[#12643f]">
              <Sparkles className="size-4" />
            </span>
            <p className="font-semibold">AgentOps</p>
          </div>
          {statusError ? (
            <div className="rounded-lg border border-[#efc1bc] bg-[#fff7f6] p-5">
              <p className="font-medium text-[#8e2119]">無法連接平台 API</p>
              <p className="mt-1 text-sm leading-6 text-[#9f4a43]">{statusError}</p>
              <Button variant="secondary" className="mt-4" onClick={() => window.location.reload()}>
                重試
              </Button>
            </div>
          ) : bootstrapRequired === undefined ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <LoaderCircle className="size-4 animate-spin" />
              檢查系統狀態
            </div>
          ) : bootstrapRequired ? (
            <BootstrapForm
              tokenRequired={bootstrapTokenRequired}
              onComplete={(session) => {
                auth.acceptSession(session);
                router.replace('/dashboard');
              }}
            />
          ) : (
            <LoginForm
              onLogin={async (values) => {
                await auth.login(values.email, values.password);
                router.replace('/dashboard');
              }}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function LoginForm({ onLogin }: { onLogin: (values: LoginValues) => Promise<void> }) {
  const [submitError, setSubmitError] = useState<string>();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setSubmitError(undefined);
    try {
      await onLogin(values);
    } catch (error) {
      setSubmitError(toMessage(error));
    }
  });
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">登入工作台</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">使用企業帳戶繼續</p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="電郵地址" required error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </Field>
        <Field label="密碼" required error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        {submitError ? (
          <p
            role="alert"
            className="rounded-md border border-[#efc1bc] bg-[#fff7f6] px-3 py-2 text-sm text-[#98281f]"
          >
            {submitError}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          <LockKeyhole className="size-4" />
          登入
        </Button>
      </form>
    </>
  );
}

function BootstrapForm({
  onComplete,
  tokenRequired,
}: {
  onComplete: (session: AuthSession) => void;
  tokenRequired: boolean;
}) {
  const [submitError, setSubmitError] = useState<string>();
  const form = useForm<BootstrapValues>({
    resolver: zodResolver(bootstrapSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      organizationName: '',
      workspaceName: '',
      bootstrapToken: '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setSubmitError(undefined);
    try {
      const { bootstrapToken, ...payload } = values;
      const session = await apiRequest<AuthSession>('/auth/bootstrap', {
        method: 'POST',
        body: payload,
        headers: bootstrapToken ? { 'X-Bootstrap-Token': bootstrapToken } : undefined,
        skipAuthRefresh: true,
      });
      onComplete(session);
    } catch (error) {
      setSubmitError(toMessage(error));
    }
  });
  return (
    <>
      <div className="mb-6">
        <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-[#e8f5ee] text-[#12643f]">
          <Building2 className="size-4" />
        </div>
        <h1 className="text-2xl font-semibold">初始化管理員</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">建立第一個組織、工作區與 Owner 帳戶</p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="管理員名稱" required error={form.formState.errors.name?.message}>
            <Input autoComplete="name" {...form.register('name')} />
          </Field>
          <Field label="電郵地址" required error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field label="組織名稱" required error={form.formState.errors.organizationName?.message}>
            <Input {...form.register('organizationName')} />
          </Field>
          <Field label="工作區名稱" required error={form.formState.errors.workspaceName?.message}>
            <Input {...form.register('workspaceName')} />
          </Field>
        </div>
        <Field
          label="管理員密碼"
          required
          hint="至少 12 個字元，包含大小寫英文字母與數字"
          error={form.formState.errors.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field
          label="初始化令牌"
          required={tokenRequired}
          error={form.formState.errors.bootstrapToken?.message}
        >
          <Input
            type="password"
            autoComplete="off"
            required={tokenRequired}
            {...form.register('bootstrapToken')}
          />
        </Field>
        {submitError ? (
          <p
            role="alert"
            className="rounded-md border border-[#efc1bc] bg-[#fff7f6] px-3 py-2 text-sm text-[#98281f]"
          >
            {submitError}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          <ShieldCheck className="size-4" />
          建立平台
        </Button>
      </form>
    </>
  );
}
