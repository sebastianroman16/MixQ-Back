import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFrequentClientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  rut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  giro?: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}
