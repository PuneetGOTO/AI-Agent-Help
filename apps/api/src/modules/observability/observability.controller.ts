import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import { AuditService } from './audit.service';
import { ConversationsService } from './conversations.service';
import { PageQueryDto, UsageQueryDto } from './dto/query.dto';
import { UsageService } from './usage.service';

@ApiTags('Observability')
@ApiBearerAuth()
@Controller()
export class ObservabilityController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly usageService: UsageService,
    private readonly auditService: AuditService,
  ) {}

  @Get('conversations')
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  conversations(@CurrentTenant() tenant: TenantContext, @Query() query: PageQueryDto) {
    return this.conversationsService.conversations(tenant, query);
  }

  @Get('conversations/:id')
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  conversation(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversationsService.conversation(tenant, id);
  }

  @Get('runs')
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  runs(@CurrentTenant() tenant: TenantContext, @Query() query: PageQueryDto) {
    return this.conversationsService.runs(tenant, query);
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  run(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversationsService.run(tenant, id);
  }

  @Get('usage/summary')
  @RequirePermissions(PERMISSIONS.USAGE_READ)
  usage(@CurrentTenant() tenant: TenantContext, @Query() query: UsageQueryDto) {
    return this.usageService.summary(tenant, query);
  }

  @Get('audit-logs')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  audit(@CurrentTenant() tenant: TenantContext, @Query() query: PageQueryDto) {
    return this.auditService.list(tenant, query);
  }
}
