import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(64)
  @MaxLength(256)
  refreshToken: string;
}
