import {
  ConflictException,
  ForbiddenException,
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

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async create(userId: string, dto: CreateServiceDto) {
    await this.subscriptionsService.assertCanCreateService(userId);
    const category = await this.ensureCategoryAccess(userId, dto.categoryId);
    const inventoryCode = await this.generateInventoryCode(
      userId,
      category.id,
      category.name,
    );

    try {
      return await this.prisma.service.create({
        data: {
          userId,
          inventoryCode,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
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

  findAll(userId: string) {
    return this.prisma.service.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { category: true },
    });
  }

  async findOne(userId: string, id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    if (service.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return service;
  }

  async update(userId: string, id: string, dto: UpdateServiceDto) {
    const service = await this.ensureServiceAccess(userId, id);
    let inventoryCode: string | undefined;

    if (dto.categoryId) {
      const category = await this.ensureCategoryAccess(userId, dto.categoryId);
      if (category.id !== service.categoryId) {
        inventoryCode = await this.generateInventoryCode(
          userId,
          category.id,
          category.name,
        );
      }
    }

    try {
      return await this.prisma.service.update({
        where: { id: service.id },
        data: {
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

  async remove(userId: string, id: string) {
    const service = await this.ensureServiceAccess(userId, id);
    return this.prisma.service.delete({ where: { id: service.id } });
  }

  async createCategory(userId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        userId,
        name: dto.name,
      },
    });
  }

  listCategories(userId: string) {
    return this.prisma.category.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async getCategory(userId: string, id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return category;
  }

  async updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.category.findUnique({
          where: { id },
        });

        if (!existing) {
          throw new NotFoundException('Category not found');
        }

        if (existing.userId !== userId) {
          throw new ForbiddenException('Access denied');
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
            userId,
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

  async removeCategory(userId: string, id: string) {
    const category = await this.getCategory(userId, id);
    return this.prisma.category.delete({ where: { id: category.id } });
  }

  private async ensureServiceAccess(userId: string, id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    if (service.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return service;
  }

  private async ensureCategoryAccess(userId: string, id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category.userId !== userId) {
      throw new ForbiddenException('Access denied');
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
    userId: string,
    categoryId: string,
    categoryName: string,
  ) {
    const prefix = this.buildPrefix(categoryName);
    const latest = await this.prisma.service.findFirst({
      where: {
        userId,
        categoryId,
        inventoryCode: { startsWith: prefix },
      },
      orderBy: { inventoryCode: 'desc' },
      select: { inventoryCode: true },
    });

    const match = latest?.inventoryCode?.match(
      new RegExp(`^${prefix}(\\d+)$`),
    );
    const next = match ? Number(match[1]) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }
}
