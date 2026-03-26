import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DashboardSearchResult = {
  type: 'quote' | 'template' | 'service';
  id: string;
  label: string;
  hint: string;
};

type AnalyticsTrendPoint = {
  label: string;
  created: number;
  sent: number;
  accepted: number;
};

type AnalyticsMonthPoint = {
  label: string;
  quoted: number;
  accepted: number;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(workspaceId: string) {
    const [total, grouped] = await Promise.all([
      this.prisma.quote.count({ where: { workspaceId } }),
      this.prisma.quote.groupBy({
        by: ['status'],
        where: { workspaceId },
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

  async getMetrics(workspaceId: string, range: 'month') {
    if (range !== 'month') {
      throw new BadRequestException('Unsupported range');
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalQuotedAgg, totalAcceptedAgg] = await Promise.all([
      this.prisma.quote.aggregate({
        where: {
          workspaceId,
          status: { not: QuoteStatus.DRAFT },
          issuedAt: { gte: start, lte: now },
        },
        _sum: { total: true },
      }),
      this.prisma.quote.aggregate({
        where: {
          workspaceId,
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

    const conversionRate = totalQuoted > 0 ? totalAccepted / totalQuoted : 0;

    return { range, totalQuoted, totalAccepted, conversionRate };
  }

  async getRecent(workspaceId: string, limit: number) {
    const safeLimit = Math.min(Math.max(limit || 5, 1), 20);
    const items = await this.prisma.quote.findMany({
      where: { workspaceId },
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

  async getAlerts(workspaceId: string) {
    const now = new Date();
    const expiringLimit = new Date(now);
    expiringLimit.setDate(expiringLimit.getDate() + 3);
    const overdueLimit = new Date(now);
    overdueLimit.setDate(overdueLimit.getDate() - 7);

    const [expiringSoon, pendingOverdue] = await Promise.all([
      this.prisma.quote.count({
        where: {
          workspaceId,
          validUntil: { gte: now, lte: expiringLimit },
        },
      }),
      this.prisma.quote.count({
        where: {
          workspaceId,
          status: QuoteStatus.SENT,
          issuedAt: { lte: overdueLimit },
        },
      }),
    ]);

    return { expiringSoon, pendingOverdue };
  }

  async getOverview(workspaceId: string) {
    const [summary, metrics, recent, alerts] = await Promise.all([
      this.getSummary(workspaceId),
      this.getMetrics(workspaceId, 'month'),
      this.getRecent(workspaceId, 5),
      this.getAlerts(workspaceId),
    ]);

    return { summary, metrics, recent, alerts };
  }

  async search(workspaceId: string, query: string) {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return { items: [] as DashboardSearchResult[] };
    }

    const [quotes, templates, services] = await Promise.all([
      this.prisma.quote.findMany({
        where: {
          workspaceId,
          OR: [
            { title: { contains: normalizedQuery, mode: 'insensitive' } },
            { quoteNumber: { contains: normalizedQuery, mode: 'insensitive' } },
            {
              clientData: {
                path: ['name'],
                string_contains: normalizedQuery,
              },
            },
          ],
        },
        orderBy: { issuedAt: 'desc' },
        take: 4,
        select: {
          id: true,
          title: true,
          quoteNumber: true,
          clientData: true,
        },
      }),
      this.prisma.template.findMany({
        where: {
          OR: [
            { type: 'SYSTEM', userId: null },
            { type: 'USER', workspaceId },
          ],
          name: { contains: normalizedQuery, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          name: true,
        },
      }),
      this.prisma.service.findMany({
        where: {
          workspaceId,
          name: { contains: normalizedQuery, mode: 'insensitive' },
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    const items: DashboardSearchResult[] = [
      ...quotes.map((quote) => {
        const clientData = this.parseClientData(quote.clientData);
        const clientName = clientData.name?.trim();
        return {
          type: 'quote' as const,
          id: quote.id,
          label: quote.title,
          hint: clientName
            ? `Cotizacion ${quote.quoteNumber} · ${clientName}`
            : `Cotizacion ${quote.quoteNumber}`,
        };
      }),
      ...templates.map((template) => ({
        type: 'template' as const,
        id: template.id,
        label: template.name,
        hint: 'Diseño',
      })),
      ...services.map((service) => ({
        type: 'service' as const,
        id: service.id,
        label: service.name,
        hint: 'Servicio',
      })),
    ];

    return { items };
  }

  async getAnalytics(workspaceId: string) {
    const [quotes, templateCounts, topServiceRows, metrics] = await Promise.all([
      this.prisma.quote.findMany({
        where: { workspaceId },
        orderBy: { issuedAt: 'asc' },
        select: {
          templateId: true,
          status: true,
          total: true,
          issuedAt: true,
          sentAt: true,
          acceptedAt: true,
          rejectedAt: true,
          validUntil: true,
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
      this.prisma.quote.groupBy({
        by: ['templateId'],
        where: { workspaceId },
        _count: {
          templateId: true,
        },
      }),
      this.prisma.quoteItem.groupBy({
        by: ['title'],
        where: {
          quote: {
            workspaceId,
          },
        },
        _count: {
          title: true,
        },
      }),
      this.getMetrics(workspaceId, 'month'),
    ]);

    const byStatus = Object.values(QuoteStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<QuoteStatus, number>,
    );

    let acceptedRevenue = 0;
    let measuredQuotes = 0;
    let acceptedQuotes = 0;
    let sentQuotes = 0;

    for (const quote of quotes) {
      const total = new Prisma.Decimal(quote.total).toNumber();
      byStatus[quote.status] = (byStatus[quote.status] ?? 0) + 1;

      if (quote.status !== QuoteStatus.DRAFT) {
        measuredQuotes += 1;
      }
      if (quote.status === QuoteStatus.ACCEPTED) {
        acceptedQuotes += 1;
        acceptedRevenue += total;
      }
      if (quote.status === QuoteStatus.SENT || quote.status === QuoteStatus.VIEWED) {
        sentQuotes += 1;
      }
    }

    const templateIds = templateCounts
      .map((entry) => entry.templateId)
      .filter((id): id is string => !!id);

    const templates = templateIds.length
      ? await this.prisma.template.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, name: true },
        })
      : [];

    const templateNameById = new Map(templates.map((template) => [template.id, template.name]));

    const topTemplates = templateCounts
      .map((entry) => ({
        name: entry.templateId
          ? templateNameById.get(entry.templateId) ?? 'Plantilla sin nombre'
          : 'Plantilla sin nombre',
        value: entry._count.templateId,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const topServices = topServiceRows
      .map((entry) => ({
        name: entry.title.trim() || 'Servicio sin nombre',
        value: entry._count.title,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const scatter = quotes
      .slice(-36)
      .map((quote) => ({
        issuedAt: quote.issuedAt.toISOString(),
        total: new Prisma.Decimal(quote.total).toNumber(),
        status: quote.status,
        itemsCount: quote._count.items,
      }));

    return {
      totals: {
        totalQuotes: quotes.length,
        measuredQuotes,
        acceptedQuotes,
        sentQuotes,
        acceptedRevenue,
      },
      monthly: {
        totalQuoted: metrics.totalQuoted,
        totalAccepted: metrics.totalAccepted,
        conversionRate: metrics.conversionRate,
      },
      byStatus,
      topTemplates,
      topServices,
      trendSeries: this.buildLast14DaysAnalyticsSeries(quotes),
      monthSeries: this.buildLast6MonthsAnalyticsSeries(quotes),
      scatter,
    };
  }

  private parseClientData(value: Prisma.JsonValue | null): { name?: string } {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {};
    }
    return value as { name?: string };
  }

  private buildLast14DaysAnalyticsSeries(
    quotes: Array<{
      issuedAt: Date;
      sentAt: Date | null;
      acceptedAt: Date | null;
    }>,
  ): AnalyticsTrendPoint[] {
    const days: AnalyticsTrendPoint[] = [];
    const now = new Date();

    for (let index = 13; index >= 0; index -= 1) {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - index);
      const key = this.dayKey(day);
      days.push({
        label: `${day.getDate()}/${day.getMonth() + 1}`,
        created: this.countByDay(quotes, key, 'issuedAt'),
        sent: this.countByDay(quotes, key, 'sentAt'),
        accepted: this.countByDay(quotes, key, 'acceptedAt'),
      });
    }

    return days;
  }

  private buildLast6MonthsAnalyticsSeries(
    quotes: Array<{
      issuedAt: Date;
      status: QuoteStatus;
      total: Prisma.Decimal;
    }>,
  ): AnalyticsMonthPoint[] {
    const months: AnalyticsMonthPoint[] = [];
    const now = new Date();

    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();

      const monthQuotes = quotes.filter((quote) => {
        const issuedAt = new Date(quote.issuedAt);
        return issuedAt.getFullYear() === year && issuedAt.getMonth() === month;
      });

      months.push({
        label: monthDate.toLocaleDateString('es-CL', { month: 'short' }),
        quoted: monthQuotes.reduce((acc, quote) => acc + new Prisma.Decimal(quote.total).toNumber(), 0),
        accepted: monthQuotes
          .filter((quote) => quote.status === QuoteStatus.ACCEPTED)
          .reduce((acc, quote) => acc + new Prisma.Decimal(quote.total).toNumber(), 0),
      });
    }

    return months;
  }

  private countByDay(
    quotes: Array<Record<string, Date | null>>,
    key: string,
    field: string,
  ): number {
    return quotes.reduce((acc, quote) => {
      const raw = quote[field];
      if (!raw) {
        return acc;
      }
      return this.dayKey(raw) === key ? acc + 1 : acc;
    }, 0);
  }

  private dayKey(value: Date): string {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }
}
