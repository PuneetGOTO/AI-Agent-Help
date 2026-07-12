import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Paginated } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function asPaginated<T>(value: unknown): Paginated<T> {
  if (Array.isArray(value)) {
    return { items: value as T[], total: value.length, page: 1, pageSize: value.length };
  }
  if (value && typeof value === 'object') {
    const candidate = value as Partial<Paginated<T>> & { data?: unknown };
    if (Array.isArray(candidate.items)) {
      return {
        items: candidate.items,
        total: candidate.total ?? candidate.items.length,
        page: candidate.page ?? 1,
        pageSize: candidate.pageSize ?? candidate.items.length,
      };
    }
    if (candidate.data !== undefined) return asPaginated<T>(candidate.data);
  }
  return { items: [], total: 0, page: 1, pageSize: 0 };
}

export function unwrapData<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export function formatCurrency(value?: number | null, digits = 2) {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 4),
  }).format(value ?? 0);
}

export function formatNumber(value?: number | null) {
  return new Intl.NumberFormat('zh-HK', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value ?? 0,
  );
}

export function formatDate(value?: string | null, includeTime = true) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function statusTone(status?: string) {
  const normalized = status?.toUpperCase();
  if (['ACTIVE', 'PUBLISHED', 'SUCCEEDED', 'VALID'].includes(normalized ?? '')) return 'success';
  if (['FAILED', 'INVALID', 'ERROR', 'REVOKED'].includes(normalized ?? '')) return 'danger';
  if (['RUNNING', 'QUEUED', 'PENDING', 'UNVERIFIED'].includes(normalized ?? '')) return 'warning';
  return 'neutral';
}

export function toMessage(error: unknown) {
  return error instanceof Error ? error.message : '發生未預期錯誤';
}
