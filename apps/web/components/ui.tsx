'use client';

import { Slot } from '@radix-ui/react-slot';
import { LoaderCircle, X } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { createContext, useContext, useEffect, useId, useState } from 'react';
import { cn, statusTone } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
  asChild?: boolean;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  children,
  asChild,
  ...props
}: ButtonProps) {
  const styles = cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    variant === 'primary' &&
      'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]',
    variant === 'secondary' &&
      'border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--surface-subtle)]',
    variant === 'ghost' &&
      'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]',
    variant === 'danger' && 'border-[#d92d20] bg-[#d92d20] text-white hover:bg-[#b42318]',
    size === 'sm' && 'h-8 px-3 text-xs',
    size === 'md' && 'h-9 px-3.5 text-sm',
    size === 'icon' && 'size-9 p-0',
    className,
  );
  if (asChild) {
    return (
      <Slot className={styles} aria-disabled={disabled || loading} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button className={styles} disabled={disabled || loading} {...props}>
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      'h-9 w-full rounded-md border bg-white px-3 text-sm text-[var(--foreground)] shadow-xs placeholder:text-[#929a94] disabled:bg-[var(--surface-subtle)] disabled:text-[var(--muted)]',
      className,
    )}
    {...props}
  />
);

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cn(
      'min-h-24 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm leading-6 text-[var(--foreground)] shadow-xs placeholder:text-[#929a94] disabled:bg-[var(--surface-subtle)]',
      className,
    )}
    {...props}
  />
);

export const Select = ({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      'h-9 w-full rounded-md border bg-white px-3 text-sm text-[var(--foreground)] shadow-xs disabled:bg-[var(--surface-subtle)]',
      className,
    )}
    {...props}
  >
    {children}
  </select>
);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-[#39433d]">
        {label} {required ? <span className="text-[var(--danger)]">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-[var(--danger)]">{error}</span> : null}
      {!error && hint ? (
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[#aeb7b0] bg-[#cbd1cc]',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[17px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const resolvedTone = tone ?? statusTone(String(children));
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold uppercase',
        resolvedTone === 'success' && 'bg-[#e8f5ee] text-[#12643f]',
        resolvedTone === 'warning' && 'bg-[#fff4db] text-[#8a4b00]',
        resolvedTone === 'danger' && 'bg-[#feeceb] text-[#9f1c14]',
        resolvedTone === 'neutral' && 'bg-[#ecefeb] text-[#59635d]',
      )}
    >
      {children}
    </span>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-lg border bg-white', className)}>{children}</section>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-[#1e2521]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'max-h-[calc(100vh-2rem)] w-full overflow-auto rounded-lg border bg-white shadow-2xl animate-enter',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-xl',
          size === 'lg' && 'max-w-3xl',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="關閉">
            <X className="size-4" />
          </Button>
        </header>
        <div className="p-5">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t bg-[#fafbfa] px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

interface ToastValue {
  push: (message: string, tone?: 'success' | 'danger') => void;
}
const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<
    Array<{ id: number; message: string; tone: 'success' | 'danger' }>
  >([]);
  const push = (message: string, tone: 'success' | 'danger' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'rounded-md border px-4 py-3 text-sm shadow-lg animate-enter',
              toast.tone === 'success'
                ? 'border-[#afd9c2] bg-[#f0faf5] text-[#174c32]'
                : 'border-[#f0b9b4] bg-[#fff5f4] text-[#852018]',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
