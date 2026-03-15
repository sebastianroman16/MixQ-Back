import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class CreateWorkspaceInvitationDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}
