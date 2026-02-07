import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: dto.name,
      },
    });

    return {
      user: this.sanitizeUser(user),
      accessToken: this.signToken({
        id: user.id,
        email: user.email,
      }),
    };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let isValid = false;
    try {
      isValid = await bcrypt.compare(dto.password, user.passwordHash);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      user: this.sanitizeUser(user),
      accessToken: this.signToken({
        id: user.id,
        email: user.email,
      }),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        onboardingCompleted: true,
        plan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      onboardingCompleted: user.onboardingCompleted,
    };
  }

  private signToken(payload: { id: string; email: string }) {
    return this.jwtService.sign({
      sub: payload.id,
      email: payload.email,
    });
  }

  private sanitizeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      onboardingCompleted: user.onboardingCompleted,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      currentPeriodEnd: user.currentPeriodEnd,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
