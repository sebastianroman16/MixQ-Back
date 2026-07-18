import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

interface ServiceFilters {
  categoryId?: string;
  search?: string;
  limit?: string;
}

export interface ServiceCountsSummary {
  total: number;
  byCategory: Record<string, number>;
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async create(userId: string, workspaceId: string, dto: CreateServiceDto) {
    await this.subscriptionsService.assertCanCreateService(userId);
    const category = dto.categoryId
      ? await this.ensureCategoryAccess(workspaceId, dto.categoryId)
      : null;
    const inventoryCode = await this.generateInventoryCode(
      workspaceId,
      category?.id ?? null,
      category?.name ?? null,
    );

    try {
      return await this.prisma.service.create({
        data: {
          userId,
          workspaceId,
          inventoryCode,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId ?? null,
          unitPrice: new Prisma.Decimal(dto.unitPrice),
          quantity: dto.quantity,
        },
        include: {
          category: true,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Inventory code already exists');
      }
      throw error;
    }
  }

  findAll(workspaceId: string, filters: ServiceFilters = {}) {
    const categoryId = filters.categoryId?.trim();
    const search = filters.search?.trim();
    const parsedLimit = Number.parseInt(filters.limit ?? '', 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 250)
        : 100;

    return this.prisma.service.findMany({
      where: {
        workspaceId,
        ...(categoryId ? { categoryId } : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  inventoryCode: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  category: {
                    name: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { category: true },
      take: limit,
    });
  }

  async getCounts(workspaceId: string): Promise<ServiceCountsSummary> {
    const [total, grouped] = await this.prisma.$transaction([
      this.prisma.service.count({
        where: { workspaceId },
      }),
      this.prisma.service.groupBy({
        by: ['categoryId'],
        where: {
          workspaceId,
          categoryId: { not: null },
        },
        orderBy: {
          categoryId: 'asc',
        },
        _count: {
          id: true,
        },
      }),
    ]);

    const byCategory: Record<string, number> = {};
    for (const entry of grouped) {
      if (!entry.categoryId) {
        continue;
      }
      const count =
        typeof entry._count === 'object' && entry._count
          ? (entry._count.id ?? 0)
          : 0;
      byCategory[entry.categoryId] = count;
    }

    return {
      total,
      byCategory,
    };
  }

  async findOne(workspaceId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, workspaceId },
      include: { category: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async update(
    userId: string,
    workspaceId: string,
    id: string,
    dto: UpdateServiceDto,
  ) {
    const service = await this.ensureServiceAccess(workspaceId, id);
    let inventoryCode: string | undefined;

    if (dto.categoryId !== undefined) {
      const category = dto.categoryId
        ? await this.ensureCategoryAccess(workspaceId, dto.categoryId)
        : null;
      if ((category?.id ?? null) !== service.categoryId) {
        inventoryCode = await this.generateInventoryCode(
          workspaceId,
          category?.id ?? null,
          category?.name ?? null,
        );
      }
    }

    try {
      return await this.prisma.service.update({
        where: { id: service.id },
        data: {
          userId,
          workspaceId,
          inventoryCode,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
          unitPrice:
            dto.unitPrice !== undefined
              ? new Prisma.Decimal(dto.unitPrice)
              : undefined,
          quantity: dto.quantity,
        },
        include: { category: true },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Inventory code already exists');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const service = await this.ensureServiceAccess(workspaceId, id);
    return this.prisma.service.delete({ where: { id: service.id } });
  }

  async createCategory(
    userId: string,
    workspaceId: string,
    dto: CreateCategoryDto,
  ) {
    return this.prisma.category.create({
      data: {
        userId,
        workspaceId,
        name: dto.name,
      },
    });
  }

  listCategories(workspaceId: string) {
    return this.prisma.category.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async getCategory(workspaceId: string, id: string) {
    return this.ensureCategoryAccess(workspaceId, id);
  }

  async updateCategory(
    workspaceId: string,
    id: string,
    dto: UpdateCategoryDto,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.category.findFirst({
          where: { id, workspaceId },
        });

        if (!existing) {
          throw new NotFoundException('Category not found');
        }

        const category = await tx.category.update({
          where: { id: existing.id },
          data: {
            name: dto.name,
          },
        });

        const prefix = this.buildPrefix(category.name);
        const services = await tx.service.findMany({
          where: {
            workspaceId,
            categoryId: category.id,
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });

        if (services.length === 0) {
          return category;
        }

        await Promise.all(
          services.map((serviceItem, index) =>
            tx.service.update({
              where: { id: serviceItem.id },
              data: {
                inventoryCode: `${prefix}${String(index + 1).padStart(3, '0')}`,
              },
            }),
          ),
        );

        return category;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Inventory code already exists');
      }
      throw error;
    }
  }

  async removeCategory(workspaceId: string, id: string) {
    const category = await this.getCategory(workspaceId, id);
    return this.prisma.category.delete({ where: { id: category.id } });
  }

  private async ensureServiceAccess(workspaceId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, workspaceId },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  private async ensureCategoryAccess(workspaceId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, workspaceId },
      select: { id: true, userId: true, name: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private buildPrefix(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return 'X';
    }

    if (words.length === 1) {
      return words[0][0].toUpperCase();
    }

    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  private async generateInventoryCode(
    workspaceId: string,
    categoryId: string | null,
    categoryName: string | null,
  ) {
    const prefix = categoryName ? this.buildPrefix(categoryName) : 'SG';
    const latest = await this.prisma.service.findFirst({
      where: {
        workspaceId,
        categoryId,
        inventoryCode: { startsWith: prefix },
      },
      orderBy: { inventoryCode: 'desc' },
      select: { inventoryCode: true },
    });

    const match = latest?.inventoryCode?.match(new RegExp(`^${prefix}(\\d+)$`));
    const next = match ? Number(match[1]) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }
}
