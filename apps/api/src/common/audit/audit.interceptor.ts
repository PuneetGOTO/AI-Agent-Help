import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, TenantContext } from '../tenancy/tenancy.types';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; tenant?: TenantContext }>();
    if (!request.tenant || !request.user || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return next.handle();
    }
    const record = (outcome: 'success' | 'failure'): void => {
      const tenant = request.tenant!;
      const user = request.user!;
      const cleanPath = request.path.replace(/^\/api\/v1\//, '');
      const resourceType = cleanPath.split('/')[0] || 'unknown';
      void this.prisma.auditLog
        .create({
          data: {
            organizationId: tenant.organizationId,
            workspaceId: tenant.workspaceId,
            actorUserId: tenant.apiKeyId ? null : user.id,
            action:
              `${request.method.toLowerCase()}.${cleanPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')}`.slice(
                0,
                200,
              ),
            resourceType: resourceType.slice(0, 100),
            resourceId: typeof request.params.id === 'string' ? request.params.id : undefined,
            ipAddress: request.ip,
            userAgent: request.get('user-agent')?.slice(0, 500),
            metadata: {
              outcome,
              requestId: request.headers['x-request-id']?.toString(),
              ...(tenant.apiKeyId ? { apiKeyId: tenant.apiKeyId } : {}),
            },
          },
        })
        .catch(() => undefined);
    };
    return next.handle().pipe(
      tap({
        complete: () => record('success'),
        error: () => record('failure'),
      }),
    );
  }
}
