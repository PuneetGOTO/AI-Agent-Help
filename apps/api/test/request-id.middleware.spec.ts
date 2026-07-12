import type { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware } from '../src/common/http/request-id.middleware';

describe('requestIdMiddleware', () => {
  it('replaces control characters and oversized untrusted request IDs', () => {
    const request = {
      headers: { 'x-request-id': `attacker\r\nforged:${'x'.repeat(200)}` },
    } as unknown as Request;
    const setHeader = jest.fn();

    requestIdMiddleware(request, { setHeader } as unknown as Response, jest.fn() as NextFunction);

    const value = request.headers['x-request-id'];
    expect(value).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', value);
  });

  it('preserves a bounded interoperable request ID', () => {
    const request = { headers: { 'x-request-id': 'trace_123:span-4' } } as unknown as Request;
    const setHeader = jest.fn();

    requestIdMiddleware(request, { setHeader } as unknown as Response, jest.fn() as NextFunction);

    expect(request.headers['x-request-id']).toBe('trace_123:span-4');
  });
});
