import { WorkspaceRole } from '@prisma/client';

export const WORKSPACE_CAPABILITY_ROLES = {
  manageWorkspace: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN],
  editQuotes: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.EDITOR],
  editTemplates: [
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.EDITOR,
  ],
  editServices: [
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.EDITOR,
  ],
  editSenderProfile: [
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.EDITOR,
  ],
} as const;
