import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, QuoteStatus, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { AuthUser } from '../auth/types/auth-user';
import { InvitationMailService } from '../mail/invitation-mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateWorkspaceInvitationDto } from './dto/create-workspace-invitation.dto';
import { UpdateSellerGoalDto } from './dto/update-seller-goal.dto';
import { UpdateWorkspaceMemberRoleDto } from './dto/update-workspace-member-role.dto';

type MetricsRange = 'month' | 'quarter' | 'year';

const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  [WorkspaceRole.OWNER]: 'Dueno',
  [WorkspaceRole.ADMIN]: 'Administrador',
  [WorkspaceRole.EDITOR]: 'Editor',
  [WorkspaceRole.VIEWER]: 'Solo lectura',
};

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly invitationMailService: InvitationMailService,
  ) {}

  async getMe(user: AuthUser) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      include: {
        members: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        invitations: {
          where: {
            acceptedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            role: true,
            token: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const isManager =
      user.role === WorkspaceRole.OWNER || user.role === WorkspaceRole.ADMIN;

    return {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      myRole: user.role,
      members: workspace.members.map((member) => ({
        id: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        user: member.user,
      })),
      // Las invitaciones llevan el enlace de activacion, asi que solo las ven
      // los roles que pueden gestionarlas.
      invitations: isManager
        ? workspace.invitations.map(({ token, ...invitation }) => ({
            ...invitation,
            invitationUrl: this.buildInvitationUrl(token),
          }))
        : [],
    };
  }

  async listInvitations(user: AuthUser) {
    this.assertManagerRole(user.role);

    return this.prisma.workspaceInvitation.findMany({
      where: {
        workspaceId: user.workspaceId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createInvitation(user: AuthUser, dto: CreateWorkspaceInvitationDto) {
    this.assertManagerRole(user.role);

    if (dto.role === WorkspaceRole.OWNER && user.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    await this.subscriptionsService.assertCanAddWorkspaceMember(
      user.workspaceId,
    );

    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedName = dto.name.trim();
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 7);

    const existingMember = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId: user.workspaceId,
        user: {
          email: {
            equals: normalizedEmail,
            mode: 'insensitive',
          },
        },
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new BadRequestException('User is already a workspace member');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const temporaryPasswordHash = await bcrypt.hash(temporaryPassword, 10);

    const { invitation } = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          email: {
            equals: normalizedEmail,
            mode: 'insensitive',
          },
        },
        select: { id: true, mustChangePassword: true },
      });

      if (existingUser) {
        if (!existingUser.mustChangePassword) {
          // Un subperfil eliminado deja el User huerfano (sin membresias ni
          // workspace propio); se conserva para no borrar en cascada sus
          // cotizaciones, asi que aqui se permite re-invitarlo. Una cuenta
          // real siempre tiene membresia u workspace propio y no se toca.
          const [memberships, ownedWorkspaces] = await Promise.all([
            tx.workspaceMember.count({ where: { userId: existingUser.id } }),
            tx.workspace.count({ where: { ownerId: existingUser.id } }),
          ]);

          if (memberships > 0 || ownedWorkspaces > 0) {
            throw new BadRequestException(
              'Email already belongs to an active account',
            );
          }
        }

        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name: normalizedName,
            passwordHash: temporaryPasswordHash,
            mustChangePassword: true,
            workspaceId: null,
            tokenVersion: {
              increment: 1,
            },
          },
        });
      } else {
        await tx.user.create({
          data: {
            email: normalizedEmail,
            name: normalizedName,
            passwordHash: temporaryPasswordHash,
            mustChangePassword: true,
          },
        });
      }

      // Evita acumular invitaciones pendientes duplicadas para el mismo correo.
      await tx.workspaceInvitation.deleteMany({
        where: {
          workspaceId: user.workspaceId,
          email: normalizedEmail,
          acceptedAt: null,
        },
      });

      const invitation = await tx.workspaceInvitation.create({
        data: {
          workspaceId: user.workspaceId,
          email: normalizedEmail,
          role: dto.role,
          invitedByUserId: user.id,
          expiresAt,
          token: randomUUID(),
        },
      });

      return { invitation };
    });

    // No hay envio de email: el owner comparte el enlace y la contrasena
    // temporal por el canal que prefiera, asi que siempre se devuelven.
    return {
      ...invitation,
      invitationUrl: this.buildInvitationUrl(invitation.token),
      temporaryPassword,
    };
  }

  async regenerateInvitation(user: AuthUser, invitationId: string) {
    this.assertManagerRole(user.role);

    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: {
        id: invitationId,
        workspaceId: user.workspaceId,
        acceptedAt: null,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (
      invitation.role === WorkspaceRole.OWNER &&
      user.role !== WorkspaceRole.OWNER
    ) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    const invitedUser = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: invitation.email,
          mode: 'insensitive',
        },
      },
      select: { id: true, mustChangePassword: true, name: true },
    });

    if (!invitedUser || !invitedUser.mustChangePassword) {
      throw new BadRequestException(
        'Invitation can no longer be regenerated for this email',
      );
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const temporaryPasswordHash = await bcrypt.hash(temporaryPassword, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: invitedUser.id },
        data: {
          passwordHash: temporaryPasswordHash,
          mustChangePassword: true,
          tokenVersion: {
            increment: 1,
          },
        },
      });

      return tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: {
          token: randomUUID(),
          expiresAt,
        },
      });
    });

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { name: true },
    });

    // Reenvio: ademas de regenerar el acceso, intentamos enviar el correo.
    // Si Resend no esta configurado, el metodo devuelve SKIPPED y el owner
    // sigue pudiendo compartir el enlace/clave manualmente (se devuelven igual).
    const email = await this.invitationMailService.sendWorkspaceInvitationEmail({
      to: invitation.email,
      invitedUserName: invitedUser.name ?? invitation.email,
      workspaceName: workspace?.name ?? 'tu equipo',
      invitedByName: null,
      roleLabel: WORKSPACE_ROLE_LABELS[invitation.role],
      token: updated.token,
      temporaryPassword,
    });

    return {
      ...updated,
      invitationUrl: this.buildInvitationUrl(updated.token),
      temporaryPassword,
      emailDelivery: email,
    };
  }

  async revokeInvitation(user: AuthUser, invitationId: string) {
    this.assertManagerRole(user.role);

    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: {
        id: invitationId,
        workspaceId: user.workspaceId,
        acceptedAt: null,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (
      invitation.role === WorkspaceRole.OWNER &&
      user.role !== WorkspaceRole.OWNER
    ) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    await this.prisma.workspaceInvitation.delete({
      where: { id: invitation.id },
    });

    return { success: true };
  }

  /**
   * Registro de actividad del equipo (solo BUSINESS). Se deriva de los
   * timestamps que ya guarda cada cotizacion (creada / enviada / vista /
   * aceptada / rechazada / anulada) junto con el vendedor responsable.
   * No hay tabla de auditoria: para un historial con cada edicion habria que
   * agregar una tabla de eventos dedicada.
   */
  async getActivity(user: AuthUser, limit = 50) {
    this.assertManagerRole(user.role);
    await this.subscriptionsService.assertCanUseAdvancedMetrics(
      user.workspaceId,
    );

    const quotes = await this.prisma.quote.findMany({
      where: {
        workspaceId: user.workspaceId,
        userId: { not: user.id },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        quoteNumber: true,
        title: true,
        total: true,
        clientData: true,
        createdAt: true,
        sentAt: true,
        viewedAt: true,
        acceptedAt: true,
        rejectedAt: true,
        cancelledAt: true,
        user: { select: { id: true, name: true } },
      },
    });

    type ActivityType =
      | 'created'
      | 'sent'
      | 'viewed'
      | 'accepted'
      | 'rejected'
      | 'cancelled';

    const events: Array<{
      type: ActivityType;
      at: Date;
      quoteId: string;
      quoteNumber: string;
      quoteTitle: string;
      total: number;
      sellerId: string | null;
      sellerName: string | null;
      clientName: string | null;
    }> = [];

    for (const quote of quotes) {
      const base = {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        quoteTitle: quote.title,
        total: new Prisma.Decimal(quote.total).toNumber(),
        sellerId: quote.user?.id ?? null,
        sellerName: quote.user?.name ?? null,
        clientName: this.extractClientName(quote.clientData),
      };

      const stamps: Array<[ActivityType, Date | null]> = [
        ['created', quote.createdAt],
        ['sent', quote.sentAt],
        ['viewed', quote.viewedAt],
        ['accepted', quote.acceptedAt],
        ['rejected', quote.rejectedAt],
        ['cancelled', quote.cancelledAt],
      ];

      for (const [type, at] of stamps) {
        if (at) {
          events.push({ type, at, ...base });
        }
      }
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      items: events.slice(0, limit).map((event) => ({
        ...event,
        at: event.at.toISOString(),
      })),
    };
  }

  private extractClientName(data: Prisma.JsonValue): string | null {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const name = (data as Record<string, unknown>)['name'];
      return typeof name === 'string' ? name : null;
    }
    return null;
  }

  private generateTemporaryPassword() {
    return `Qm!${randomBytes(6).toString('base64url')}`;
  }

  private buildInvitationUrl(token: string) {
    const frontendBaseUrl =
      process.env.FRONTEND_URL?.replace(/\/+$/, '') ?? 'http://localhost:4200';
    return `${frontendBaseUrl}/invitacion/${token}`;
  }

  async acceptInvitation(user: AuthUser, token: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token },
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

    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    await this.subscriptionsService.assertCanAddWorkspaceMember(
      invitation.workspaceId,
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
          workspaceId: invitation.workspaceId,
        },
      });
    });

    return {
      success: true,
      workspaceId: invitation.workspace.id,
      workspaceName: invitation.workspace.name,
    };
  }

  async updateMemberRole(
    user: AuthUser,
    memberId: string,
    dto: UpdateWorkspaceMemberRoleDto,
  ) {
    this.assertManagerRole(user.role);

    const member = await this.prisma.workspaceMember.findFirst({
      where: {
        id: memberId,
        workspaceId: user.workspaceId,
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const nextRole = dto.role ?? member.role;
    const nextName = dto.name?.trim();

    if (member.role === WorkspaceRole.OWNER && nextRole !== WorkspaceRole.OWNER) {
      await this.assertMoreThanOneOwner(user.workspaceId, member.id);
    }

    if (nextRole === WorkspaceRole.OWNER && user.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    return this.prisma.$transaction(async (tx) => {
      if (nextName) {
        await tx.user.update({
          where: { id: member.userId },
          data: { name: nextName },
        });
      }

      return tx.workspaceMember.update({
        where: { id: member.id },
        data: { role: nextRole },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
    });
  }

  async removeMember(user: AuthUser, memberId: string) {
    this.assertManagerRole(user.role);

    const member = await this.prisma.workspaceMember.findFirst({
      where: {
        id: memberId,
        workspaceId: user.workspaceId,
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    if (member.userId === user.id && member.role === WorkspaceRole.OWNER) {
      await this.assertMoreThanOneOwner(user.workspaceId, member.id);
    }

    if (member.role === WorkspaceRole.OWNER) {
      await this.assertMoreThanOneOwner(user.workspaceId, member.id);
    }

    const [deleted] = await this.prisma.$transaction([
      this.prisma.workspaceMember.delete({ where: { id: member.id } }),
      // Si la sesion del usuario seguia apuntando a este workspace, se
      // desvincula y se invalidan sus tokens; si no, su proximo login lo
      // volveria a agregar como miembro via ensureWorkspaceForUser.
      this.prisma.user.updateMany({
        where: { id: member.userId, workspaceId: member.workspaceId },
        data: {
          workspaceId: null,
          tokenVersion: { increment: 1 },
        },
      }),
    ]);

    return deleted;
  }

  async getMembersMetrics(user: AuthUser, range: MetricsRange = 'month') {
    this.assertManagerRole(user.role);

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: user.workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!members.length) {
      return { items: [] };
    }

    const memberUserIds = members.map((member) => member.userId);
    const now = new Date();
    const start = this.getRangeStart(range, now);
    const staleDraftDate = new Date(now);
    staleDraftDate.setDate(staleDraftDate.getDate() - 7);

    const quotes = await this.prisma.quote.findMany({
      where: {
        workspaceId: user.workspaceId,
        createdAt: {
          gte: start,
          lte: now,
        },
      },
      select: {
        userId: true,
        status: true,
        createdAt: true,
        validUntil: true,
        statusHistory: {
          where: {
            fromStatus: null,
            toStatus: QuoteStatus.DRAFT,
          },
          orderBy: { changedAt: 'asc' },
          take: 1,
          select: { changedBy: true },
        },
      },
    });

    const metricsByUserId = new Map<
      string,
      {
        created: number;
        accepted: number;
        rejected: number;
        cancelled: number;
        staleDraft: number;
        pendingAfterSend: number;
      }
    >(
      memberUserIds.map((userId) => [
        userId,
        {
          created: 0,
          accepted: 0,
          rejected: 0,
          cancelled: 0,
          staleDraft: 0,
          pendingAfterSend: 0,
        },
      ]),
    );

    for (const quote of quotes) {
      const creatorId = quote.statusHistory[0]?.changedBy ?? quote.userId;
      const metrics = metricsByUserId.get(creatorId);
      if (!metrics) {
        continue;
      }

      metrics.created += 1;

      if (quote.status === QuoteStatus.ACCEPTED) {
        metrics.accepted += 1;
      }
      if (quote.status === QuoteStatus.REJECTED) {
        metrics.rejected += 1;
      }
      if (quote.status === QuoteStatus.CANCELLED) {
        metrics.cancelled += 1;
      }
      if (
        quote.status === QuoteStatus.DRAFT &&
        quote.createdAt <= staleDraftDate
      ) {
        metrics.staleDraft += 1;
      }
      if (
        (quote.status === QuoteStatus.SENT ||
          quote.status === QuoteStatus.VIEWED) &&
        quote.validUntil < now
      ) {
        metrics.pendingAfterSend += 1;
      }
    }

    return {
      items: members.map((member) => {
        const metrics = metricsByUserId.get(member.userId);
        const created = metrics?.created ?? 0;
        const accepted = metrics?.accepted ?? 0;
        const rejected = metrics?.rejected ?? 0;
        const cancelled = metrics?.cancelled ?? 0;
        const staleDraft = metrics?.staleDraft ?? 0;
        const pendingAfterSend = metrics?.pendingAfterSend ?? 0;
        const noOutcome = cancelled + staleDraft + pendingAfterSend;

        return {
          member: {
            userId: member.user.id,
            name: member.user.name,
            email: member.user.email,
            role: member.role,
          },
          range,
          from: start.toISOString(),
          to: now.toISOString(),
          totals: {
            created,
            accepted,
            rejected,
            noOutcome,
          },
          breakdown: {
            cancelled,
            staleDraft,
            pendingAfterSend,
          },
          rates: {
            acceptedRate: created > 0 ? accepted / created : 0,
            rejectedRate: created > 0 ? rejected / created : 0,
            noOutcomeRate: created > 0 ? noOutcome / created : 0,
          },
        };
      }),
    };
  }

  async updateSellerGoal(
    user: AuthUser,
    memberId: string,
    dto: UpdateSellerGoalDto,
  ) {
    if (user.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: user.workspaceId },
      select: { userId: true },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const periodStart = this.parseGoalMonth(dto.month);
    const acceptanceRateTarget =
      dto.acceptanceRateTarget !== undefined
        ? Math.min(Math.max(dto.acceptanceRateTarget, 0), 100) / 100
        : undefined;

    const goal = await this.prisma.sellerGoal.upsert({
      where: {
        workspaceId_userId_periodStart: {
          workspaceId: user.workspaceId,
          userId: member.userId,
          periodStart,
        },
      },
      create: {
        workspaceId: user.workspaceId,
        userId: member.userId,
        periodStart,
        quotesCreatedTarget: dto.quotesCreatedTarget ?? 0,
        acceptedQuotesTarget: dto.acceptedQuotesTarget ?? 0,
        paidRevenueTarget: new Prisma.Decimal(dto.paidRevenueTarget ?? 0),
        acceptanceRateTarget: new Prisma.Decimal(acceptanceRateTarget ?? 0),
      },
      update: {
        quotesCreatedTarget: dto.quotesCreatedTarget,
        acceptedQuotesTarget: dto.acceptedQuotesTarget,
        paidRevenueTarget:
          dto.paidRevenueTarget !== undefined
            ? new Prisma.Decimal(dto.paidRevenueTarget)
            : undefined,
        acceptanceRateTarget:
          acceptanceRateTarget !== undefined
            ? new Prisma.Decimal(acceptanceRateTarget)
            : undefined,
      },
    });

    return {
      userId: goal.userId,
      memberId,
      periodStart: goal.periodStart.toISOString(),
      month: this.monthKey(goal.periodStart),
      quotesCreatedTarget: goal.quotesCreatedTarget,
      acceptedQuotesTarget: goal.acceptedQuotesTarget,
      paidRevenueTarget: new Prisma.Decimal(goal.paidRevenueTarget).toNumber(),
      acceptanceRateTarget: new Prisma.Decimal(
        goal.acceptanceRateTarget,
      ).toNumber(),
    };
  }

  async getAdvancedMetrics(user: AuthUser, range: MetricsRange = 'month') {
    if (user.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }
    await this.subscriptionsService.assertCanUseAdvancedMetrics(
      user.workspaceId,
    );
    const profilingEnabled = process.env.PROFILE_WORKSPACE_METRICS === '1';
    const startedAt = Date.now();

    const now = new Date();
    const start = this.getRangeStart(range, now);

    const quotesStartedAt = Date.now();
    const quotes = await this.prisma.quote.findMany({
      where: {
        workspaceId: user.workspaceId,
        createdAt: {
          gte: start,
          lte: now,
        },
      },
      select: {
        id: true,
        userId: true,
        status: true,
        paymentStatus: true,
        total: true,
        createdAt: true,
        issuedAt: true,
        sentAt: true,
        acceptedAt: true,
        rejectedAt: true,
        cancelledAt: true,
        validUntil: true,
        statusHistory: {
          where: {
            fromStatus: null,
            toStatus: QuoteStatus.DRAFT,
          },
          orderBy: { changedAt: 'asc' },
          take: 1,
          select: { changedBy: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const quotesQueryMs = Date.now() - quotesStartedAt;

    const membersStartedAt = Date.now();
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: user.workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    const membersQueryMs = Date.now() - membersStartedAt;
    const currentGoalPeriod = this.startOfMonth(now);
    const goalRangeStart = this.startOfMonth(start);
    const goals = await this.prisma.sellerGoal.findMany({
      where: {
        workspaceId: user.workspaceId,
        userId: { in: members.map((member) => member.userId) },
        periodStart: {
          gte: goalRangeStart,
          lte: currentGoalPeriod,
        },
      },
    });
    const goalsByUserId = new Map<
      string,
      {
        quotesCreatedTarget: number;
        acceptedQuotesTarget: number;
        paidRevenueTarget: number;
        acceptanceRateTarget: number;
        acceptanceRateEntries: number;
      }
    >();

    for (const goal of goals) {
      const entry =
        goalsByUserId.get(goal.userId) ??
        {
          quotesCreatedTarget: 0,
          acceptedQuotesTarget: 0,
          paidRevenueTarget: 0,
          acceptanceRateTarget: 0,
          acceptanceRateEntries: 0,
        };
      entry.quotesCreatedTarget += goal.quotesCreatedTarget;
      entry.acceptedQuotesTarget += goal.acceptedQuotesTarget;
      entry.paidRevenueTarget += new Prisma.Decimal(
        goal.paidRevenueTarget,
      ).toNumber();
      const targetRate = new Prisma.Decimal(
        goal.acceptanceRateTarget,
      ).toNumber();
      if (targetRate > 0) {
        entry.acceptanceRateTarget += targetRate;
        entry.acceptanceRateEntries += 1;
      }
      goalsByUserId.set(goal.userId, entry);
    }
    const currentGoalByUserId = new Map(
      goals
        .filter(
          (goal) =>
            goal.periodStart.getTime() === currentGoalPeriod.getTime(),
        )
        .map((goal) => [goal.userId, goal]),
    );
    const computeStartedAt = Date.now();

    const funnel = {
      draft: 0,
      sent: 0,
      viewed: 0,
      accepted: 0,
      rejected: 0,
      cancelled: 0,
    };

    const createdToSentHours: number[] = [];
    const createdToAcceptedHours: number[] = [];
    const createdToRejectedHours: number[] = [];

    const bySeller = new Map<
      string,
      {
        userId: string;
        memberId: string;
        name: string;
        email: string;
        role: WorkspaceRole;
        createdCount: number;
        draftCount: number;
        sentCount: number;
        viewedCount: number;
        acceptedCount: number;
        rejectedCount: number;
        cancelledCount: number;
        noOutcomeCount: number;
        paidCount: number;
        pendingPaymentCount: number;
        quotedRevenue: number;
        acceptedRevenue: number;
        paidRevenue: number;
      }
    >();

    for (const member of members) {
      bySeller.set(member.userId, {
        userId: member.userId,
        memberId: member.id,
        name: member.user.name ?? 'Sin nombre',
        email: member.user.email,
        role: member.role,
        createdCount: 0,
        draftCount: 0,
        sentCount: 0,
        viewedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        cancelledCount: 0,
        noOutcomeCount: 0,
        paidCount: 0,
        pendingPaymentCount: 0,
        quotedRevenue: 0,
        acceptedRevenue: 0,
        paidRevenue: 0,
      });
    }

    const isNoOutcome = (quote: (typeof quotes)[number]) => {
      const expiredOpen =
        (quote.status === QuoteStatus.SENT ||
          quote.status === QuoteStatus.VIEWED) &&
        quote.validUntil < now;
      return (
        quote.status === QuoteStatus.CANCELLED ||
        quote.status === QuoteStatus.DRAFT ||
        expiredOpen
      );
    };

    for (const quote of quotes) {
      const creatorId = quote.statusHistory[0]?.changedBy ?? quote.userId;
      const seller = bySeller.get(creatorId);
      const total = new Prisma.Decimal(quote.total).toNumber();

      switch (quote.status) {
        case QuoteStatus.DRAFT:
          funnel.draft += 1;
          break;
        case QuoteStatus.SENT:
          funnel.sent += 1;
          break;
        case QuoteStatus.VIEWED:
          funnel.viewed += 1;
          break;
        case QuoteStatus.ACCEPTED:
          funnel.accepted += 1;
          break;
        case QuoteStatus.REJECTED:
          funnel.rejected += 1;
          break;
        case QuoteStatus.CANCELLED:
          funnel.cancelled += 1;
          break;
      }

      if (quote.sentAt) {
        createdToSentHours.push(
          this.hoursBetween(quote.createdAt, quote.sentAt),
        );
      }
      if (quote.acceptedAt) {
        createdToAcceptedHours.push(
          this.hoursBetween(quote.createdAt, quote.acceptedAt),
        );
      }
      if (quote.rejectedAt) {
        createdToRejectedHours.push(
          this.hoursBetween(quote.createdAt, quote.rejectedAt),
        );
      }

      if (seller) {
        seller.createdCount += 1;
        switch (quote.status) {
          case QuoteStatus.DRAFT:
            seller.draftCount += 1;
            break;
          case QuoteStatus.SENT:
            seller.sentCount += 1;
            break;
          case QuoteStatus.VIEWED:
            seller.viewedCount += 1;
            break;
          case QuoteStatus.ACCEPTED:
            seller.acceptedCount += 1;
            seller.acceptedRevenue += total;
            break;
          case QuoteStatus.REJECTED:
            seller.rejectedCount += 1;
            break;
          case QuoteStatus.CANCELLED:
            seller.cancelledCount += 1;
            break;
        }
        if (isNoOutcome(quote)) {
          seller.noOutcomeCount += 1;
        }
        if (quote.paymentStatus === PaymentStatus.PAID) {
          seller.paidCount += 1;
          seller.paidRevenue += total;
        } else {
          seller.pendingPaymentCount += 1;
        }
        seller.quotedRevenue += total;
      }
    }

    const trends = this.buildMonthlyTrend(quotes, range, now);

    const openWeightedForecast = quotes.reduce((acc, quote) => {
      const total = new Prisma.Decimal(quote.total).toNumber();
      if (quote.status === QuoteStatus.DRAFT) {
        return acc + total * 0.2;
      }
      if (quote.status === QuoteStatus.SENT) {
        return acc + total * 0.45;
      }
      if (quote.status === QuoteStatus.VIEWED) {
        return acc + total * 0.7;
      }
      return acc;
    }, 0);

    const totals = {
      quotesCreated: quotes.length,
      quotesAccepted: funnel.accepted,
      quotesRejected: funnel.rejected,
      quotesNoOutcome: quotes.filter(isNoOutcome).length,
      quotedRevenue: quotes.reduce(
        (acc, quote) => acc + new Prisma.Decimal(quote.total).toNumber(),
        0,
      ),
      acceptedRevenue: quotes
        .filter((quote) => quote.status === QuoteStatus.ACCEPTED)
        .reduce(
          (acc, quote) => acc + new Prisma.Decimal(quote.total).toNumber(),
          0,
        ),
    };

    const payload = {
      range,
      from: start.toISOString(),
      to: now.toISOString(),
      funnel,
      cycleTimes: {
        avgCreatedToSentHours: this.average(createdToSentHours),
        avgCreatedToAcceptedHours: this.average(createdToAcceptedHours),
        avgCreatedToRejectedHours: this.average(createdToRejectedHours),
        p50CreatedToAcceptedHours: this.percentile(createdToAcceptedHours, 50),
        p90CreatedToAcceptedHours: this.percentile(createdToAcceptedHours, 90),
      },
      totals,
      revenueBySeller: Array.from(bySeller.values())
        .map((seller) => {
          const acceptanceRate =
            seller.createdCount > 0
              ? seller.acceptedCount / seller.createdCount
              : 0;
          const rawGoals = goalsByUserId.get(seller.userId);
          const currentGoal = currentGoalByUserId.get(seller.userId);
          const goals = {
            periodStart: currentGoalPeriod.toISOString(),
            month: this.monthKey(currentGoalPeriod),
            quotesCreatedTarget: rawGoals?.quotesCreatedTarget ?? 0,
            acceptedQuotesTarget: rawGoals?.acceptedQuotesTarget ?? 0,
            paidRevenueTarget: rawGoals?.paidRevenueTarget ?? 0,
            acceptanceRateTarget:
              rawGoals && rawGoals.acceptanceRateEntries > 0
                ? rawGoals.acceptanceRateTarget /
                  rawGoals.acceptanceRateEntries
                : 0,
          };

          return {
            ...seller,
            acceptanceRate,
            goals,
            currentMonthGoal: {
              periodStart: currentGoalPeriod.toISOString(),
              month: this.monthKey(currentGoalPeriod),
              quotesCreatedTarget: currentGoal?.quotesCreatedTarget ?? 0,
              acceptedQuotesTarget: currentGoal?.acceptedQuotesTarget ?? 0,
              paidRevenueTarget: currentGoal
                ? new Prisma.Decimal(currentGoal.paidRevenueTarget).toNumber()
                : 0,
              acceptanceRateTarget: currentGoal
                ? new Prisma.Decimal(
                    currentGoal.acceptanceRateTarget,
                  ).toNumber()
                : 0,
            },
            goalProgress: {
              quotesCreated: this.progressRatio(
                seller.createdCount,
                goals.quotesCreatedTarget,
              ),
              acceptedQuotes: this.progressRatio(
                seller.acceptedCount,
                goals.acceptedQuotesTarget,
              ),
              paidRevenue: this.progressRatio(
                seller.paidRevenue,
                goals.paidRevenueTarget,
              ),
              acceptanceRate: this.progressRatio(
                acceptanceRate,
                goals.acceptanceRateTarget,
              ),
            },
          };
        })
        .sort((a, b) => b.acceptedRevenue - a.acceptedRevenue),
      trends,
      forecast: {
        openWeightedForecast,
        forecastCoverageRatio:
          totals.quotedRevenue > 0
            ? openWeightedForecast / totals.quotedRevenue
            : 0,
      },
    };

    if (profilingEnabled) {
      this.logger.log(
        JSON.stringify({
          event: 'workspace_metrics_advanced_profile',
          workspaceId: user.workspaceId,
          range,
          quoteCount: quotes.length,
          memberCount: members.length,
          timingsMs: {
            quotesQuery: quotesQueryMs,
            membersQuery: membersQueryMs,
            compute: Date.now() - computeStartedAt,
            total: Date.now() - startedAt,
          },
        }),
      );
    }

    return payload;
  }

  private buildMonthlyTrend(
    quotes: Array<{
      createdAt: Date;
      status: QuoteStatus;
      total: Prisma.Decimal;
    }>,
    range: MetricsRange,
    now: Date,
  ) {
    const monthsToInclude = range === 'year' ? 12 : range === 'quarter' ? 6 : 4;
    const buckets: Array<{
      month: string;
      created: number;
      accepted: number;
      rejected: number;
      quotedRevenue: number;
      acceptedRevenue: number;
    }> = [];

    for (let index = monthsToInclude - 1; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      buckets.push({
        month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        created: 0,
        accepted: 0,
        rejected: 0,
        quotedRevenue: 0,
        acceptedRevenue: 0,
      });
    }

    for (const quote of quotes) {
      const bucketKey = `${quote.createdAt.getFullYear()}-${String(quote.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.find((entry) => entry.month === bucketKey);
      if (!bucket) {
        continue;
      }

      const total = new Prisma.Decimal(quote.total).toNumber();
      bucket.created += 1;
      bucket.quotedRevenue += total;

      if (quote.status === QuoteStatus.ACCEPTED) {
        bucket.accepted += 1;
        bucket.acceptedRevenue += total;
      }

      if (quote.status === QuoteStatus.REJECTED) {
        bucket.rejected += 1;
      }
    }

    return buckets;
  }

  private hoursBetween(start: Date, end: Date): number {
    const ms = end.getTime() - start.getTime();
    return ms > 0 ? ms / 3_600_000 : 0;
  }

  private startOfMonth(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), 1);
  }

  private monthKey(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }

  private parseGoalMonth(month?: string): Date {
    if (!month) {
      return this.startOfMonth(new Date());
    }

    const [year, rawMonth] = month.split('-').map((value) => Number(value));
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(rawMonth) ||
      rawMonth < 1 ||
      rawMonth > 12
    ) {
      throw new BadRequestException('Mes de objetivo invalido.');
    }

    return new Date(year, rawMonth - 1, 1);
  }

  private progressRatio(current: number, target: number): number {
    if (!Number.isFinite(target) || target <= 0) {
      return 0;
    }
    return Math.min(current / target, 1);
  }

  private average(values: number[]): number {
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private percentile(values: number[], percentile: number): number {
    if (!values.length) {
      return 0;
    }

    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round((percentile / 100) * (sorted.length - 1))),
    );
    return sorted[index];
  }

  private getRangeStart(range: MetricsRange, now: Date): Date {
    const date = new Date(now);
    if (range === 'year') {
      date.setFullYear(date.getFullYear() - 1);
      return date;
    }
    if (range === 'quarter') {
      date.setMonth(date.getMonth() - 3);
      return date;
    }
    date.setMonth(date.getMonth() - 1);
    return date;
  }

  private async assertMoreThanOneOwner(
    workspaceId: string,
    excludingMemberId: string,
  ) {
    const ownerCount = await this.prisma.workspaceMember.count({
      where: {
        workspaceId,
        role: WorkspaceRole.OWNER,
        NOT: { id: excludingMemberId },
      },
    });

    if (ownerCount < 1) {
      throw new BadRequestException('Workspace must keep at least one owner');
    }
  }

  private assertManagerRole(role: WorkspaceRole) {
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }
  }
}
