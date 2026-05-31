import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuoteStatus, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { AuthUser } from '../auth/types/auth-user';
import { InvitationMailService } from '../mail/invitation-mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateWorkspaceInvitationDto } from './dto/create-workspace-invitation.dto';
import { UpdateWorkspaceMemberRoleDto } from './dto/update-workspace-member-role.dto';

type MetricsRange = 'month' | 'quarter' | 'year';

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
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

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
      invitations: workspace.invitations,
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
    const [workspace, inviter] = await Promise.all([
      this.prisma.workspace.findUnique({
        where: { id: user.workspaceId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true, email: true },
      }),
    ]);

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

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
          throw new BadRequestException(
            'Email already belongs to an active account',
          );
        }

        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name: normalizedName,
            passwordHash: temporaryPasswordHash,
            mustChangePassword: true,
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

    const emailDelivery =
      await this.invitationMailService.sendWorkspaceInvitationEmail({
        to: normalizedEmail,
        invitedUserName: normalizedName,
        workspaceName: workspace.name,
        invitedByName: inviter?.name ?? inviter?.email ?? null,
        roleLabel: dto.role,
        token: invitation.token,
        temporaryPassword,
      });

    const response: Record<string, unknown> = {
      ...invitation,
      invitationUrl: this.buildInvitationUrl(invitation.token),
      emailDelivery,
    };

    if (process.env.NODE_ENV !== 'production') {
      response.temporaryPassword = temporaryPassword;
    }

    return response;
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

    if (
      member.role === WorkspaceRole.OWNER &&
      dto.role !== WorkspaceRole.OWNER
    ) {
      await this.assertMoreThanOneOwner(user.workspaceId, member.id);
    }

    if (dto.role === WorkspaceRole.OWNER && user.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    return this.prisma.workspaceMember.update({
      where: { id: member.id },
      data: { role: dto.role },
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

    return this.prisma.workspaceMember.delete({ where: { id: member.id } });
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

    const baseWhere = {
      workspaceId: user.workspaceId,
      userId: { in: memberUserIds },
      issuedAt: {
        gte: start,
        lte: now,
      },
    };

    const [
      createdCounts,
      statusCounts,
      staleDraftCounts,
      pendingAfterSendCounts,
    ] = await Promise.all([
      this.prisma.quote.groupBy({
        by: ['userId'],
        where: baseWhere,
        _count: { userId: true },
      }),
      this.prisma.quote.groupBy({
        by: ['userId', 'status'],
        where: baseWhere,
        _count: { status: true },
      }),
      this.prisma.quote.groupBy({
        by: ['userId'],
        where: {
          ...baseWhere,
          status: QuoteStatus.DRAFT,
          createdAt: { lte: staleDraftDate },
        },
        _count: { userId: true },
      }),
      this.prisma.quote.groupBy({
        by: ['userId'],
        where: {
          ...baseWhere,
          status: { in: [QuoteStatus.SENT, QuoteStatus.VIEWED] },
          validUntil: { lt: now },
        },
        _count: { userId: true },
      }),
    ]);

    const createdByUserId = new Map(
      createdCounts.map((entry) => [entry.userId, entry._count.userId]),
    );
    const statusByUserIdAndStatus = new Map(
      statusCounts.map((entry) => [
        `${entry.userId}:${entry.status}`,
        entry._count.status,
      ]),
    );
    const staleDraftByUserId = new Map(
      staleDraftCounts.map((entry) => [entry.userId, entry._count.userId]),
    );
    const pendingAfterSendByUserId = new Map(
      pendingAfterSendCounts.map((entry) => [
        entry.userId,
        entry._count.userId,
      ]),
    );

    return {
      items: members.map((member) => {
        const created = createdByUserId.get(member.userId) ?? 0;
        const accepted =
          statusByUserIdAndStatus.get(
            `${member.userId}:${QuoteStatus.ACCEPTED}`,
          ) ?? 0;
        const rejected =
          statusByUserIdAndStatus.get(
            `${member.userId}:${QuoteStatus.REJECTED}`,
          ) ?? 0;
        const cancelled =
          statusByUserIdAndStatus.get(
            `${member.userId}:${QuoteStatus.CANCELLED}`,
          ) ?? 0;
        const staleDraft = staleDraftByUserId.get(member.userId) ?? 0;
        const pendingAfterSend =
          pendingAfterSendByUserId.get(member.userId) ?? 0;
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

  async getAdvancedMetrics(user: AuthUser, range: MetricsRange = 'month') {
    this.assertManagerRole(user.role);
    const profilingEnabled = process.env.PROFILE_WORKSPACE_METRICS === '1';
    const startedAt = Date.now();

    const now = new Date();
    const start = this.getRangeStart(range, now);

    const quotesStartedAt = Date.now();
    const quotes = await this.prisma.quote.findMany({
      where: {
        workspaceId: user.workspaceId,
        issuedAt: {
          gte: start,
          lte: now,
        },
      },
      select: {
        id: true,
        userId: true,
        status: true,
        total: true,
        issuedAt: true,
        sentAt: true,
        acceptedAt: true,
        rejectedAt: true,
        cancelledAt: true,
        validUntil: true,
      },
      orderBy: { issuedAt: 'asc' },
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
        name: string;
        email: string;
        role: WorkspaceRole;
        createdCount: number;
        sentCount: number;
        acceptedCount: number;
        rejectedCount: number;
        noOutcomeCount: number;
        quotedRevenue: number;
        acceptedRevenue: number;
      }
    >();

    for (const member of members) {
      bySeller.set(member.userId, {
        userId: member.userId,
        name: member.user.name ?? 'Sin nombre',
        email: member.user.email,
        role: member.role,
        createdCount: 0,
        sentCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        noOutcomeCount: 0,
        quotedRevenue: 0,
        acceptedRevenue: 0,
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
      const seller = bySeller.get(quote.userId);
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
          this.hoursBetween(quote.issuedAt, quote.sentAt),
        );
      }
      if (quote.acceptedAt) {
        createdToAcceptedHours.push(
          this.hoursBetween(quote.issuedAt, quote.acceptedAt),
        );
      }
      if (quote.rejectedAt) {
        createdToRejectedHours.push(
          this.hoursBetween(quote.issuedAt, quote.rejectedAt),
        );
      }

      if (seller) {
        seller.createdCount += 1;
        if (
          quote.status === QuoteStatus.SENT ||
          quote.status === QuoteStatus.VIEWED
        ) {
          seller.sentCount += 1;
        }
        if (quote.status === QuoteStatus.ACCEPTED) {
          seller.acceptedCount += 1;
          seller.acceptedRevenue += total;
        }
        if (quote.status === QuoteStatus.REJECTED) {
          seller.rejectedCount += 1;
        }
        if (isNoOutcome(quote)) {
          seller.noOutcomeCount += 1;
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
        .map((seller) => ({
          ...seller,
          acceptanceRate:
            seller.createdCount > 0
              ? seller.acceptedCount / seller.createdCount
              : 0,
        }))
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
      issuedAt: Date;
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
      const bucketKey = `${quote.issuedAt.getFullYear()}-${String(quote.issuedAt.getMonth() + 1).padStart(2, '0')}`;
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
