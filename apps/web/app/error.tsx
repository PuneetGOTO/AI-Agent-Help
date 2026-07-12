'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/states';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('UI boundary error', { message: error.message, digest: error.digest });
  }, [error]);
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <ErrorState title="頁面無法顯示" error={error} onRetry={reset} />
    </main>
  );
}
