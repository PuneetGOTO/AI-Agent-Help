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
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import type { Request, Response } from 'express';
import { AgentExecutionService } from './agent-execution.service';
import { AgentsService } from './agents.service';
import {
  CreateAgentDto,
  CreateAgentVersionDto,
  ChatDto,
  PublishAgentDto,
  RollbackAgentDto,
  UpdateAgentDto,
} from './dto/agent.dto';

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly execution: AgentExecutionService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.agents.list(tenant);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.AGENT_WRITE)
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAgentDto,
  ) {
    return this.agents.create(tenant, user, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  get(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.AGENT_WRITE)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agents.update(tenant, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.AGENT_WRITE)
  remove(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.remove(tenant, id);
  }

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.AGENT_READ)
  versions(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.versions(tenant, id);
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSIONS.AGENT_WRITE)
  createVersion(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAgentVersionDto,
  ) {
    return this.agents.createVersion(tenant, user, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.AGENT_PUBLISH)
  publish(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishAgentDto,
  ) {
    return this.agents.publish(tenant, id, dto.versionId);
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.AGENT_PUBLISH)
  rollback(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RollbackAgentDto,
  ) {
    return this.agents.rollback(tenant, id, dto.versionId);
  }

  @Post(':id/duplicate')
  @RequirePermissions(PERMISSIONS.AGENT_WRITE)
  duplicate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agents.duplicate(tenant, user, id);
  }

  @Post(':id/chat')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.AGENT_RUN)
  chat(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatDto,
  ) {
    return this.execution.chat(tenant, user, id, dto);
  }

  @Post(':id/chat/stream')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.AGENT_RUN)
  async stream(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const abort = new AbortController();
    request.on('close', () => abort.abort());
    for await (const event of this.execution.stream(tenant, user, id, dto, abort.signal)) {
      if (response.writableEnded) break;
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
    response.end();
  }
}
