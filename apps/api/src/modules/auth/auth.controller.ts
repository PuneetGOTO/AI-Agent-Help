import { Body, Controller, Get, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { TenantScoped } from '../../common/tenancy/tenant-scope.decorator';
import type { AuthUser } from '../../common/tenancy/tenancy.types';
import { AuthService } from './auth.service';
import { BootstrapDto, LoginDto } from './dto/auth.dto';
import { RequestRateLimitService } from '../runtime/request-rate-limit.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly rateLimit: RequestRateLimitService,
  ) {}

  @Public()
  @Get('bootstrap/status')
  async bootstrapStatus(@Req() request: Request) {
    await this.rateLimit.consume('bootstrap-status', request.ip, 60, 60);
    return this.auth.bootstrapStatus();
  }

  @Public()
  @Post('bootstrap')
  async bootstrap(
    @Body() dto: BootstrapDto,
    @Headers('x-bootstrap-token') bootstrapToken: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.rateLimit.consume('bootstrap', request.ip, 5, 3600);
    const result = await this.auth.bootstrap(dto, request, bootstrapToken);
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    return withoutRefreshToken(result);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await Promise.all([
      this.rateLimit.consume('login-ip', request.ip, 30, 300),
      this.rateLimit.consume('login-account', dto.email.trim().toLowerCase(), 10, 600),
    ]);
    const result = await this.auth.login(dto, request);
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    return withoutRefreshToken(result);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.rateLimit.consume('refresh', request.ip, 60, 60);
    const result = await this.auth.refresh(
      request.cookies?.refresh_token as string | undefined,
      request,
    );
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    return withoutRefreshToken(result);
  }

  @Public()
  @HttpCode(200)
  @Post('session')
  async restoreSession(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.rateLimit.consume('session-restore', request.ip, 60, 60);
    const result = await this.auth.restore(
      request.cookies?.refresh_token as string | undefined,
      request,
    );
    if (!result) {
      this.clearRefreshCookie(response);
      return { authenticated: false as const };
    }
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    return { authenticated: true as const, ...withoutRefreshToken(result) };
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(request.cookies?.refresh_token as string | undefined);
    this.clearRefreshCookie(response);
  }

  @ApiBearerAuth()
  @TenantScoped('none')
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  private setRefreshCookie(response: Response, value: string, expires: Date): void {
    response.cookie('refresh_token', value, {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE', false),
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie('refresh_token', {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE', false),
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }
}

function withoutRefreshToken<T extends { refreshToken: string; refreshExpiresAt: Date }>(value: T) {
  const { refreshToken, refreshExpiresAt, ...safe } = value;
  void refreshToken;
  void refreshExpiresAt;
  return safe;
}
