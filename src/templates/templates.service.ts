import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TemplateSectionType, TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  list(workspaceId: string, type?: TemplateType) {
    const where: Prisma.TemplateWhereInput = {};

    if (type === TemplateType.SYSTEM) {
      where.type = TemplateType.SYSTEM;
      where.userId = null;
    } else if (type === TemplateType.USER) {
      where.type = TemplateType.USER;
      where.workspaceId = workspaceId;
    } else {
      where.OR = [
        { type: TemplateType.SYSTEM, userId: null },
        { type: TemplateType.USER, workspaceId },
      ];
    }

    return this.prisma.template.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        type: true,
        name: true,
        isDefault: true,
        isActive: true,
        theme: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async get(workspaceId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: {
        id,
        OR: [
          { type: TemplateType.SYSTEM, userId: null },
          { type: TemplateType.USER, workspaceId },
        ],
      },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  async create(userId: string, workspaceId: string, dto: CreateTemplateDto) {
    await this.subscriptionsService.assertCanCreateTemplate(userId);
    this.ensureRequiredSections(dto.sections);

    return this.prisma.template.create({
      data: {
        userId,
        workspaceId,
        type: TemplateType.USER,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        theme: dto.theme as Prisma.InputJsonValue,
        sections: {
          create: dto.sections.map((section) => ({
            title: section.title,
            type: section.type,
            position: section.position,
            items: {
              create: section.items.map((item) => ({
                label: item.label,
                value: item.value,
                type: item.type,
                position: item.position,
                meta: item.meta as Prisma.InputJsonValue,
              })),
            },
            meta: section.meta as Prisma.InputJsonValue,
          })),
        },
      },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
      },
    });
  }

  async cloneFromSystem(userId: string, workspaceId: string, id: string) {
    await this.subscriptionsService.assertCanCreateTemplate(userId);
    const template = await this.prisma.template.findFirst({
      where: { id, type: TemplateType.SYSTEM, userId: null },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return this.prisma.template.create({
      data: {
        userId,
        workspaceId,
        type: TemplateType.USER,
        name: `${template.name} (Copy)`,
        isDefault: false,
        isActive: true,
        theme: template.theme as Prisma.InputJsonValue,
        sections: {
          create: template.sections.map((section) => ({
            title: section.title,
            type: section.type,
            position: section.position,
            items: {
              create: section.items.map((item) => ({
                label: item.label,
                value: item.value,
                type: item.type,
                position: item.position,
                meta: item.meta as Prisma.InputJsonValue,
              })),
            },
            meta: section.meta as Prisma.InputJsonValue,
          })),
        },
      },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
      },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.template.findFirst({
      where: { id, type: TemplateType.USER, workspaceId },
    });

    if (!template) {
      const systemTemplate = await this.prisma.template.findFirst({
        where: { id, type: TemplateType.SYSTEM, userId: null },
        select: { id: true },
      });
      if (systemTemplate) {
        throw new ForbiddenException('System templates cannot be updated');
      }
      throw new NotFoundException('Template not found');
    }

    if (dto.sections) {
      this.ensureRequiredSections(dto.sections);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.sections) {
          await tx.templateSection.deleteMany({
            where: { templateId: template.id },
          });
        }

        const updated = await tx.template.update({
          where: { id: template.id },
          data: {
            name: dto.name,
            isDefault: dto.isDefault,
            isActive: dto.isActive,
            theme: dto.theme as Prisma.InputJsonValue,
            sections: dto.sections
              ? {
                  create: dto.sections.map((section) => ({
                    title: section.title,
                    type: section.type,
                    position: section.position,
                    items: {
                      create: section.items.map((item) => ({
                        label: item.label,
                        value: item.value,
                        type: item.type,
                        position: item.position,
                        meta: item.meta as Prisma.InputJsonValue,
                      })),
                    },
                    meta: section.meta as Prisma.InputJsonValue,
                  })),
                }
              : undefined,
          },
          include: {
            sections: {
              orderBy: { position: 'asc' },
              include: {
                items: { orderBy: { position: 'asc' } },
              },
            },
          },
        });

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Template already exists');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, type: TemplateType.USER, workspaceId },
    });

    if (!template) {
      const systemTemplate = await this.prisma.template.findFirst({
        where: { id, type: TemplateType.SYSTEM, userId: null },
        select: { id: true },
      });
      if (systemTemplate) {
        throw new ForbiddenException('System templates cannot be deleted');
      }
      throw new NotFoundException('Template not found');
    }

    return this.prisma.template.delete({ where: { id: template.id } });
  }

  private ensureRequiredSections(
    sections: { type: TemplateSectionType }[],
  ) {
    if (!sections || sections.length === 0) {
      throw new BadRequestException('Template sections are required');
    }

    const required = [
      TemplateSectionType.HEADER,
      TemplateSectionType.CLIENT,
      TemplateSectionType.TABLE,
      TemplateSectionType.TOTALS,
    ];
    const present = new Set(sections.map((section) => section.type));
    const missing = required.filter((type) => !present.has(type));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required sections: ${missing.join(', ')}`,
      );
    }
  }
}
