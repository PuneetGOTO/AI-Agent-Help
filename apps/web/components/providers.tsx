'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from './auth-provider';
import { ToastProvider } from './ui';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
