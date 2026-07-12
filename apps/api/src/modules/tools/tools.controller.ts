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
import { CreateToolDto, UpdateToolDto } from './dto/tool.dto';
import { ToolsService } from './tools.service';

@ApiTags('Tools')
@ApiBearerAuth()
@Controller('tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TOOL_READ)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.tools.list(tenant);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TOOL_MANAGE)
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateToolDto) {
    return this.tools.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TOOL_MANAGE)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateToolDto,
  ) {
    return this.tools.update(tenant, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.TOOL_MANAGE)
  remove(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tools.remove(tenant, id);
  }
}
