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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import { TenantScoped } from '../../common/tenancy/tenant-scope.decorator';
import type { AuthUser, TenantContext } from '../../common/tenancy/tenancy.types';
import {
  AcceptInvitationDto,
  CreateRoleDto,
  InviteMemberDto,
  RegisterInvitationDto,
  UpdateMemberDto,
  UpdateRoleDto,
} from './dto/members.dto';
import { MembersService } from './members.service';
import { RequestRateLimitService } from '../runtime/request-rate-limit.service';
import type { Request } from 'express';

@ApiTags('Members and roles')
@ApiBearerAuth()
@TenantScoped('organization')
@Controller()
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly rateLimit: RequestRateLimitService,
  ) {}

  @Get('members')
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  members(@CurrentTenant() tenant: TenantContext) {
    return this.membersService.members(tenant);
  }

  @Patch('members/:id')
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  updateMember(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.membersService.updateMember(tenant, id, dto);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  removeMember(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.membersService.removeMember(tenant, id);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  roles(@CurrentTenant() tenant: TenantContext) {
    return this.membersService.roles(tenant);
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  createRole(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateRoleDto) {
    return this.membersService.createRole(tenant, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  updateRole(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.membersService.updateRole(tenant, id, dto);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  removeRole(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.membersService.removeRole(tenant, id);
  }

  @Get('invitations')
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  invitations(@CurrentTenant() tenant: TenantContext) {
    return this.membersService.invitations(tenant);
  }

  @Post('invitations')
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  invite(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.membersService.invite(tenant, user, dto);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.MEMBER_MANAGE)
  revokeInvitation(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.membersService.revokeInvitation(tenant, id);
  }

  @Public()
  @Post('invitations/register')
  async registerInvitation(@Body() dto: RegisterInvitationDto, @Req() request: Request) {
    await Promise.all([
      this.rateLimit.consume('invitation-register-ip', request.ip, 10, 3600),
      this.rateLimit.consume('invitation-register-token', dto.token, 10, 3600),
    ]);
    return this.membersService.registerInvitation(dto);
  }

  @TenantScoped('none')
  @Post('invitations/accept')
  acceptInvitation(@CurrentUser() user: AuthUser, @Body() dto: AcceptInvitationDto) {
    return this.membersService.acceptInvitation(user, dto);
  }
}
