import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFrequentClientDto } from './dto/create-frequent-client.dto';
import { UpdateFrequentClientDto } from './dto/update-frequent-client.dto';

@Injectable()
export class FrequentClientsService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string) {
    return this.prisma.frequentClient.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: 'desc' }, { label: 'asc' }],
    });
  }

  async create(userId: string, workspaceId: string, dto: CreateFrequentClientDto) {
    try {
      return await this.prisma.frequentClient.create({
        data: {
          workspaceId,
          createdByUserId: userId,
          label: dto.label.trim(),
          name: dto.name.trim(),
          rut: dto.rut?.trim() || null,
          giro: dto.giro?.trim() || null,
          email: dto.email.trim().toLowerCase(),
          address: dto.address?.trim() || null,
        },
      });
    } catch (error) {
      if (this.isWorkspaceLabelConflict(error)) {
        throw new ConflictException('Ya existe un cliente frecuente con ese nombre interno.');
      }
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateFrequentClientDto) {
    const client = await this.ensureWorkspaceClient(workspaceId, id);

    try {
      return await this.prisma.frequentClient.update({
        where: { id: client.id },
        data: this.normalizeInput(dto),
      });
    } catch (error) {
      if (this.isWorkspaceLabelConflict(error)) {
        throw new ConflictException('Ya existe un cliente frecuente con ese nombre interno.');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const client = await this.ensureWorkspaceClient(workspaceId, id);
    await this.prisma.frequentClient.delete({ where: { id: client.id } });
    return { success: true };
  }

  private async ensureWorkspaceClient(workspaceId: string, id: string) {
    const client = await this.prisma.frequentClient.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Cliente frecuente no encontrado.');
    }

    return client;
  }

  private normalizeInput(dto: Partial<CreateFrequentClientDto>) {
    const data: {
      label?: string;
      name?: string;
      rut?: string | null;
      giro?: string | null;
      email?: string;
      address?: string | null;
    } = {};

    if (dto.label !== undefined) {
      data.label = dto.label.trim();
    }
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.rut !== undefined) {
      data.rut = dto.rut.trim() || null;
    }
    if (dto.giro !== undefined) {
      data.giro = dto.giro.trim() || null;
    }
    if (dto.email !== undefined) {
      data.email = dto.email.trim().toLowerCase();
    }
    if (dto.address !== undefined) {
      data.address = dto.address.trim() || null;
    }

    return data;
  }

  private isWorkspaceLabelConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.map((value) => String(value))
      : [];

    return target.includes('workspaceId') && target.includes('label');
  }
}
