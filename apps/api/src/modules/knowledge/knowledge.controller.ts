import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@agent-platform/shared';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { CurrentTenant } from '../../common/tenancy/current-tenant.decorator';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import { CreateKnowledgeBaseDto } from './dto/knowledge.dto';
import { KnowledgeService, type UploadedDocument } from './knowledge.service';

const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/json',
  'text/csv',
]);

@ApiTags('Knowledge bases')
@ApiBearerAuth()
@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_READ)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.knowledge.list(tenant);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_READ)
  get(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.get(tenant, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledge.create(tenant, dto);
  }

  @Post(':id/documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) =>
        callback(
          ALLOWED_MIME_TYPES.has(file.mimetype)
            ? null
            : new BadRequestException('Unsupported document type'),
          ALLOWED_MIME_TYPES.has(file.mimetype),
        ),
    }),
  )
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  upload(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedDocument,
  ) {
    if (!file) throw new BadRequestException('A document file is required');
    return this.knowledge.upload(tenant, id, file);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  removeDocument(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.knowledge.removeDocument(tenant, id, documentId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  remove(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.remove(tenant, id);
  }
}
