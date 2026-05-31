import { Prisma } from '@prisma/client';
import { renderQuotePdfHtml } from './quote-pdf.template';

describe('renderQuotePdfHtml', () => {
  it('drops private network asset URLs from the rendered HTML', () => {
    const html = renderQuotePdfHtml({
      quoteNumber: '1',
      title: 'Cotizacion',
      subtitle: null,
      description: null,
      termsText: null,
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2026-01-08T00:00:00.000Z'),
      discount: new Prisma.Decimal(0),
      taxRate: new Prisma.Decimal(19),
      clientData: { name: 'Cliente' },
      eventData: null,
      paymentData: null,
      contactData: null,
      senderProfileSnapshot: null,
      logoUrl: 'http://127.0.0.1/logo.png',
      templateTheme: {
        backgroundImage: 'http://localhost/private.png',
      },
      items: [
        {
          title: 'Servicio',
          description: '',
          quantity: 1,
          unitPrice: new Prisma.Decimal(1000),
        },
      ],
    });

    expect(html).not.toContain('127.0.0.1');
    expect(html).not.toContain('localhost/private.png');
  });
});
