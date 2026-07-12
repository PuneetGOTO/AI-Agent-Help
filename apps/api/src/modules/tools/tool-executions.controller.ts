import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import { RejectToolExecutionDto } from './dto/tool-execution.dto';
import { ToolApprovalService } from './tool-approval.service';

@ApiTags('Tool approvals')
@ApiBearerAuth()
@Controller('tool-executions')
export class ToolExecutionsController {
  constructor(private readonly approvals: ToolApprovalService) {}

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TOOL_MANAGE)
  approve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.approve(tenant, user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TOOL_MANAGE)
  reject(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectToolExecutionDto,
  ) {
    return this.approvals.reject(tenant, user, id, dto.reason);
  }
}
