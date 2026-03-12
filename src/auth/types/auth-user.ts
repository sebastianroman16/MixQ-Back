import { WorkspaceRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  email: string;
  tokenVersion: number;
  workspaceId: string;
  role: WorkspaceRole;
};
