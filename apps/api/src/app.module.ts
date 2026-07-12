import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { CommonModule } from './common/common.module';
import { PermissionsGuard } from './common/rbac/permissions.guard';
import { TenantGuard } from './common/tenancy/tenant.guard';
import { validateEnvironment } from './config/environment';
import { AuthModule } from './modules/auth/auth.module';
import { AgentsModule } from './modules/agents/agents.module';
import { HealthModule } from './modules/health/health.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { ToolsModule } from './modules/tools/tools.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { StorageModule } from './modules/storage/storage.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { MembersModule } from './modules/members/members.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ObservabilityModule } from './modules/observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnvironment,
    }),
    CommonModule,
    ApiKeysModule,
    RuntimeModule,
    StorageModule,
    AuthModule,
    AgentsModule,
    ProvidersModule,
    ToolsModule,
    KnowledgeModule,
    WorkspacesModule,
    MembersModule,
    ObservabilityModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
