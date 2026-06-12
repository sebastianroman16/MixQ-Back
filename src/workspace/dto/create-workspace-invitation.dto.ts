import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class CreateWorkspaceInvitationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}
