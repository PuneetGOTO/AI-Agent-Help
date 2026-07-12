import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <FileQuestion className="mx-auto mb-4 size-10 text-[var(--muted)]" />
        <h1 className="text-xl font-semibold">找不到此頁面</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          連結可能已失效，或目前帳戶沒有可見的資源。
        </p>
        <Button asChild className="mt-5">
          <Link href="/dashboard">返回 Dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
