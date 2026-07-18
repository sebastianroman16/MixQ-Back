import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(DashboardService.name);
  private readonly overviewCache = new Map<
    string,
    {
      expiresAt: number;
      value: Awaited<ReturnType<DashboardService['buildOverview']>>;
    }
  >();
  private readonly analyticsCache = new Map<
    string,
    {
      expiresAt: number;
      value: Awaited<ReturnType<DashboardService['buildAnalytics']>>;
    }
  >();
  private readonly overviewTtlMs = Number(
    process.env.DASHBOARD_OVERVIEW_CACHE_TTL_MS ?? 15_000,
  );
  private readonly analyticsTtlMs = Number(
    process.env.DASHBOARD_ANALYTICS_CACHE_TTL_MS ?? 45_000,
  );
  private readonly cacheMaxEntries = Math.max(
    1,
    Number(process.env.DASHBOARD_CACHE_MAX_ENTRIES ?? 500),
  );

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
    const cached = this.getCached(this.overviewCache, workspaceId);
    if (cached) {
      return cached;
    }

    const payload = await this.buildOverview(workspaceId);
    this.setCached(
      this.overviewCache,
      workspaceId,
      payload,
      this.overviewTtlMs,
    );
    return payload;
  }

  private async buildOverview(workspaceId: string) {
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
    const cached = this.getCached(this.analyticsCache, workspaceId);
    if (cached) {
      return cached;
    }

    const payload = await this.buildAnalytics(workspaceId);
    this.setCached(
      this.analyticsCache,
      workspaceId,
      payload,
      this.analyticsTtlMs,
    );
    return payload;
  }

  private async buildAnalytics(workspaceId: string) {
    const profilingEnabled = process.env.PROFILE_DASHBOARD_ANALYTICS === '1';
    const startedAt = Date.now();

    const now = new Date();
    const trendStart = new Date(now);
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - 13);
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      statusAggregates,
      templateCounts,
      topServiceRows,
      metrics,
      createdByDay,
      sentByDay,
      acceptedByDay,
      monthSums,
      scatterRows,
    ] = await Promise.all([
      this.prisma.quote.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
        _sum: { total: true },
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
      this.countQuotesByDay(workspaceId, 'issuedAt', trendStart),
      this.countQuotesByDay(workspaceId, 'sentAt', trendStart),
      this.countQuotesByDay(workspaceId, 'acceptedAt', trendStart),
      this.sumQuoteTotalsByMonth(workspaceId, monthStart),
      this.prisma.quote.findMany({
        where: { workspaceId },
        orderBy: { issuedAt: 'desc' },
        take: 36,
        select: {
          issuedAt: true,
          status: true,
          total: true,
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
    ]);

    const byStatus = Object.values(QuoteStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<QuoteStatus, number>,
    );

    let totalQuotes = 0;
    let acceptedRevenue = 0;
    let measuredQuotes = 0;
    let acceptedQuotes = 0;
    let sentQuotes = 0;

    for (const entry of statusAggregates) {
      const count = entry._count._all;
      byStatus[entry.status] = count;
      totalQuotes += count;

      if (entry.status !== QuoteStatus.DRAFT) {
        measuredQuotes += count;
      }
      if (entry.status === QuoteStatus.ACCEPTED) {
        acceptedQuotes += count;
        acceptedRevenue = entry._sum.total
          ? new Prisma.Decimal(entry._sum.total).toNumber()
          : 0;
      }
      if (
        entry.status === QuoteStatus.SENT ||
        entry.status === QuoteStatus.VIEWED
      ) {
        sentQuotes += count;
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

    const templateNameById = new Map(
      templates.map((template) => [template.id, template.name]),
    );

    const topTemplates = templateCounts
      .map((entry) => ({
        name: entry.templateId
          ? (templateNameById.get(entry.templateId) ?? 'Plantilla sin nombre')
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

    const trendSeries: AnalyticsTrendPoint[] = [];
    for (let index = 13; index >= 0; index -= 1) {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - index);
      const key = this.dayKey(day);
      trendSeries.push({
        label: `${day.getDate()}/${day.getMonth() + 1}`,
        created: createdByDay.get(key) ?? 0,
        sent: sentByDay.get(key) ?? 0,
        accepted: acceptedByDay.get(key) ?? 0,
      });
    }

    const monthSeries: AnalyticsMonthPoint[] = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${monthDate.getFullYear()}-${String(
        monthDate.getMonth() + 1,
      ).padStart(2, '0')}`;
      const sums = monthSums.get(key);
      monthSeries.push({
        label: monthDate.toLocaleDateString('es-CL', { month: 'short' }),
        quoted: sums?.quoted ?? 0,
        accepted: sums?.accepted ?? 0,
      });
    }

    const scatter = [...scatterRows].reverse().map((quote) => ({
      issuedAt: quote.issuedAt.toISOString(),
      total: new Prisma.Decimal(quote.total).toNumber(),
      status: quote.status,
      itemsCount: quote._count.items,
    }));

    const payload = {
      totals: {
        totalQuotes,
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
      trendSeries,
      monthSeries,
      scatter,
    };

    if (profilingEnabled) {
      this.logger.log(
        JSON.stringify({
          event: 'dashboard_analytics_profile',
          workspaceId,
          quoteCount: totalQuotes,
          templateCountRows: templateCounts.length,
          topServiceRowsCount: topServiceRows.length,
          timingsMs: {
            total: Date.now() - startedAt,
          },
        }),
      );
    }

    return payload;
  }

  private getCached<T>(
    cache: Map<string, { expiresAt: number; value: T }>,
    key: string,
  ): T | null {
    const entry = cache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCached<T>(
    cache: Map<string, { expiresAt: number; value: T }>,
    key: string,
    value: T,
    ttlMs: number,
  ): void {
    if (ttlMs <= 0) {
      return;
    }
    if (!cache.has(key) && cache.size >= this.cacheMaxEntries) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
    cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  }

  private parseClientData(value: Prisma.JsonValue | null): { name?: string } {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {};
    }
    return value as { name?: string };
  }

  private async countQuotesByDay(
    workspaceId: string,
    column: 'issuedAt' | 'sentAt' | 'acceptedAt',
    from: Date,
  ): Promise<Map<string, number>> {
    const columnRef = Prisma.raw(`"${column}"`);
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; count: number }>
    >(Prisma.sql`
      SELECT to_char(date_trunc('day', ${columnRef}), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "Quote"
      WHERE "workspaceId" = ${workspaceId}
        AND ${columnRef} >= ${from}
      GROUP BY 1
    `);

    return new Map(rows.map((row) => [row.day, Number(row.count)]));
  }

  private async sumQuoteTotalsByMonth(
    workspaceId: string,
    from: Date,
  ): Promise<Map<string, { quoted: number; accepted: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; quoted: unknown; accepted: unknown }>
    >(Prisma.sql`
      SELECT to_char(date_trunc('month', "issuedAt"), 'YYYY-MM') AS month,
             COALESCE(SUM("total"), 0) AS quoted,
             COALESCE(SUM("total") FILTER (WHERE "status" = 'ACCEPTED'), 0) AS accepted
      FROM "Quote"
      WHERE "workspaceId" = ${workspaceId}
        AND "issuedAt" >= ${from}
      GROUP BY 1
    `);

    return new Map(
      rows.map((row) => [
        row.month,
        {
          quoted: Number(row.quoted),
          accepted: Number(row.accepted),
        },
      ]),
    );
  }

  private dayKey(value: Date): string {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }
}
