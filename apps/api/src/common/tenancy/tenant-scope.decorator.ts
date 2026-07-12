import { SetMetadata } from '@nestjs/common';
import type { TenantScope } from './tenancy.types';

export const TENANT_SCOPE_KEY = 'tenantScope';
export const TenantScoped = (scope: TenantScope): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_SCOPE_KEY, scope);
