import { IsOptional, IsUUID } from 'class-validator';

export class AssignQuoteFolderDto {
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}
