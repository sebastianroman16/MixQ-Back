import { IsEmail, IsString, MinLength } from 'class-validator';

export class ActivateInvitationDto {
  @IsString()
  token: string;

  @IsEmail()
  email: string;

  @IsString()
  temporaryPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
