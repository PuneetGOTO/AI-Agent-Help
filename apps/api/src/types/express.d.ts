import type { AuthUser, TenantContext } from '../common/tenancy/tenancy.types';
import type { ApiKeyPrincipal } from '../modules/api-keys/api-keys.service';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenant?: TenantContext;
      apiKey?: ApiKeyPrincipal;
    }
  }
}

export {};
