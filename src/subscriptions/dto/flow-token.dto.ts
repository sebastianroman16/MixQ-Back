import { IsString, MaxLength, MinLength } from 'class-validator';

export class FlowTokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  token: string;
}
