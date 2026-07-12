import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import { TenantScoped } from '../../common/tenancy/tenant-scope.decorator';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import { CreateWorkspaceDto, UpdateWorkspaceSettingsDto } from './dto/workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get('workspaces')
  @TenantScoped('organization')
  @RequirePermissions(PERMISSIONS.WORKSPACE_READ)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.workspaces.list(tenant);
  }

  @Post('workspaces')
  @TenantScoped('organization')
  @RequirePermissions(PERMISSIONS.WORKSPACE_UPDATE)
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(tenant, dto);
  }

  @Get('settings/workspace')
  @RequirePermissions(PERMISSIONS.WORKSPACE_READ)
  settings(@CurrentTenant() tenant: TenantContext) {
    return this.workspaces.settings(tenant);
  }

  @Patch('settings/workspace')
  @RequirePermissions(PERMISSIONS.WORKSPACE_UPDATE)
  updateSettings(@CurrentTenant() tenant: TenantContext, @Body() dto: UpdateWorkspaceSettingsDto) {
    return this.workspaces.updateSettings(tenant, dto);
  }
}
