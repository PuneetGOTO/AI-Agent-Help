import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import { CreateProviderDto, UpdateProviderDto } from './dto/provider.dto';
import { ProvidersService } from './providers.service';

@ApiTags('Provider connections')
@ApiBearerAuth()
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROVIDER_READ)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.providers.list(tenant);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROVIDER_MANAGE)
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateProviderDto) {
    return this.providers.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROVIDER_MANAGE)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providers.update(tenant, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.PROVIDER_MANAGE)
  remove(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.providers.remove(tenant, id);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PROVIDER_MANAGE)
  validate(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.providers.validate(tenant, id);
  }

  @Get(':id/models')
  @RequirePermissions(PERMISSIONS.PROVIDER_READ)
  models(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.providers.models(tenant, id);
  }
}
