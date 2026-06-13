import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class UpdateWorkspaceMemberRoleDto {
  @IsOptional()
  @IsEnum(WorkspaceRole)
  role?: WorkspaceRole;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
}
