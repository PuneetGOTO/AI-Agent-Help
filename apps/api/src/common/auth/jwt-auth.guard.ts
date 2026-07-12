import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom, type Observable } from 'rxjs';
import type { Request } from 'express';
import { ApiKeysService } from '../../modules/api-keys/api-keys.service';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    if (token?.startsWith('eap_')) {
      const principal = await this.apiKeys.authenticate(token);
      request.user = principal.createdBy;
      request.apiKey = principal;
      return true;
    }
    const result: boolean | Promise<boolean> | Observable<boolean> = super.canActivate(context);
    return isObservable(result) ? lastValueFrom(result) : await result;
  }
}
