import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, QuoteStatus, TemplateType } from '@prisma/client';
import puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { CreateQuoteFolderDto } from './dto/create-quote-folder.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
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

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async list(workspaceId: string) {
    const quotes = await this.prisma.quote.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        folderId: true,
        templateId: true,
        quoteNumber: true,
        title: true,
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
      },
    });

    return quotes.map((quote) => ({
      id: quote.id,
      folderId: quote.folderId ?? null,
      templateId: quote.templateId ?? null,
      quoteNumber: this.normalizeQuoteNumber(quote.quoteNumber),
      title: quote.title,
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
    }));
  }

  listFolders(workspaceId: string) {
    return (this.prisma as any).quoteFolder.findMany({
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

    const existing = await (this.prisma as any).quoteFolder.findFirst({
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
      return await (this.prisma as any).quoteFolder.create({
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

    await (this.prisma as any).quoteFolder.delete({
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
      data: { folderId } as any,
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

    const issuedAt = new Date(dto.issuedAt);
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('Invalid dates');
    }

    if (issuedAt > validUntil) {
      throw new BadRequestException('validUntil must be after issuedAt');
    }

    await this.assertItemServicesOwnership(workspaceId, dto.items);

    const senderProfile = await this.prisma.senderProfile.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });

    const totals = this.calculateTotals(dto.items, dto.discount, dto.taxRate);
    const now = new Date();

    return this.prisma.quote.create({
      data: {
        userId,
        workspaceId,
        templateId: template?.id ?? null,
        folderId: null,
        status: QuoteStatus.DRAFT,
        paymentStatus: dto.paymentStatus ?? PaymentStatus.PENDING,
        quoteNumber: this.normalizeQuoteNumber(dto.quoteNumber),
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        clientData: dto.clientData,
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
        items: {
          create: dto.items.map((item, index) => ({
            title: item.title,
            description: item.description,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            total: new Prisma.Decimal(item.unitPrice).mul(item.quantity),
            position: index,
            serviceId: item.serviceId,
          })),
        },
      } as any,
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
  }

  async update(userId: string, workspaceId: string, id: string, dto: UpdateQuoteDto) {
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

    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : quote.issuedAt;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : quote.validUntil;

    if (issuedAt > validUntil) {
      throw new BadRequestException('validUntil must be after issuedAt');
    }

    const items = dto.items ?? quote.items.map((item) => ({
      title: item.title,
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      serviceId: item.serviceId ?? undefined,
    }));

    if (dto.items) {
      await this.assertItemServicesOwnership(workspaceId, dto.items);
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
          quoteNumber: dto.quoteNumber ? this.normalizeQuoteNumber(dto.quoteNumber) : undefined,
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          clientData: dto.clientData,
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
                create: dto.items.map((item, index) => ({
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

  async changeStatus(userId: string, workspaceId: string, id: string, status: QuoteStatus) {
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
            folderId: (source as any).folderId ?? null,
            status: QuoteStatus.DRAFT,
            paymentStatus: source.paymentStatus ?? PaymentStatus.PENDING,
            quoteNumber: nextQuoteNumber,
            title: source.title,
            subtitle: source.subtitle,
            description: source.description,
            clientData: this.toRequiredInputJson(source.clientData, 'clientData'),
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
          } as any,
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
    const quote = await this.prisma.quote.findFirst({ where: { id, workspaceId } });
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

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        scale: 0.92,
        margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' },
      });
      await page.close();
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  private calculateTotals(
    items: { quantity: number; unitPrice: number }[],
    discount?: number,
    taxRate?: number,
  ) {
    try {
      return calculateQuoteTotals(items, discount, taxRate);
    } catch (error) {
      if (error instanceof Error && error.message === DISCOUNT_EXCEEDS_SUBTOTAL) {
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
      new Set(items.map((item) => item.serviceId).filter((id): id is string => !!id)),
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

  private async assertFolderOwnership(workspaceId: string, folderId: string) {
    const folder = await (this.prisma as any).quoteFolder.findFirst({
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

  private normalizeQuoteResponse<T extends { quoteNumber: string }>(quote: T): T {
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
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }

    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      return raw;
    }

    const normalized = String(Number(digits));
    return normalized === "NaN" ? raw : normalized;
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
}
