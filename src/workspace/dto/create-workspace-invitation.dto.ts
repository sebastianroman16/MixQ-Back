import { IsEmail, IsEnum } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class CreateWorkspaceInvitationDto {
  @IsEmail()
  email: string;

  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}
