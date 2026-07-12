export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface TenantContext {
  organizationId: string;
  workspaceId?: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  apiKeyId?: string;
  apiKeyAgentId?: string;
}

export type TenantScope = 'none' | 'organization' | 'workspace';
