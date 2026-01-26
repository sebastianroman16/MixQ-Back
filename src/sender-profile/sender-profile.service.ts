import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertSenderProfileDto } from './dto/upsert-sender-profile.dto';

@Injectable()
export class SenderProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    return this.prisma.senderProfile.findUnique({
      where: { userId },
    });
  }

  async upsertProfile(userId: string, dto: UpsertSenderProfileDto) {
    const profile = await this.prisma.senderProfile.upsert({
      where: { userId },
      update: {
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
      create: {
        userId,
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

    const onboardingCompleted = Boolean(
      profile.displayName && profile.contactEmail,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted },
    });

    return profile;
  }
}
