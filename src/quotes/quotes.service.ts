import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuoteStatus, TemplateType } from '@prisma/client';
import puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { renderQuotePdfHtml } from './pdf/quote-pdf.template';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  list(userId: string) {
    return this.prisma.quote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { orderBy: { position: 'asc' } },
      },
    });
  }

  async get(userId: string, id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
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

    if (quote.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return quote;
  }

  async create(userId: string, dto: CreateQuoteDto) {
    await this.subscriptionsService.assertCanCreateQuote(userId);
    const template = await this.prisma.template.findUnique({
      where: { id: dto.templateId },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            items: { orderBy: { position: 'asc' } },
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (template.type === TemplateType.USER && template.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const issuedAt = new Date(dto.issuedAt);
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('Invalid dates');
    }

    if (issuedAt > validUntil) {
      throw new BadRequestException('validUntil must be after issuedAt');
    }

    const senderProfile = await this.prisma.senderProfile.findUnique({
      where: { userId },
    });

    const totals = this.calculateTotals(dto.items, dto.discount, dto.taxRate);

    return this.prisma.quote.create({
      data: {
        userId,
        templateId: template.id,
        status: QuoteStatus.DRAFT,
        quoteNumber: dto.quoteNumber,
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
        sections: {
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
        },
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
  }

  async update(userId: string, id: string, dto: UpdateQuoteDto) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (quote.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (dto.templateId) {
      throw new BadRequestException('Template cannot be changed');
    }

    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : quote.issuedAt;
    const validUntil = dto.validUntil
      ? new Date(dto.validUntil)
      : quote.validUntil;

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

    const totals = this.calculateTotals(
      items,
      dto.discount ?? Number(quote.discount),
      dto.taxRate ?? Number(quote.taxRate),
    );

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.quoteItem.deleteMany({ where: { quoteId: quote.id } });
      }

      const updated = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: dto.status,
          quoteNumber: dto.quoteNumber,
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

      return updated;
    });
  }

  async remove(userId: string, id: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id } });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return this.prisma.quote.delete({ where: { id: quote.id } });
  }

  async exportPdf(userId: string, id: string) {
    await this.subscriptionsService.assertCanExportPdf(userId);
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: 'asc' } },
        sections: {
          orderBy: { position: 'asc' },
          include: { items: { orderBy: { position: 'asc' } } },
        },
        template: { select: { name: true } },
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (quote.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (!quote.title || !quote.clientData || quote.items.length === 0) {
      throw new BadRequestException('Quote missing required data');
    }

    const html = renderQuotePdfHtml({
      ...quote,
      templateName: quote.template?.name ?? null,
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
        margin: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
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
    const subtotal = items.reduce(
      (acc, item) =>
        acc.plus(new Prisma.Decimal(item.unitPrice).mul(item.quantity)),
      new Prisma.Decimal(0),
    );

    const discountValue = new Prisma.Decimal(discount ?? 0);
    if (discountValue.greaterThan(subtotal)) {
      throw new BadRequestException('Discount exceeds subtotal');
    }

    const netTotal = subtotal.minus(discountValue);
    const taxRateValue = new Prisma.Decimal(taxRate ?? 0);
    const taxTotal = netTotal.mul(taxRateValue).div(100);
    const total = netTotal.minus(taxTotal);

    return {
      subtotal,
      discount: discountValue,
      taxRate: taxRateValue,
      netTotal,
      taxTotal,
      total,
    };
  }
}
