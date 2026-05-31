import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateInvitationDto {
  @IsString()
  @MaxLength(128)
  token: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MaxLength(128)
  temporaryPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
