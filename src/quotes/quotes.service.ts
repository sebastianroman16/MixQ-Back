import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentStatus,
  Prisma,
  QuoteStatus,
  TemplateType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { CreateQuoteFolderDto } from './dto/create-quote-folder.dto';
import { CreateQuoteItemDto } from './dto/create-quote-item.dto';
import { QuoteSummaryDto } from './dto/quote-summary.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { PdfRendererService } from './pdf/pdf-renderer.service';
import { renderQuotePdfHtml } from './pdf/quote-pdf.template';
import {
  calculateQuoteTotals,
  DISCOUNT_EXCEEDS_SUBTOTAL,
} from './utils/quote-totals';

const QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  [QuoteStatus.DRAFT]: [
    QuoteStatus.SENT,
    QuoteStatus.ACCEPTED,
    QuoteStatus.CANCELLED,
  ],
  [QuoteStatus.SENT]: [QuoteStatus.ACCEPTED, QuoteStatus.CANCELLED],
  [QuoteStatus.VIEWED]: [QuoteStatus.ACCEPTED, QuoteStatus.CANCELLED],
  [QuoteStatus.ACCEPTED]: [],
  [QuoteStatus.REJECTED]: [QuoteStatus.ACCEPTED, QuoteStatus.CANCELLED],
  [QuoteStatus.CANCELLED]: [],
};

type QuoteListQuery = {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  client?: string;
  dateFrom?: string;
  dateTo?: string;
  minTotal?: string;
  maxTotal?: string;
  folderId?: string;
  favoriteIds?: string;
  onlyFavorites?: string;
};

type QuoteListPageResult = {
  items: QuoteSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  folderCounts: Record<string, number>;
};

type QuoteComposerBootstrapResult = {
  nextQuoteNumber: string;
  recentQuotes: QuoteSummaryDto[];
  draftQuotes: QuoteSummaryDto[];
};

type QuoteFolderRecord = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  position: number | null;
  isArchived: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type QuoteFolderDelegate = {
  findMany(args: unknown): Promise<QuoteFolderRecord[]>;
  findFirst<T>(args: unknown): Promise<T | null>;
  create(args: {
    data: {
      workspaceId: string;
      name: string;
      description: string | null;
      createdByUserId: string;
    };
  }): Promise<QuoteFolderRecord>;
  delete(args: { where: { id: string } }): Promise<QuoteFolderRecord>;
};

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  private get quoteFolderDelegate(): QuoteFolderDelegate {
    return (this.prisma as unknown as { quoteFolder: QuoteFolderDelegate })
      .quoteFolder;
  }

  async list(userId: string, workspaceId: string): Promise<QuoteSummaryDto[]> {
    const quotes = await this.prisma.quote.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        folderId: true,
        templateId: true,
        quoteNumber: true,
        title: true,
        subtitle: true,
        clientData: true,
        total: true,
        issuedAt: true,
        validUntil: true,
        sentAt: true,
        viewedAt: true,
        acceptedAt: true,
        rejectedAt: true,
        cancelledAt: true,
        status: true,
        paymentStatus: true,
        _count: {
          select: {
            items: true,
          },
        },
        favorites: {
          where: { userId },
          select: { id: true },
          take: 1,
        },
      },
    });

    return quotes.map((quote) => this.toQuoteSummary(quote));
  }

  async getComposerBootstrap(
    userId: string,
    workspaceId: string,
  ): Promise<QuoteComposerBootstrapResult> {
    const profilingEnabled =
      process.env.PROFILE_QUOTES_COMPOSER_BOOTSTRAP === '1';
    const startedAt = Date.now();

    const nextQuoteNumberStartedAt = Date.now();
    const [nextQuoteNumber, recentQuotes, draftQuotes] = await Promise.all([
      this.getNextQuoteNumber(workspaceId),
      (async () => {
        const recentQuotesStartedAt = Date.now();
        const items = await this.prisma.quote.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            folderId: true,
            templateId: true,
            quoteNumber: true,
            title: true,
            subtitle: true,
            clientData: true,
            total: true,
            issuedAt: true,
            validUntil: true,
            sentAt: true,
            viewedAt: true,
            acceptedAt: true,
            rejectedAt: true,
            cancelledAt: true,
            status: true,
            paymentStatus: true,
            _count: {
              select: {
                items: true,
              },
            },
            favorites: {
              where: { userId },
              select: { id: true },
              take: 1,
            },
          },
        });

        return {
          items,
          elapsedMs: Date.now() - recentQuotesStartedAt,
        };
      })(),
      this.prisma.quote.findMany({
        where: { workspaceId, status: QuoteStatus.DRAFT },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          folderId: true,
          templateId: true,
          quoteNumber: true,
          title: true,
          subtitle: true,
          clientData: true,
          total: true,
          issuedAt: true,
          validUntil: true,
          sentAt: true,
          viewedAt: true,
          acceptedAt: true,
          rejectedAt: true,
          cancelledAt: true,
          status: true,
          paymentStatus: true,
          _count: {
            select: {
              items: true,
            },
          },
          favorites: {
            where: { userId },
            select: { id: true },
            take: 1,
          },
        },
      }),
    ]);
    const nextQuoteNumberMs = Date.now() - nextQuoteNumberStartedAt;
    const totalMs = Date.now() - startedAt;

    if (profilingEnabled) {
      this.logger.log(
        JSON.stringify({
          event: 'quotes_composer_bootstrap_profile',
          workspaceId,
          recentQuotesCount: recentQuotes.items.length,
          timingsMs: {
            nextQuoteNumber: nextQuoteNumberMs,
            recentQuotes: recentQuotes.elapsedMs,
            total: totalMs,
          },
        }),
      );
    }

    return {
      nextQuoteNumber,
      recentQuotes: recentQuotes.items.map((quote) =>
        this.toQuoteSummary(quote),
      ),
      draftQuotes: draftQuotes.map((quote) => this.toQuoteSummary(quote)),
    };
  }

  async listPage(
    userId: string,
    workspaceId: string,
    query: QuoteListQuery,
  ): Promise<QuoteListPageResult> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = Math.min(this.parsePositiveInt(query.pageSize, 18), 50);
    const favoriteIds = this.parseFavoriteIds(query.favoriteIds);

    if (query.favoriteIds && favoriteIds.length === 0) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize,
        totalPages: 1,
        folderCounts: await this.listFolderCounts(workspaceId),
      };
    }

    const where = this.buildQuoteListWhere(
      userId,
      workspaceId,
      query,
      favoriteIds,
    );
    const [items, total] = await this.prisma.$transaction([
      this.prisma.quote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          folderId: true,
          templateId: true,
          quoteNumber: true,
          title: true,
          subtitle: true,
          clientData: true,
          total: true,
          issuedAt: true,
          validUntil: true,
          sentAt: true,
          viewedAt: true,
          acceptedAt: true,
          rejectedAt: true,
          cancelledAt: true,
          status: true,
          paymentStatus: true,
          _count: {
            select: {
              items: true,
            },
          },
          favorites: {
            where: { userId },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.quote.count({ where }),
    ]);
    const folderCounts = await this.listFolderCounts(workspaceId);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    if (safePage !== page) {
      return this.listPage(userId, workspaceId, {
        ...query,
        page: String(safePage),
        pageSize: String(pageSize),
      });
    }

    return {
      items: items.map((quote) => this.toQuoteSummary(quote)),
      total,
      page: safePage,
      pageSize,
      totalPages,
      folderCounts,
    };
  }

  async listFavorites(userId: string, workspaceId: string) {
    const favorites = await this.prisma.quoteFavorite.findMany({
      where: { userId, workspaceId },
      orderBy: { createdAt: 'desc' },
      select: { quoteId: true },
    });

    return { ids: favorites.map((favorite) => favorite.quoteId) };
  }

  async setFavorite(
    userId: string,
    workspaceId: string,
    quoteId: string,
    isFavorite: boolean,
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, workspaceId },
      select: { id: true },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (!isFavorite) {
      await this.prisma.quoteFavorite.deleteMany({
        where: { userId, workspaceId, quoteId },
      });
      return { quoteId, isFavorite: false };
    }

    await this.prisma.quoteFavorite.upsert({
      where: {
        userId_quoteId: {
          userId,
          quoteId,
        },
      },
      create: {
        userId,
        workspaceId,
        quoteId,
      },
      update: {
        workspaceId,
      },
    });

    return { quoteId, isFavorite: true };
  }

  listFolders(workspaceId: string) {
    return this.quoteFolderDelegate.findMany({
      where: { workspaceId, isArchived: false },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createFolder(
    userId: string,
    workspaceId: string,
    dto: CreateQuoteFolderDto,
  ) {
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('El nombre de la carpeta es obligatorio.');
    }

    const existing = await this.quoteFolderDelegate.findFirst<{ id: string }>({
      where: {
        workspaceId,
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Ya existe una carpeta con ese nombre.');
    }

    try {
      return await this.quoteFolderDelegate.create({
        data: {
          workspaceId,
          name,
          description: dto.description?.trim() || null,
          createdByUserId: userId,
        },
      });
    } catch (error) {
      if (this.isWorkspaceFolderNameConflict(error)) {
        throw new ConflictException('Ya existe una carpeta con ese nombre.');
      }

      throw error;
    }
  }

  async removeFolder(workspaceId: string, folderId: string) {
    await this.assertFolderOwnership(workspaceId, folderId);

    await this.quoteFolderDelegate.delete({
      where: { id: folderId },
    });

    return { success: true };
  }

  async assignFolder(workspaceId: string, id: string, folderId: string | null) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (folderId) {
      await this.assertFolderOwnership(workspaceId, folderId);
    }

    return this.prisma.quote.update({
      where: { id },
      data: { folderId },
      include: {
        items: { orderBy: { position: 'asc' } },
      },
    });
  }

  async get(workspaceId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
        items: { orderBy: { position: 'asc' } },
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    return this.normalizeQuoteResponse(quote);
  }

  async create(userId: string, workspaceId: string, dto: CreateQuoteDto) {
    await this.subscriptionsService.assertCanCreateQuote(userId);
    const template = dto.templateId
      ? await this.prisma.template.findFirst({
          where: {
            id: dto.templateId,
            OR: [
              { type: TemplateType.SYSTEM, userId: null },
              { type: TemplateType.USER, workspaceId },
            ],
          },
          include: {
            sections: {
              orderBy: { position: 'asc' },
              include: {
                items: { orderBy: { position: 'asc' } },
              },
            },
          },
        })
      : null;

    if (dto.templateId && !template) {
      throw new NotFoundException('Template not found');
    }

    const { issuedAt, validUntil } = this.normalizeDraftDates(
      dto.issuedAt,
      dto.validUntil,
    );
    const items = this.normalizeDraftItems(dto.items);

    await this.assertItemServicesOwnership(workspaceId, items);

    const senderProfile = await this.prisma.senderProfile.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });

    const totals = this.calculateTotals(items, dto.discount, dto.taxRate);
    const now = new Date();
    const explicitQuoteNumber = dto.quoteNumber
      ? this.normalizeQuoteNumber(dto.quoteNumber)
      : null;
    const attempts = explicitQuoteNumber ? 1 : 3;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const quoteNumber =
        explicitQuoteNumber ?? (await this.getNextQuoteNumber(workspaceId));

      try {
        return await this.prisma.quote.create({
          data: {
            userId,
            workspaceId,
            templateId: template?.id ?? null,
            folderId: null,
            status: QuoteStatus.DRAFT,
            paymentStatus: dto.paymentStatus ?? PaymentStatus.PENDING,
            quoteNumber,
            title: dto.title?.trim() || 'Cotizacion',
            subtitle: dto.subtitle,
            description: dto.description,
            clientData: this.normalizeDraftClientData(dto.clientData),
            eventData: dto.eventData,
            paymentData: dto.paymentData,
            contactData: dto.contactData,
            logoUrl: dto.logoUrl,
            termsText: dto.termsText,
            senderProfileSnapshot: senderProfile ?? undefined,
            subtotal: totals.subtotal,
            discount: totals.discount,
            taxRate: totals.taxRate,
            netTotal: totals.netTotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            issuedAt,
            validUntil,
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: QuoteStatus.DRAFT,
                changedBy: userId,
                source: 'INTERNAL',
                changedAt: now,
              },
            },
            sections: template
              ? {
                  create: template.sections.map((section) => ({
                    title: section.title,
                    type: section.type,
                    position: section.position,
                    items: {
                      create: section.items.map((item) => ({
                        label: item.label,
                        value: item.value,
                        type: item.type,
                        position: item.position,
                      })),
                    },
                  })),
                }
              : undefined,
            items: items.length
              ? {
                  create: items.map((item, index) => ({
                    title: item.title,
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: new Prisma.Decimal(item.unitPrice),
                    total: new Prisma.Decimal(item.unitPrice).mul(
                      item.quantity,
                    ),
                    position: index,
                    serviceId: item.serviceId,
                  })),
                }
              : undefined,
          },
          include: {
            sections: {
              orderBy: { position: 'asc' },
              include: {
                items: { orderBy: { position: 'asc' } },
              },
            },
            items: { orderBy: { position: 'asc' } },
          },
        });
      } catch (error) {
        if (!this.isQuoteNumberConflict(error)) {
          throw error;
        }
        if (explicitQuoteNumber) {
          throw new ConflictException('Quote number already exists');
        }
      }
    }

    throw new ConflictException('Could not assign a unique quote number');
  }

  async update(
    userId: string,
    workspaceId: string,
    id: string,
    dto: UpdateQuoteDto,
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
      include: { items: true },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (dto.templateId) {
      throw new BadRequestException('Template cannot be changed');
    }

    const { issuedAt, validUntil } = this.normalizeDraftDates(
      dto.issuedAt ?? quote.issuedAt.toISOString(),
      dto.validUntil ?? quote.validUntil.toISOString(),
    );

    const items = dto.items
      ? this.normalizeDraftItems(dto.items)
      : quote.items.map((item) => ({
          title: item.title,
          description: item.description ?? '',
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          serviceId: item.serviceId ?? undefined,
        }));

    if (dto.items) {
      await this.assertItemServicesOwnership(workspaceId, items);
    }

    const totals = this.calculateTotals(
      items,
      dto.discount ?? Number(quote.discount),
      dto.taxRate ?? Number(quote.taxRate),
    );

    const nextStatus = dto.status;
    const now = new Date();

    if (nextStatus && nextStatus !== quote.status) {
      this.assertStatusTransition(quote.status, nextStatus);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.quoteItem.deleteMany({ where: { quoteId: quote.id } });
      }

      const transitionPatch =
        nextStatus && nextStatus !== quote.status
          ? this.getStatusTransitionPatch(nextStatus, now)
          : null;

      const updated = await tx.quote.update({
        where: { id: quote.id },
        data: {
          userId,
          workspaceId,
          status: nextStatus,
          paymentStatus: dto.paymentStatus,
          quoteNumber: dto.quoteNumber
            ? this.normalizeQuoteNumber(dto.quoteNumber)
            : undefined,
          title:
            dto.title !== undefined
              ? dto.title.trim() || 'Cotizacion'
              : undefined,
          subtitle: dto.subtitle,
          description: dto.description,
          clientData: dto.clientData
            ? this.normalizeDraftClientData(dto.clientData)
            : undefined,
          eventData: dto.eventData,
          paymentData: dto.paymentData,
          contactData: dto.contactData,
          logoUrl: dto.logoUrl,
          termsText: dto.termsText,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxRate: totals.taxRate,
          netTotal: totals.netTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          issuedAt,
          validUntil,
          ...(transitionPatch ?? {}),
          items: dto.items
            ? {
                create: items.map((item, index) => ({
                  title: item.title,
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: new Prisma.Decimal(item.unitPrice),
                  total: new Prisma.Decimal(item.unitPrice).mul(item.quantity),
                  position: index,
                  serviceId: item.serviceId,
                })),
              }
            : undefined,
        },
        include: {
          sections: {
            orderBy: { position: 'asc' },
            include: {
              items: { orderBy: { position: 'asc' } },
            },
          },
          items: { orderBy: { position: 'asc' } },
        },
      });

      if (nextStatus && nextStatus !== quote.status) {
        await tx.quoteStatusHistory.create({
          data: {
            quoteId: quote.id,
            fromStatus: quote.status,
            toStatus: nextStatus,
            changedBy: userId,
            source: 'INTERNAL',
            changedAt: now,
          },
        });
      }

      return updated;
    });
  }

  async changeStatus(
    userId: string,
    workspaceId: string,
    id: string,
    status: QuoteStatus,
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (quote.status === status) {
      return this.get(workspaceId, id);
    }

    this.assertStatusTransition(quote.status, status);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status,
          ...this.getStatusTransitionPatch(status, now),
        },
      });

      await tx.quoteStatusHistory.create({
        data: {
          quoteId: quote.id,
          fromStatus: quote.status,
          toStatus: status,
          changedBy: userId,
          source: 'INTERNAL',
          changedAt: now,
        },
      });

      return tx.quote.findUnique({
        where: { id: quote.id },
        include: {
          sections: {
            orderBy: { position: 'asc' },
            include: {
              items: { orderBy: { position: 'asc' } },
            },
          },
          items: { orderBy: { position: 'asc' } },
        },
      });
    });
  }

  async duplicate(userId: string, workspaceId: string, id: string) {
    await this.subscriptionsService.assertCanCreateQuote(userId);

    const source = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
        items: { orderBy: { position: 'asc' } },
      },
    });

    if (!source) {
      throw new NotFoundException('Quote not found');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = new Date();
      const nextQuoteNumber = await this.getNextQuoteNumber(workspaceId);

      try {
        return await this.prisma.quote.create({
          data: {
            userId,
            workspaceId,
            templateId: source.templateId,
            folderId: source.folderId ?? null,
            status: QuoteStatus.DRAFT,
            paymentStatus: source.paymentStatus ?? PaymentStatus.PENDING,
            quoteNumber: nextQuoteNumber,
            title: source.title,
            subtitle: source.subtitle,
            description: source.description,
            clientData: this.toRequiredInputJson(
              source.clientData,
              'clientData',
            ),
            eventData: this.toNullableInputJson(source.eventData),
            paymentData: this.toNullableInputJson(source.paymentData),
            contactData: this.toNullableInputJson(source.contactData),
            logoUrl: source.logoUrl,
            termsText: source.termsText,
            senderProfileSnapshot: source.senderProfileSnapshot ?? undefined,
            subtotal: source.subtotal,
            discount: source.discount,
            taxRate: source.taxRate,
            netTotal: source.netTotal,
            taxTotal: source.taxTotal,
            total: source.total,
            issuedAt: source.issuedAt,
            validUntil: source.validUntil,
            sentAt: null,
            viewedAt: null,
            acceptedAt: null,
            rejectedAt: null,
            cancelledAt: null,
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: QuoteStatus.DRAFT,
                changedBy: userId,
                source: 'INTERNAL',
                changedAt: now,
              },
            },
            sections: {
              create: source.sections.map((section) => ({
                title: section.title,
                type: section.type,
                position: section.position,
                items: {
                  create: section.items.map((item) => ({
                    label: item.label,
                    value: item.value,
                    type: item.type,
                    position: item.position,
                  })),
                },
              })),
            },
            items: {
              create: source.items.map((item) => ({
                title: item.title,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                position: item.position,
                serviceId: item.serviceId,
              })),
            },
          },
          include: {
            sections: {
              orderBy: { position: 'asc' },
              include: {
                items: { orderBy: { position: 'asc' } },
              },
            },
            items: { orderBy: { position: 'asc' } },
          },
        });
      } catch (error) {
        if (this.isQuoteNumberConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not assign a unique quote number for the duplicated quote',
    );
  }

  async remove(workspaceId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    return this.prisma.quote.delete({ where: { id: quote.id } });
  }

  async exportPdf(userId: string, workspaceId: string, id: string) {
    await this.subscriptionsService.assertCanExportPdf(userId);
    const quote = await this.prisma.quote.findFirst({
      where: { id, workspaceId },
      include: {
        items: { orderBy: { position: 'asc' } },
        sections: {
          orderBy: { position: 'asc' },
          include: { items: { orderBy: { position: 'asc' } } },
        },
        template: { select: { name: true, theme: true } },
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (!quote.title || !quote.clientData || quote.items.length === 0) {
      throw new BadRequestException('Quote missing required data');
    }

    const html = renderQuotePdfHtml({
      ...quote,
      items: quote.items.map((item) => ({
        ...item,
        description: item.description ?? '',
      })),
      templateName: quote.template?.name ?? null,
      templateTheme: quote.template?.theme ?? null,
    });

    return this.pdfRenderer.renderPdf(html);
  }

  private calculateTotals(
    items: { quantity: number; unitPrice: number }[],
    discount?: number,
    taxRate?: number,
  ) {
    try {
      return calculateQuoteTotals(items, discount, taxRate);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DISCOUNT_EXCEEDS_SUBTOTAL
      ) {
        throw new BadRequestException(DISCOUNT_EXCEEDS_SUBTOTAL);
      }
      throw error;
    }
  }

  private async assertItemServicesOwnership(
    workspaceId: string,
    items: { serviceId?: string | null }[],
  ) {
    const serviceIds = Array.from(
      new Set(
        items.map((item) => item.serviceId).filter((id): id is string => !!id),
      ),
    );

    if (serviceIds.length === 0) {
      return;
    }

    const count = await this.prisma.service.count({
      where: {
        workspaceId,
        id: { in: serviceIds },
      },
    });

    if (count !== serviceIds.length) {
      throw new ForbiddenException(
        'One or more referenced services do not belong to the current workspace',
      );
    }
  }

  private assertStatusTransition(from: QuoteStatus, to: QuoteStatus) {
    const allowed = QUOTE_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid status transition from ${from} to ${to}`,
      );
    }
  }

  private getStatusTransitionPatch(status: QuoteStatus, at: Date) {
    switch (status) {
      case QuoteStatus.SENT:
        return { sentAt: at };
      case QuoteStatus.VIEWED:
        return { viewedAt: at };
      case QuoteStatus.ACCEPTED:
        return { acceptedAt: at };
      case QuoteStatus.REJECTED:
        return { rejectedAt: at };
      case QuoteStatus.CANCELLED:
        return { cancelledAt: at };
      default:
        return {};
    }
  }

  private toRequiredInputJson(
    value: Prisma.JsonValue,
    fieldName: string,
  ): Prisma.InputJsonValue {
    if (value === null) {
      throw new BadRequestException(`Quote ${fieldName} cannot be null`);
    }
    return value as Prisma.InputJsonValue;
  }

  private toNullableInputJson(
    value: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === null) {
      return Prisma.JsonNull;
    }
    if (typeof value === 'undefined') {
      return undefined;
    }
    return value as Prisma.InputJsonValue;
  }

  private async getNextQuoteNumber(workspaceId: string): Promise<string> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ maxNumber: bigint | number | null }>
      >(
        Prisma.sql`
          SELECT COALESCE(
            MAX(
              CAST(
                NULLIF(regexp_replace("quoteNumber", '\D', '', 'g'), '') AS BIGINT
              )
            ),
            0
          ) AS "maxNumber"
          FROM "Quote"
          WHERE "workspaceId" = ${workspaceId}
        `,
      );

      const rawMax = rows[0]?.maxNumber ?? 0;
      const normalizedMax =
        typeof rawMax === 'bigint' ? Number(rawMax) : Number(rawMax ?? 0);

      if (Number.isFinite(normalizedMax) && normalizedMax >= 0) {
        return String(normalizedMax + 1);
      }
    } catch {
      // Fallback to the previous application-side calculation if the database cannot evaluate the query.
    }

    const quotes = await this.prisma.quote.findMany({
      where: { workspaceId },
      select: { quoteNumber: true },
    });

    let max = 0;
    for (const quote of quotes) {
      const parsed = this.extractTrailingNumber(quote.quoteNumber);
      if (parsed !== null && parsed > max) {
        max = parsed;
      }
    }

    return String(max + 1);
  }

  private extractTrailingNumber(value: string): number | null {
    const match = value.match(/(\d+)(?!.*\d)/);
    if (!match) {
      return null;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeDraftItems(items?: CreateQuoteItemDto[]) {
    return (items ?? [])
      .filter((item) => this.isMeaningfulDraftItem(item))
      .map((item) => ({
        title: item.title?.trim() || 'Servicio',
        description: item.description?.trim() || '',
        quantity: this.normalizePositiveInteger(item.quantity, 1),
        unitPrice: this.normalizeNonNegativeInteger(item.unitPrice, 0),
        serviceId: item.serviceId ?? undefined,
      }));
  }

  private isMeaningfulDraftItem(
    item: Partial<CreateQuoteItemDto> | null | undefined,
  ): boolean {
    if (!item) {
      return false;
    }

    return (
      !!item.serviceId ||
      !!item.title?.trim() ||
      !!item.description?.trim() ||
      Number(item.unitPrice ?? 0) > 0 ||
      Number(item.quantity ?? 0) > 1
    );
  }

  private normalizeDraftClientData(value?: Record<string, string>) {
    return {
      name: value?.name?.trim() || '',
      rut: value?.rut?.trim() || '',
      giro: value?.giro?.trim() || '',
      email: value?.email?.trim() || '',
      address: value?.address?.trim() || '',
    };
  }

  private normalizeDraftDates(
    issuedAt?: string,
    validUntil?: string,
  ): { issuedAt: Date; validUntil: Date } {
    const now = new Date();
    const safeIssuedAt = this.parseDateOrFallback(issuedAt, now);
    const fallbackValidUntil = new Date(safeIssuedAt);
    fallbackValidUntil.setDate(fallbackValidUntil.getDate() + 7);
    const safeValidUntil = this.parseDateOrFallback(
      validUntil,
      fallbackValidUntil,
    );

    if (safeIssuedAt.getTime() > safeValidUntil.getTime()) {
      throw new BadRequestException('validUntil must be after issuedAt');
    }

    return {
      issuedAt: safeIssuedAt,
      validUntil: safeValidUntil,
    };
  }

  private parseDateOrFallback(value: string | undefined, fallback: Date): Date {
    const raw = value?.trim();
    if (!raw) {
      return new Date(fallback);
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return new Date(fallback);
    }

    return parsed;
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }
    return Math.round(parsed);
  }

  private normalizeNonNegativeInteger(
    value: unknown,
    fallback: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return Math.round(parsed);
  }

  private async assertFolderOwnership(workspaceId: string, folderId: string) {
    const folder = await this.quoteFolderDelegate.findFirst<{ id: string }>({
      where: { id: folderId, workspaceId, isArchived: false },
      select: { id: true },
    });

    if (!folder) {
      throw new NotFoundException('Carpeta no encontrada.');
    }
  }

  private isQuoteNumberConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = (error as { code?: string }).code;
    if (code !== 'P2002') {
      return false;
    }

    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    if (!Array.isArray(target)) {
      return true;
    }

    return target.includes('workspaceId') && target.includes('quoteNumber');
  }

  private normalizeQuoteResponse<T extends { quoteNumber: string }>(
    quote: T,
  ): T {
    return {
      ...quote,
      quoteNumber: this.normalizeQuoteNumber(quote.quoteNumber),
    };
  }

  private toSummaryClientData(value: Prisma.JsonValue) {
    const clientData =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return {
      name: typeof clientData.name === 'string' ? clientData.name : '',
      rut: typeof clientData.rut === 'string' ? clientData.rut : '',
      email: typeof clientData.email === 'string' ? clientData.email : '',
    };
  }

  private normalizeQuoteNumber(value: unknown): string {
    const raw =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
        ? String(value).trim()
        : '';
    if (!raw) {
      return '';
    }

    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      return raw;
    }

    const normalized = String(Number(digits));
    return normalized === 'NaN' ? raw : normalized;
  }

  private isWorkspaceFolderNameConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.map((value) => String(value))
      : [];

    return target.includes('workspaceId') && target.includes('name');
  }

  private toQuoteSummary(quote: {
    id: string;
    folderId: string | null;
    templateId: string | null;
    quoteNumber: string;
    title: string;
    subtitle: string | null;
    clientData: Prisma.JsonValue;
    total: Prisma.Decimal | number | string;
    issuedAt: Date;
    validUntil: Date;
    sentAt: Date | null;
    viewedAt: Date | null;
    acceptedAt: Date | null;
    rejectedAt: Date | null;
    cancelledAt: Date | null;
    status: QuoteStatus;
    paymentStatus: PaymentStatus;
    _count: { items: number };
    favorites?: Array<{ id: string }>;
  }) {
    return {
      id: quote.id,
      folderId: quote.folderId ?? null,
      templateId: quote.templateId ?? null,
      quoteNumber: this.normalizeQuoteNumber(quote.quoteNumber),
      title: quote.title,
      subtitle: quote.subtitle ?? null,
      clientData: this.toSummaryClientData(quote.clientData),
      total: new Prisma.Decimal(quote.total).toNumber(),
      issuedAt: quote.issuedAt.toISOString().slice(0, 10),
      validUntil: quote.validUntil.toISOString().slice(0, 10),
      sentAt: quote.sentAt?.toISOString() ?? null,
      viewedAt: quote.viewedAt?.toISOString() ?? null,
      acceptedAt: quote.acceptedAt?.toISOString() ?? null,
      rejectedAt: quote.rejectedAt?.toISOString() ?? null,
      cancelledAt: quote.cancelledAt?.toISOString() ?? null,
      status: quote.status,
      paymentStatus: quote.paymentStatus,
      itemsCount: quote._count.items,
      isFavorite: (quote.favorites?.length ?? 0) > 0,
    };
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseFavoriteIds(value?: string): string[] {
    if (!value) {
      return [];
    }

    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => /^[0-9a-f-]{36}$/i.test(entry));
  }

  private buildQuoteListWhere(
    userId: string,
    workspaceId: string,
    query: QuoteListQuery,
    favoriteIds: string[],
  ): Prisma.QuoteWhereInput {
    const search = query.search?.trim();
    const client = query.client?.trim();
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : null;
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
      dateFrom.setHours(0, 0, 0, 0);
    }
    const dateTo = query.dateTo ? new Date(query.dateTo) : null;
    if (dateTo && !Number.isNaN(dateTo.getTime())) {
      dateTo.setHours(23, 59, 59, 999);
    }
    const minTotal = query.minTotal ? Number(query.minTotal) : null;
    const maxTotal = query.maxTotal ? Number(query.maxTotal) : null;
    const folderId = query.folderId?.trim();

    const where: Prisma.QuoteWhereInput = { workspaceId };

    if (folderId) {
      where.folderId = folderId === 'none' ? null : folderId;
    }

    if (favoriteIds.length > 0) {
      where.id = { in: favoriteIds };
    }

    if (query.onlyFavorites === 'true') {
      where.favorites = {
        some: {
          userId,
          workspaceId,
        },
      };
    }

    if (search) {
      where.OR = [
        {
          title: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          quoteNumber: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          clientData: {
            path: ['name'],
            string_contains: search,
          },
        },
      ];
    }

    if (client) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          clientData: {
            path: ['name'],
            string_contains: client,
          },
        },
      ];
    }

    const statusFilter = this.mapVisibleStatus(query.status);
    if (statusFilter) {
      where.status = statusFilter;
    }

    const hasDateFrom = !!dateFrom && !Number.isNaN(dateFrom.getTime());
    const hasDateTo = !!dateTo && !Number.isNaN(dateTo.getTime());
    if (hasDateFrom || hasDateTo) {
      where.issuedAt = {
        ...(hasDateFrom ? { gte: dateFrom } : {}),
        ...(hasDateTo ? { lte: dateTo } : {}),
      };
    }

    const hasMinTotal = minTotal !== null && Number.isFinite(minTotal);
    const hasMaxTotal = maxTotal !== null && Number.isFinite(maxTotal);
    if (hasMinTotal || hasMaxTotal) {
      where.total = {
        ...(hasMinTotal ? { gte: new Prisma.Decimal(minTotal) } : {}),
        ...(hasMaxTotal ? { lte: new Prisma.Decimal(maxTotal) } : {}),
      } as Prisma.DecimalFilter;
    }

    return where;
  }

  private mapVisibleStatus(
    status?: string,
  ): QuoteStatus | Prisma.EnumQuoteStatusFilter | undefined {
    switch (status) {
      case 'DRAFT':
        return QuoteStatus.DRAFT;
      case 'SENT':
        return { in: [QuoteStatus.SENT, QuoteStatus.VIEWED] };
      case 'ACCEPTED':
        return QuoteStatus.ACCEPTED;
      case 'CANCELLED':
        return { in: [QuoteStatus.CANCELLED, QuoteStatus.REJECTED] };
      default:
        return undefined;
    }
  }

  private async listFolderCounts(
    workspaceId: string,
  ): Promise<Record<string, number>> {
    const grouped = await this.prisma.quote.groupBy({
      by: ['folderId'],
      where: { workspaceId },
      _count: {
        _all: true,
      },
    });

    const counts: Record<string, number> = { all: 0, none: 0 };
    for (const row of grouped) {
      const count = row._count._all;
      counts.all += count;
      if (!row.folderId) {
        counts.none += count;
        continue;
      }
      counts[row.folderId] = count;
    }

    return counts;
  }
}
