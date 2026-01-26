import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(userId: string) {
    const [total, grouped] = await Promise.all([
      this.prisma.quote.count({ where: { userId } }),
      this.prisma.quote.groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      }),
    ]);

    const byStatus = Object.values(QuoteStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<QuoteStatus, number>,
    );

    for (const entry of grouped) {
      byStatus[entry.status] = entry._count.status;
    }

    return { total, byStatus };
  }

  async getMetrics(userId: string, range: 'month') {
    if (range !== 'month') {
      throw new BadRequestException('Unsupported range');
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalQuotedAgg, totalAcceptedAgg] = await Promise.all([
      this.prisma.quote.aggregate({
        where: {
          userId,
          issuedAt: { gte: start, lte: now },
        },
        _sum: { total: true },
      }),
      this.prisma.quote.aggregate({
        where: {
          userId,
          status: QuoteStatus.ACCEPTED,
          issuedAt: { gte: start, lte: now },
        },
        _sum: { total: true },
      }),
    ]);

    const totalQuoted = totalQuotedAgg._sum.total
      ? new Prisma.Decimal(totalQuotedAgg._sum.total).toNumber()
      : 0;
    const totalAccepted = totalAcceptedAgg._sum.total
      ? new Prisma.Decimal(totalAcceptedAgg._sum.total).toNumber()
      : 0;

    const conversionRate =
      totalQuoted > 0 ? totalAccepted / totalQuoted : 0;

    return { range, totalQuoted, totalAccepted, conversionRate };
  }

  async getRecent(userId: string, limit: number) {
    const safeLimit = Math.min(Math.max(limit || 5, 1), 20);
    const items = await this.prisma.quote.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        title: true,
        status: true,
        quoteNumber: true,
        issuedAt: true,
      },
    });

    return {
      items: items.map((item) => ({
        ...item,
        issuedAt: item.issuedAt.toISOString().slice(0, 10),
      })),
    };
  }

  async getAlerts(userId: string) {
    const now = new Date();
    const expiringLimit = new Date(now);
    expiringLimit.setDate(expiringLimit.getDate() + 3);
    const overdueLimit = new Date(now);
    overdueLimit.setDate(overdueLimit.getDate() - 7);

    const [expiringSoon, pendingOverdue] = await Promise.all([
      this.prisma.quote.count({
        where: {
          userId,
          validUntil: { gte: now, lte: expiringLimit },
        },
      }),
      this.prisma.quote.count({
        where: {
          userId,
          status: QuoteStatus.SENT,
          issuedAt: { lte: overdueLimit },
        },
      }),
    ]);

    return { expiringSoon, pendingOverdue };
  }
}
