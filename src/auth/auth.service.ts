import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, WorkspaceRole } from '@prisma/client';
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

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          name: dto.name,
        },
      });

      await tx.workspace.create({
        data: {
          id: user.id,
          name: this.getDefaultWorkspaceName(user),
          ownerId: user.id,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { workspaceId: user.id },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: user.id,
          userId: user.id,
          role: WorkspaceRole.OWNER,
        },
      });

      return user;
    });

    return {
      user: {
        ...this.sanitizeUser(created),
        workspaceId: created.id,
        role: WorkspaceRole.OWNER,
      },
      accessToken: this.signToken({
        id: created.id,
        email: created.email,
        tokenVersion: created.tokenVersion,
        workspaceId: created.id,
        role: WorkspaceRole.OWNER,
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

    const session = await this.ensureWorkspaceForUser(user.id);

    return {
      user: {
        ...this.sanitizeUser(user),
        workspaceId: session.workspaceId,
        role: session.role,
      },
      accessToken: this.signToken({
        id: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
        workspaceId: session.workspaceId,
        role: session.role,
      }),
    };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tokenVersion: {
          increment: 1,
        },
      },
      select: { id: true },
    });

    return { success: true };
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
        workspaceId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const session = await this.ensureWorkspaceForUser(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        workspaceId: session.workspaceId,
        role: session.role,
      },
      onboardingCompleted: user.onboardingCompleted,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      currentPeriodEnd: user.currentPeriodEnd,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async ensureWorkspaceForUser(userId: string): Promise<{
    workspaceId: string;
    role: WorkspaceRole;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        workspaceId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    if (!user.workspaceId) {
      await this.prisma.$transaction(async (tx) => {
        await tx.workspace.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            ownerId: user.id,
            name: this.getDefaultWorkspaceName(user),
          },
          update: {},
        });

        await tx.user.update({
          where: { id: user.id },
          data: { workspaceId: user.id },
        });

        await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: user.id,
              userId: user.id,
            },
          },
          create: {
            workspaceId: user.id,
            userId: user.id,
            role: WorkspaceRole.OWNER,
          },
          update: {
            role: WorkspaceRole.OWNER,
          },
        });
      });
    }

    const workspaceId = user.workspaceId ?? user.id;

    const member = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
      },
      select: {
        role: true,
      },
    });

    if (member) {
      return { workspaceId, role: member.role };
    }

    await this.prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId,
        role: WorkspaceRole.OWNER,
      },
    });

    return { workspaceId, role: WorkspaceRole.OWNER };
  }

  private signToken(payload: {
    id: string;
    email: string;
    tokenVersion: number;
    workspaceId: string;
    role: WorkspaceRole;
  }) {
    return this.jwtService.sign({
      sub: payload.id,
      email: payload.email,
      tokenVersion: payload.tokenVersion,
      workspaceId: payload.workspaceId,
      role: payload.role,
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

  private getDefaultWorkspaceName(user: { name: string | null; email: string }) {
    const trimmedName = user.name?.trim();
    if (trimmedName) {
      return `${trimmedName} Workspace`;
    }

    const emailAlias = user.email.split('@')[0]?.trim();
    return emailAlias ? `${emailAlias} Workspace` : 'Workspace';
  }
}
