import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, PRESET_ROLE_PERMISSIONS } from '@agent-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class RbacBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

  async createDefaultRoles(
    organizationId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Record<string, string>> {
    const permissions = await Promise.all(
      Object.values(PERMISSIONS).map((key) =>
        client.permission.upsert({
          where: { key },
          update: {},
          create: { key, description: describePermission(key) },
        }),
      ),
    );
    const permissionByKey = new Map(
      permissions.map((permission) => [permission.key, permission.id]),
    );
    const roleIds: Record<string, string> = {};
    for (const [name, rolePermissions] of Object.entries(PRESET_ROLE_PERMISSIONS)) {
      const role = await client.role.upsert({
        where: { organizationId_name: { organizationId, name } },
        update: { description: `${titleCase(name)} built-in role`, isSystem: true },
        create: {
          organizationId,
          name,
          description: `${titleCase(name)} built-in role`,
          isSystem: true,
        },
      });
      roleIds[name] = role.id;
      await client.rolePermission.deleteMany({ where: { roleId: role.id } });
      await client.rolePermission.createMany({
        data: rolePermissions.map((key) => ({
          roleId: role.id,
          permissionId: permissionByKey.get(key)!,
        })),
        skipDuplicates: true,
      });
    }
    return roleIds;
  }
}

function describePermission(key: string): string {
  return `Allows ${key.replace(':', ' operations on ')}`;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1)}${value.slice(1).toLowerCase()}`;
}
