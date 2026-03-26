import { TemplateType } from '@prisma/client';

export class TemplateSummaryDto {
  id!: string;
  userId!: string | null;
  type!: TemplateType;
  name!: string;
  isDefault!: boolean;
  isActive!: boolean;
  theme!: unknown;
  createdAt!: Date;
  updatedAt!: Date;
}
