import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { TenantContext } from './tenancy.types';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const tenant = context.switchToHttp().getRequest<Request & { tenant?: TenantContext }>().tenant;
    if (!tenant) throw new ForbiddenException('A valid tenant context is required');
    return tenant;
  },
);
