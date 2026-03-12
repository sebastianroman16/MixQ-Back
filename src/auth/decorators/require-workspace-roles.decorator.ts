import { SetMetadata } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';

export const WORKSPACE_ROLES_KEY = 'workspace_roles';
export const RequireWorkspaceRoles = (...roles: WorkspaceRole[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);
