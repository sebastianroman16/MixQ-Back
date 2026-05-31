import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsLogoUrl } from '../../common/validators/logo-url.validator';

export class UpsertSenderProfileDto {
  @IsString()
  @MaxLength(120)
  displayName: string;

  @IsEmail()
  contactEmail: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  commune?: string;

  @IsOptional()
  @IsString()
  @IsLogoUrl({ maxBytes: 2 * 1024 * 1024 })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  rut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  giro?: string;
}
