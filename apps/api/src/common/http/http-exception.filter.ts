import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const value = isHttpException ? exception.getResponse() : undefined;
    const body = typeof value === 'object' && value !== null ? value : { message: value };
    const requestId = request.headers['x-request-id']?.toString();
    const path = request.path || safePath(request.originalUrl);

    if (status >= 500) {
      const exceptionName = exception instanceof Error ? exception.name : 'UnknownError';
      this.logger.error(
        `${request.method} ${path} failed (${exceptionName}, requestId=${requestId ?? 'n/a'})`,
      );
    }

    response.status(status).json({
      statusCode: status,
      message:
        status >= 500
          ? 'Internal server error'
          : 'message' in body
            ? sanitize(body.message)
            : 'Request failed',
      error:
        status >= 500
          ? 'Internal Server Error'
          : 'error' in body
            ? sanitize(body.error)
            : (HttpStatus[status] ?? 'Error'),
      path,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'string') {
    return value
      .replace(/\b(sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
      .replace(
        /(authorization|api[-_ ]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
        '$1=[REDACTED]',
      )
      .slice(0, 2000);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, child]) => [
          key,
          /(authorization|api.?key|password|secret|token|credential|cookie|session)/i.test(key)
            ? '[REDACTED]'
            : sanitizeValue(child, depth + 1),
        ]),
    );
  }
  return value;
}

function safePath(value: string): string {
  try {
    return new URL(value, 'http://localhost').pathname;
  } catch {
    return value.split('?')[0]?.slice(0, 1000) || '/';
  }
}
