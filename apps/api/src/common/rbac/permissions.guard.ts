import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@agent-platform/shared';
import type { Request } from 'express';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';
import type { TenantContext } from '../tenancy/tenancy.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const tenant = context.switchToHttp().getRequest<Request & { tenant?: TenantContext }>().tenant;
    if (!tenant || !required.every((permission) => tenant.permissions.includes(permission))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
