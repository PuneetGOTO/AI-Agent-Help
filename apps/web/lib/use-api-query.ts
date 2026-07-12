'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, type RequestOptions } from './api';

interface QueryState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
}

export function useApiQuery<T>(path: string | null, options?: RequestOptions) {
  const [state, setState] = useState<QueryState<T>>({ loading: Boolean(path) });
  const requestId = useRef(0);
  const optionsKey = JSON.stringify(options ?? {});

  const load = useCallback(async () => {
    if (!path) {
      setState({ loading: false });
      return undefined;
    }
    const id = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const value = await apiRequest<T>(path, options);
      if (id === requestId.current) setState({ data: value, loading: false });
      return value;
    } catch (error) {
      if (id === requestId.current)
        setState({
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        });
      return undefined;
    }
    // optionsKey is the stable representation used to trigger the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, optionsKey]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  return { ...state, refetch: load };
}
