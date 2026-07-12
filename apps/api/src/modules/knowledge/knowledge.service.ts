import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import { StorageService } from '../storage/storage.service';
import type { CreateKnowledgeBaseDto } from './dto/knowledge.dto';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(tenant: TenantContext) {
    const items = await this.prisma.knowledgeBase.findMany({
      where: { workspaceId: workspace(tenant) },
      include: { _count: { select: { documents: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async get(tenant: TenantContext, id: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id, workspaceId: workspace(tenant) },
      include: {
        documents: {
          include: { _count: { select: { chunks: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found');
    return {
      ...knowledgeBase,
      documentCount: knowledgeBase.documents.length,
      chunkCount: knowledgeBase.documents.reduce(
        (sum, document) => sum + document._count.chunks,
        0,
      ),
      documents: knowledgeBase.documents.map((document) => ({
        ...document,
        chunkCount: document._count.chunks,
      })),
    };
  }

  async create(tenant: TenantContext, dto: CreateKnowledgeBaseDto) {
    const workspaceId = workspace(tenant);
    return this.prisma.knowledgeBase.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
      },
    });
  }

  async upload(tenant: TenantContext, id: string, file: UploadedDocument) {
    const knowledgeBase = await this.getOwned(tenant, id);
    const objectKey = `workspaces/${knowledgeBase.workspaceId}/knowledge/${knowledgeBase.id}/${randomUUID()}`;
    await this.storage.put(objectKey, file.buffer, file.mimetype);
    let document: Awaited<ReturnType<PrismaService['document']['create']>>;
    try {
      document = await this.prisma.document.create({
        data: {
          knowledgeBaseId: knowledgeBase.id,
          name: file.originalname.slice(0, 255),
          objectKey,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          status: DocumentStatus.PROCESSING,
        },
      });
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
    if (!isTextDocument(file.mimetype)) {
      return this.prisma.document.update({
        where: { id: document.id },
        data: { status: DocumentStatus.PENDING },
        include: { _count: { select: { chunks: true } } },
      });
    }
    try {
      const chunks = chunkText(file.buffer.toString('utf8'));
      if (!chunks.length) throw new BadRequestException('Document does not contain readable text');
      await this.prisma.$transaction([
        this.prisma.knowledgeChunk.createMany({
          data: chunks.map((content, sequence) => ({
            documentId: document.id,
            sequence,
            content,
            tokenCount: approximateTokens(content),
          })),
        }),
        this.prisma.document.update({
          where: { id: document.id },
          data: { status: DocumentStatus.READY, errorMessage: null },
        }),
      ]);
    } catch (error) {
      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage:
            error instanceof Error ? error.message.slice(0, 500) : 'Document processing failed',
        },
      });
    }
    return this.prisma.document.findUniqueOrThrow({
      where: { id: document.id },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async removeDocument(
    tenant: TenantContext,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    const knowledgeBase = await this.getOwned(tenant, knowledgeBaseId);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, knowledgeBaseId: knowledgeBase.id },
    });
    if (!document) throw new NotFoundException('Document not found');
    await this.prisma.document.delete({ where: { id: document.id } });
    try {
      await this.storage.remove(document.objectKey);
    } catch {
      throw new BadRequestException(
        'Document metadata was deleted but object cleanup failed; retry storage cleanup',
      );
    }
  }

  async remove(tenant: TenantContext, id: string): Promise<void> {
    const knowledgeBase = await this.get(tenant, id);
    const references = await this.prisma.agentVersionKnowledgeBase.count({
      where: { knowledgeBaseId: knowledgeBase.id },
    });
    if (references) {
      throw new BadRequestException('Knowledge base is referenced by agent versions');
    }
    await this.prisma.knowledgeBase.delete({ where: { id: knowledgeBase.id } });
    const failures: string[] = [];
    for (const document of knowledgeBase.documents) {
      try {
        await this.storage.remove(document.objectKey);
      } catch {
        failures.push(document.objectKey);
      }
    }
    if (failures.length) {
      throw new BadRequestException(
        `Knowledge base was deleted but ${failures.length} object cleanup operation(s) failed`,
      );
    }
  }

  private async getOwned(tenant: TenantContext, id: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id, workspaceId: workspace(tenant) },
    });
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found');
    return knowledgeBase;
  }
}

function isTextDocument(mimeType: string): boolean {
  return ['text/plain', 'text/markdown', 'application/json', 'text/csv'].includes(mimeType);
}

function chunkText(value: string): string[] {
  const normalized = value.replaceAll(String.fromCharCode(0), '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  const size = 1600;
  const overlap = 200;
  for (let start = 0; start < normalized.length; start += size - overlap) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
  }
  return chunks.slice(0, 10_000);
}

function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export interface UploadedDocument {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

function workspace(tenant: TenantContext): string {
  if (!tenant.workspaceId) throw new BadRequestException('Workspace context is required');
  return tenant.workspaceId;
}
