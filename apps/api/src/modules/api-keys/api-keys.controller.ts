import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@ApiTags('API keys')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.API_KEY_MANAGE)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.apiKeys.list(tenant);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.API_KEY_MANAGE)
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(tenant, user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.API_KEY_MANAGE)
  revoke(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(tenant, id);
  }
}
