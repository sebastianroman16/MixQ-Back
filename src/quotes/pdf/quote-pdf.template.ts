import { Prisma } from '@prisma/client';

type QuotePdfItem = {
  title: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
};

type QuotePdfSectionItem = {
  label: string;
  value: string | null;
};

type QuotePdfSection = {
  type: string;
  items: QuotePdfSectionItem[];
};

type QuotePdfData = {
  quoteNumber: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  termsText: string | null;
  issuedAt: Date | string | null;
  validUntil: Date | string | null;
  discount: Prisma.Decimal | number | null;
  taxRate: Prisma.Decimal | number | null;
  clientData: Prisma.JsonValue;
  eventData: Prisma.JsonValue | null;
  paymentData: Prisma.JsonValue | null;
  contactData: Prisma.JsonValue | null;
  items: QuotePdfItem[];
  logoUrl: string | null;
  sections?: QuotePdfSection[];
  templateName?: string | null;
};

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const formatDate = (value?: Date | string | null) => {
  if (!value) {
    return '-';
  }
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = match[1];
      const monthIndex = Number(match[2]) - 1;
      const day = Number(match[3]);
      const month = MONTHS[monthIndex] ?? '';
      if (!month) {
        return value;
      }
      return `${day}-${month}-${year}`;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return formatDate(date);
  }

  const day = String(value.getDate()).padStart(2, '0');
  const month = MONTHS[value.getMonth()] ?? '';
  const year = value.getFullYear();
  return `${day}-${month}-${year}`;
};

const toNumber = (value: Prisma.Decimal | number | string | null | undefined) =>
  value === null || value === undefined
    ? 0
    : new Prisma.Decimal(value).toNumber();

const formatNumber = (
  value: Prisma.Decimal | number | string | null | undefined,
) =>
  new Intl.NumberFormat('es-CL', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(toNumber(value));

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const asRecord = (value: Prisma.JsonValue | null) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};

const splitDescription = (description: string) =>
  description
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const formatIndentedText = (value?: string | null) => {
  if (!value) {
    return '';
  }
  const lines = value.split('\n');
  let inBlock = false;
  const formatted = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      inBlock = false;
      return '';
    }
    if (trimmed.startsWith('-')) {
      inBlock = true;
      return trimmed;
    }
    if (inBlock) {
      return `      ${trimmed}`;
    }
    return trimmed;
  });
  return formatted.join('\n');
};

const findSection = (sections: QuotePdfSection[] | undefined, type: string) =>
  sections?.find((section) => section.type === type);

const getSectionText = (sections: QuotePdfSection[] | undefined, type: string) => {
  const section = findSection(sections, type);
  if (!section) {
    return 'Sin informacion.';
  }
  return section.items
    .map((item) => item.value || '')
    .filter(Boolean)
    .join(' ');
};

const getSectionValue = (
  sections: QuotePdfSection[] | undefined,
  type: string,
  label: string,
) => {
  const section = findSection(sections, type);
  const item = section?.items.find(
    (entry) => entry.label.toLowerCase() === label.toLowerCase(),
  );
  return item?.value ?? '';
};

const valueOrDash = (value?: string | null) => (value ? value : '-');

export const renderQuotePdfHtml = (quote: QuotePdfData) => {
  const client = asRecord(quote.clientData);
  const event = asRecord(quote.eventData);
  const payment = asRecord(quote.paymentData);
  const contact = asRecord(quote.contactData);
  const issuedAt = formatDate(quote.issuedAt);
  const validUntil = formatDate(quote.validUntil);
  const eventDate = valueOrDash(event.date);
  const templateName = quote.templateName ?? '';
  const headerAddress =
    getSectionValue(quote.sections, 'HEADER', 'Direccion') ||
    client.address ||
    '';
  const quoteNumber =
    quote.quoteNumber ||
    getSectionValue(quote.sections, 'HEADER', 'Numero') ||
    'Cotizacion N\u00b0';
  const subtitle =
    quote.subtitle || getSectionValue(quote.sections, 'SUBTITLE', 'Subtitulo');
  const description =
    quote.description ||
    getSectionValue(quote.sections, 'SUBTITLE', 'Descripcion');
  const termsText = quote.termsText || getSectionText(quote.sections, 'TERMS');
  const logoUrl = quote.logoUrl;
  const taxRate =
    quote.taxRate !== null && quote.taxRate !== undefined
      ? toNumber(quote.taxRate)
      : 19;
  const discount = quote.discount ? toNumber(quote.discount) : 0;

  const subtotal = quote.items.reduce(
    (acc, item) =>
      acc +
      new Prisma.Decimal(item.unitPrice).mul(item.quantity).toNumber(),
    0,
  );
  const netTotal = Math.max(subtotal - discount, 0);
  const taxTotal = Math.round(netTotal * (taxRate / 100));
  const total = netTotal + taxTotal;

  const itemsRows = quote.items
    .map((item) => {
      const descriptionLines = splitDescription(item.description);
      return `
        <div class="preview__table-row">
          <div class="preview__table-title">${escapeHtml(item.title)}</div>
          <div>
            ${descriptionLines
              .map(
                (line) =>
                  `<p class="preview__table-desc">${escapeHtml(line)}</p>`,
              )
              .join('')}
          </div>
          <div>${item.quantity}</div>
          <div>${formatNumber(item.unitPrice)}</div>
          <div>${formatNumber(
            new Prisma.Decimal(item.unitPrice).mul(item.quantity),
          )}</div>
        </div>
      `;
    })
    .join('');

  return `
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Cotizacion ${escapeHtml(quote.quoteNumber)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: "Helvetica Neue", Arial, sans-serif;
        color: var(--preview-text, #0f172a);
        background: #ffffff;
      }
      .preview__sheet {
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
        background: var(--preview-sheet-bg, #ffffff);
        color: var(--preview-text, #0f172a);
      }
      .preview__header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border-bottom: 1px solid var(--preview-border, #e2e8f0);
      }
      .preview__title { font-size: 1.25rem; font-weight: 600; }
      .preview__subtitle { font-size: 0.875rem; color: var(--preview-muted, #475569); }
      .preview__quote-number {
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.15em;
      }
      .preview__hero {
        margin-top: 1rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .preview__hero-content { display: flex; flex-direction: column; gap: 0.5rem; }
      .preview__hero-title { font-size: 1.125rem; font-weight: 600; }
      .preview__hero-text { font-size: 0.875rem; color: var(--preview-muted, #475569); }
      .preview__multiline { white-space: pre-line; }
      .preview__logo {
        display: flex;
        height: 4rem;
        width: 4rem;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        border: 1px solid var(--preview-border, #e2e8f0);
        font-size: 0.75rem;
        color: var(--preview-muted, #475569);
      }
      .preview__logo img { height: 100%; width: 100%; border-radius: 9999px; object-fit: cover; }
      .preview__info { margin-top: 1.5rem; display: grid; gap: 1.5rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .preview__info h4 {
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        color: var(--preview-muted, #475569);
      }
      .preview__info p { font-size: 0.875rem; color: var(--preview-text, #0f172a); }
      .preview__table {
        margin-top: 1.5rem;
        border: 1px solid var(--preview-border, #e2e8f0);
      }
      .preview__table-head {
        display: grid;
        grid-template-columns: 1.4fr 2fr 0.6fr 0.8fr 0.8fr;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        background: var(--preview-header-bg, #0f172a);
        color: var(--preview-header-text, #ffffff);
      }
      .preview__table-row {
        display: grid;
        grid-template-columns: 1.4fr 2fr 0.6fr 0.8fr 0.8fr;
        gap: 0.5rem;
        border-top: 1px solid var(--preview-border, #e2e8f0);
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
      }
      .preview__table-title { font-weight: 600; color: var(--preview-text, #0f172a); }
      .preview__table-desc { font-size: 0.75rem; color: var(--preview-muted, #475569); }
      .preview__totals { margin-top: 1.5rem; display: grid; gap: 1.5rem; grid-template-columns: 2fr 1fr; }
      .preview__terms h4,
      .preview__footer h4 {
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        color: var(--preview-muted, #475569);
      }
      .preview__terms p,
      .preview__footer p {
        margin-top: 0.5rem;
        font-size: 0.875rem;
        color: var(--preview-text, #0f172a);
      }
      .preview__terms-text { white-space: pre-line; }
      .preview__totals-box {
        border-radius: 0.75rem;
        border: 1px solid var(--preview-border, #e2e8f0);
        padding: 1rem;
        font-size: 0.875rem;
        color: var(--preview-text, #0f172a);
      }
      .preview__totals-box div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        border-bottom: 1px solid var(--preview-border, #e2e8f0);
        padding: 0.5rem 0;
      }
      .preview__totals-box div:last-child { border-bottom: 0; }
      .preview__totals-total { color: var(--preview-accent, #5A6FF0); }
      .preview__footer { margin-top: 1.5rem; display: grid; gap: 1.5rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    </style>
  </head>
  <body>
    <section class="preview">
      <div class="preview__sheet">
        <header class="preview__header">
          <div class="preview__header-content">
            <h2 class="preview__title">${escapeHtml(quote.title || templateName)}</h2>
            <p class="preview__subtitle">${escapeHtml(headerAddress)}</p>
          </div>
          <div class="preview__header-meta">
            <p class="preview__quote-number">${escapeHtml(quoteNumber)}</p>
          </div>
        </header>

        <section class="preview__hero">
          <div>
            <h3 class="preview__hero-title">${escapeHtml(subtitle || '')}</h3>
            <p class="preview__hero-text preview__multiline">${escapeHtml(
              formatIndentedText(description),
            )}</p>
          </div>
          <div class="preview__logo">
            ${
              logoUrl
                ? `<img src="${escapeHtml(logoUrl)}" alt="Logo empresa" />`
                : '<span>LOGO</span>'
            }
          </div>
        </section>

        <section class="preview__info">
          <div>
            <h4>Informacion Cliente</h4>
            <p><strong>Nombre o Razon Social:</strong> ${escapeHtml(
              valueOrDash(client.name),
            )}</p>
            <p><strong>RUT:</strong> ${escapeHtml(valueOrDash(client.rut))}</p>
            <p><strong>Giro:</strong> ${escapeHtml(valueOrDash(client.giro))}</p>
            <p><strong>Correo electronico:</strong> ${escapeHtml(
              valueOrDash(client.email),
            )}</p>
            <p><strong>Direccion:</strong> ${escapeHtml(
              valueOrDash(client.address),
            )}</p>
            <p><strong>Fecha Cotizacion:</strong> ${escapeHtml(issuedAt)}</p>
            <p><strong>Valido hasta:</strong> ${escapeHtml(validUntil)}</p>
          </div>
          ${
            Object.keys(event).length
              ? `<div>
            <h4>Informacion Evento</h4>
            <p><strong>Persona a Cargo:</strong> ${escapeHtml(
              valueOrDash(event.personInCharge),
            )}</p>
            <p><strong>Telefono:</strong> ${escapeHtml(
              valueOrDash(event.phone),
            )}</p>
            <p><strong>Correo electronico:</strong> ${escapeHtml(
              valueOrDash(event.email),
            )}</p>
            <p><strong>Fecha evento:</strong> ${escapeHtml(
              valueOrDash(eventDate),
            )}</p>
            <p><strong>Direccion evento:</strong> ${escapeHtml(
              valueOrDash(event.address),
            )}</p>
          </div>`
              : ''
          }
        </section>

        <section class="preview__table">
          <div class="preview__table-head">
            <span>Servicio</span>
            <span>Descripcion</span>
            <span>Cant.</span>
            <span>Precio</span>
            <span>Subtotal</span>
          </div>
          ${itemsRows}
        </section>

        <section class="preview__totals">
          <div class="preview__terms">
            <h4>Terminos y condiciones</h4>
            <p class="preview__terms-text">${escapeHtml(
              formatIndentedText(termsText),
            )}</p>
          </div>
          <div class="preview__totals-box">
            <div><span>Subtotal</span><strong>${formatNumber(subtotal)}</strong></div>
            ${
              discount > 0
                ? `<div><span>Descuento</span><strong>${formatNumber(
                    discount,
                  )}</strong></div>`
                : ''
            }
            <div><span>Total Neto</span><strong>${formatNumber(
              netTotal,
            )}</strong></div>
            <div><span>IVA ${formatNumber(taxRate)}%</span><strong>${formatNumber(
              taxTotal,
            )}</strong></div>
            <div class="preview__totals-total"><span>Total</span><strong>${formatNumber(
              total,
            )}</strong></div>
          </div>
        </section>

        <section class="preview__footer">
          <div>
            <h4>Informacion de pago</h4>
            <p><strong>Nombre del beneficiario:</strong> ${escapeHtml(
              valueOrDash(payment.beneficiaryName),
            )}</p>
            <p><strong>RUT:</strong> ${escapeHtml(valueOrDash(payment.rut))}</p>
            <p><strong>Banco:</strong> ${escapeHtml(valueOrDash(payment.bank))}</p>
            <p><strong>Tipo de cuenta:</strong> ${escapeHtml(
              valueOrDash(payment.accountType),
            )}</p>
            <p><strong>Numero de cuenta:</strong> ${escapeHtml(
              valueOrDash(payment.accountNumber),
            )}</p>
          </div>
          <div>
            <h4>Datos de contacto</h4>
            <p><strong>Correo:</strong> ${escapeHtml(
              valueOrDash(contact.email),
            )}</p>
            <p><strong>Numero telefonico:</strong> ${escapeHtml(
              valueOrDash(contact.phone),
            )}</p>
            <p><strong>Direccion:</strong> ${escapeHtml(
              valueOrDash(contact.address),
            )}</p>
          </div>
        </section>
      </div>
    </section>
  </body>
</html>`;
};
