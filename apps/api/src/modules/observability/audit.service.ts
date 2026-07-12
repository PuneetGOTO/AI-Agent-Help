import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantContext } from '../../common/tenancy/tenancy.types';
import type { PageQueryDto } from './dto/query.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext, query: PageQueryDto) {
    const where = {
      organizationId: tenant.organizationId,
      ...(tenant.workspaceId
        ? { OR: [{ workspaceId: tenant.workspaceId }, { workspaceId: null }] }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows, total, page: query.page, pageSize: query.pageSize };
  }
}
