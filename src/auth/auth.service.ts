import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, WorkspaceInvitation, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { InvitationMailService } from '../mail/invitation-mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivateInvitationDto } from './dto/activate-invitation.dto';
import { ActivateInvitationByCredentialsDto } from './dto/activate-invitation-by-credentials.dto';
import { VerifyInvitationCredentialsDto } from './dto/verify-invitation-credentials.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly invitationMailService: InvitationMailService,
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
      return this.registrationAcceptedResponse();
    }

    if (!this.invitationMailService.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds());
    const verificationToken = randomBytes(32).toString('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          name: dto.name,
          emailVerificationTokenHash:
            this.hashVerificationToken(verificationToken),
          emailVerificationExpiresAt: verificationExpiresAt,
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

    const delivery =
      await this.invitationMailService.sendEmailVerificationEmail({
        to: created.email,
        name: created.name,
        token: verificationToken,
      });
    if (!delivery.sent) {
      await this.prisma.user.delete({ where: { id: created.id } });
      throw new ServiceUnavailableException({
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
      });
    }

    return this.registrationAcceptedResponse();
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

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Verify your email before signing in',
      });
    }

    if (user.mustChangePassword) {
      throw new UnauthorizedException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message:
          'Use invitation activation flow to set a new password before login',
      });
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

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationTokenHash: this.hashVerificationToken(token),
        emailVerificationExpiresAt: { gt: new Date() },
        emailVerifiedAt: null,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    return {
      user: {
        ...this.sanitizeUser(verified),
        workspaceId: verified.id,
        role: WorkspaceRole.OWNER,
      },
      accessToken: this.signToken({
        id: verified.id,
        email: verified.email,
        tokenVersion: verified.tokenVersion,
        workspaceId: verified.id,
        role: WorkspaceRole.OWNER,
      }),
    };
  }

  async getInvitationSummary(token: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    const status = invitation.acceptedAt
      ? 'ACCEPTED'
      : invitation.expiresAt <= new Date()
        ? 'EXPIRED'
        : 'PENDING';

    return {
      token: invitation.token,
      workspaceName: invitation.workspace.name,
      workspaceId: invitation.workspace.id,
      invitedEmail: invitation.email,
      role: invitation.role,
      invitedByName: invitation.invitedBy?.name ?? null,
      invitedByEmail: invitation.invitedBy?.email ?? null,
      expiresAt: invitation.expiresAt,
      status,
    };
  }

  async activateInvitation(dto: ActivateInvitationDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token: dto.token },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!invitation || invitation.acceptedAt) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.expiresAt <= new Date()) {
      throw new BadRequestException({ code: 'INVITATION_EXPIRED' });
    }

    if (invitation.email.toLowerCase() !== normalizedEmail) {
      throw new UnauthorizedException('Invalid invitation credentials');
    }

    return this.completeInvitationActivation(
      invitation,
      normalizedEmail,
      dto.temporaryPassword,
      dto.newPassword,
    );
  }

  async activateInvitationByCredentials(
    dto: ActivateInvitationByCredentialsDto,
  ) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const invitation = await this.findPendingInvitationByEmail(normalizedEmail);

    return this.completeInvitationActivation(
      invitation,
      normalizedEmail,
      dto.temporaryPassword,
      dto.newPassword,
    );
  }

  /**
   * Valida correo + contrasena temporal sin activar nada, para que el flujo
   * por pasos pueda avanzar mostrando a que workspace y rol va a entrar.
   */
  async verifyInvitationCredentials(dto: VerifyInvitationCredentialsDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const invitation = await this.findPendingInvitationByEmail(normalizedEmail);
    await this.assertInvitedUserCredentials(
      normalizedEmail,
      dto.temporaryPassword,
    );

    return {
      workspaceName: invitation.workspace.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  private async findPendingInvitationByEmail(normalizedEmail: string) {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
        acceptedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Mismo error que credenciales invalidas para no revelar si el correo existe.
    if (!invitation) {
      throw new UnauthorizedException('Invalid invitation credentials');
    }

    if (invitation.expiresAt <= new Date()) {
      throw new BadRequestException({ code: 'INVITATION_EXPIRED' });
    }

    return invitation;
  }

  private async assertInvitedUserCredentials(
    normalizedEmail: string,
    temporaryPassword: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
    });

    if (!user || !user.mustChangePassword) {
      throw new UnauthorizedException('Invalid invitation credentials');
    }

    const temporaryPasswordMatches = await bcrypt.compare(
      temporaryPassword,
      user.passwordHash,
    );
    if (!temporaryPasswordMatches) {
      throw new UnauthorizedException('Invalid invitation credentials');
    }

    return user;
  }

  private async completeInvitationActivation(
    invitation: WorkspaceInvitation & {
      workspace: { id: string; name: string };
    },
    normalizedEmail: string,
    temporaryPassword: string,
    newPassword: string,
  ) {
    const user = await this.assertInvitedUserCredentials(
      normalizedEmail,
      temporaryPassword,
    );

    const nextPasswordHash = await bcrypt.hash(
      newPassword,
      this.bcryptRounds(),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId: user.id,
          },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
        },
      });

      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: {
          acceptedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: nextPasswordHash,
          emailVerifiedAt: new Date(),
          mustChangePassword: false,
          workspaceId: invitation.workspaceId,
          tokenVersion: {
            increment: 1,
          },
        },
      });
    });

    return {
      user: {
        ...this.sanitizeUser(user),
        workspaceId: invitation.workspace.id,
        role: invitation.role,
      },
      accessToken: this.signToken({
        id: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion + 1,
        workspaceId: invitation.workspace.id,
        role: invitation.role,
      }),
      workspaceName: invitation.workspace.name,
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
        dashboardOnboardingSeenAt: true,
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
      dashboardOnboardingSeenAt: user.dashboardOnboardingSeenAt,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      currentPeriodEnd: user.currentPeriodEnd,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async markDashboardOnboardingSeen(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { dashboardOnboardingSeenAt: new Date() },
      select: { dashboardOnboardingSeenAt: true },
    });

    return {
      dashboardOnboardingSeenAt: user.dashboardOnboardingSeenAt,
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

  private bcryptRounds() {
    const configured = Number(process.env.BCRYPT_ROUNDS ?? 12);
    return Number.isInteger(configured) && configured >= 12 && configured <= 15
      ? configured
      : 12;
  }

  private hashVerificationToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private registrationAcceptedResponse() {
    return {
      success: true,
      message:
        'If the email can be registered, a verification link will be sent.',
    };
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

  private getDefaultWorkspaceName(user: {
    name: string | null;
    email: string;
  }) {
    const trimmedName = user.name?.trim();
    if (trimmedName) {
      return `${trimmedName} Workspace`;
    }

    const emailAlias = user.email.split('@')[0]?.trim();
    return emailAlias ? `${emailAlias} Workspace` : 'Workspace';
  }
}
