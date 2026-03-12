import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertSenderProfileDto } from './dto/upsert-sender-profile.dto';

@Injectable()
export class SenderProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(workspaceId: string) {
    return this.prisma.senderProfile.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertProfile(userId: string, workspaceId: string, dto: UpsertSenderProfileDto) {
    const existing = await this.prisma.senderProfile.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    const profile = existing
      ? await this.prisma.senderProfile.update({
          where: { id: existing.id },
          data: {
            userId,
            workspaceId,
            displayName: dto.displayName,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            address: dto.address,
            addressLine: dto.addressLine,
            city: dto.city,
            commune: dto.commune,
            logoUrl: dto.logoUrl,
            legalName: dto.legalName,
            rut: dto.rut,
            giro: dto.giro,
          },
        })
      : await this.prisma.senderProfile.create({
          data: {
            userId,
            workspaceId,
            displayName: dto.displayName,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            address: dto.address,
            addressLine: dto.addressLine,
            city: dto.city,
            commune: dto.commune,
            logoUrl: dto.logoUrl,
            legalName: dto.legalName,
            rut: dto.rut,
            giro: dto.giro,
          },
        });

    const onboardingCompleted = Boolean(profile.displayName && profile.contactEmail);

    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted },
    });

    return profile;
  }
}
