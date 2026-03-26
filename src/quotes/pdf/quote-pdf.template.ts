import { Prisma } from '@prisma/client';
import { calculateQuoteTotals } from '../utils/quote-totals';

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
  senderProfileSnapshot?: Prisma.JsonValue | null;
  items: QuotePdfItem[];
  logoUrl: string | null;
  sections?: QuotePdfSection[];
  templateName?: string | null;
  templateTheme?: Prisma.JsonValue | null;
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

const asUnknownRecord = (value: Prisma.JsonValue | null) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asThemeString = (
  theme: Record<string, unknown>,
  key: string,
  fallback: string,
) => {
  const value = theme[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const asThemeNumber = (
  theme: Record<string, unknown>,
  key: string,
  fallback: number,
) => {
  const value = Number(theme[key]);
  return Number.isFinite(value) ? value : fallback;
};

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
  const sender = asRecord(quote.senderProfileSnapshot ?? null);
  const issuedAt = formatDate(quote.issuedAt);
  const validUntil = formatDate(quote.validUntil);
  const eventDate = valueOrDash(event.date);
  const templateName = quote.templateName ?? '';
  const headerAddress = sender.address || '';
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
  const theme = asUnknownRecord(quote.templateTheme ?? null);
  const themeSheet = asThemeString(theme, 'sheet', '#ffffff');
  const themeText = asThemeString(theme, 'text', '#0f172a');
  const themeMuted = asThemeString(theme, 'muted', '#475569');
  const themeBorder = asThemeString(theme, 'border', '#e2e8f0');
  const themeHeaderBg = asThemeString(theme, 'headerBg', '#0f172a');
  const themeHeaderText = asThemeString(theme, 'headerText', '#ffffff');
  const themeAccent = asThemeString(theme, 'accent', '#5A6FF0');
  const backgroundImage = asThemeString(theme, 'backgroundImage', '');
  const backgroundSizeRaw = asThemeNumber(theme, 'backgroundSize', 100);
  const backgroundSize = Math.max(20, Math.min(200, backgroundSizeRaw));
  const overlayRaw = asThemeNumber(theme, 'backgroundOverlay', 0);
  const overlay = Math.max(0, Math.min(100, overlayRaw)) / 100;
  const backgroundImageCss = backgroundImage
    ? `linear-gradient(rgba(255,255,255,${overlay}), rgba(255,255,255,${overlay})), url('${backgroundImage.replace(/'/g, '%27')}')`
    : `linear-gradient(rgba(255,255,255,${overlay}), rgba(255,255,255,${overlay}))`;
  const taxRate =
    quote.taxRate !== null && quote.taxRate !== undefined
      ? toNumber(quote.taxRate)
      : 19;
  const discount = quote.discount ? toNumber(quote.discount) : 0;

  const totals = calculateQuoteTotals(quote.items, discount, taxRate);
  const subtotal = totals.subtotal;
  const netTotal = totals.netTotal;
  const taxTotal = totals.taxTotal;
  const total = totals.total;

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
      @page {
        size: A4;
        margin: 8mm;
      }
      html, body { width: 100%; }
      h1, h2, h3, h4, p { margin: 0; }
      body {
        margin: 0;
        padding: 0;
        font-family: "Helvetica Neue", Arial, sans-serif;
        color: ${escapeHtml(themeText)};
        background: #ffffff;
        font-size: 12px;
        line-height: 1.25;
      }
      .preview {
        min-height: calc(297mm - 16mm);
      }
      .preview__sheet {
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.14);
        background: ${backgroundImageCss};
        background-color: ${escapeHtml(themeSheet)};
        background-size: ${backgroundSize}%;
        background-position: center;
        background-repeat: no-repeat;
        color: ${escapeHtml(themeText)};
        padding: 10px;
        min-height: calc(297mm - 16mm);
        display: flex;
        flex-direction: column;
      }
      .preview__header {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 0.45rem;
        border-bottom: 1px solid ${escapeHtml(themeBorder)};
        padding-bottom: 0.35rem;
      }
      .preview__header-content { grid-column: 2; min-width: 0; }
      .preview__header-meta { grid-column: 3; justify-self: end; }
      .preview__title { font-size: 1.02rem; font-weight: 700; line-height: 1.1; text-align: center; }
      .preview__subtitle { font-size: 0.72rem; color: ${escapeHtml(themeMuted)}; margin-top: 0.1rem; text-align: center; }
      .preview__quote-number {
        font-size: 0.66rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.11em;
      }
      .preview__hero {
        margin-top: 0.42rem;
        display: flex;
        flex-wrap: nowrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .preview__hero-content {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 0.18rem;
        min-width: 0;
      }
      .preview__hero-title { font-size: 0.9rem; font-weight: 600; line-height: 1.2; }
      .preview__hero-text { font-size: 0.74rem; color: ${escapeHtml(themeMuted)}; line-height: 1.28; }
      .preview__multiline { white-space: pre-line; }
      .preview__logo {
        display: flex;
        height: 2.8rem;
        width: 2.8rem;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        border-radius: 9999px;
        border: 1px solid ${escapeHtml(themeBorder)};
        font-size: 0.62rem;
        color: ${escapeHtml(themeMuted)};
      }
      .preview__logo img { height: 100%; width: 100%; border-radius: 9999px; object-fit: cover; }
      .preview__info { margin-top: 0.55rem; display: grid; gap: 0.65rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .preview__info h4 {
        font-size: 0.62rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: ${escapeHtml(themeMuted)};
        margin-bottom: 0.14rem;
      }
      .preview__info p { font-size: 0.66rem; color: ${escapeHtml(themeText)}; line-height: 1.22; margin-top: 0.08rem; }
      .preview__table {
        margin-top: 0.6rem;
        border: 1px solid ${escapeHtml(themeBorder)};
        border-radius: 0.34rem;
        overflow: hidden;
      }
      .preview__table-head {
        display: grid;
        grid-template-columns: 1.4fr 2fr 0.6fr 0.8fr 0.8fr;
        gap: 0;
        padding: 0.3rem 0.5rem;
        font-size: 0.57rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: ${escapeHtml(themeHeaderBg)};
        color: ${escapeHtml(themeHeaderText)};
      }
      .preview__table-head > * {
        padding: 0 0.2rem;
      }
      .preview__table-head > * + * {
        border-left: 1px solid rgba(255, 255, 255, 0.18);
        padding-left: 0.38rem;
      }
      .preview__table-row {
        display: grid;
        grid-template-columns: 1.4fr 2fr 0.6fr 0.8fr 0.8fr;
        gap: 0;
        border-top: 1px solid ${escapeHtml(themeBorder)};
        padding: 0.33rem 0.5rem;
        font-size: 0.66rem;
        line-height: 1.2;
      }
      .preview__table-row > * {
        padding: 0 0.2rem;
      }
      .preview__table-row > * + * {
        border-left: 1px solid ${escapeHtml(themeBorder)};
        padding-left: 0.38rem;
      }
      .preview__table-title { font-weight: 600; color: ${escapeHtml(themeText)}; }
      .preview__table-desc { font-size: 0.6rem; color: ${escapeHtml(themeMuted)}; line-height: 1.2; margin-top: 0.05rem; }
      .preview__totals { margin-top: 0.6rem; display: grid; gap: 0.7rem; grid-template-columns: 1.6fr 1fr; }
      .preview__terms h4,
      .preview__footer h4 {
        font-size: 0.62rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: ${escapeHtml(themeMuted)};
      }
      .preview__terms p,
      .preview__footer p {
        margin-top: 0.14rem;
        font-size: 0.65rem;
        line-height: 1.2;
        color: ${escapeHtml(themeText)};
      }
      .preview__terms-text { white-space: pre-line; }
      .preview__totals-box {
        border-radius: 0.42rem;
        border: 1px solid ${escapeHtml(themeBorder)};
        padding: 0.36rem 0.45rem;
        font-size: 0.65rem;
        color: ${escapeHtml(themeText)};
      }
      .preview__totals-box div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.35rem;
        border-bottom: 1px solid ${escapeHtml(themeBorder)};
        padding: 0.2rem 0;
      }
      .preview__totals-box div:last-child { border-bottom: 0; }
      .preview__totals-total { color: ${escapeHtml(themeAccent)}; }
      .preview__footer { margin-top: 0.6rem; display: grid; gap: 0.7rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .preview__bottom {
        margin-top: auto;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .preview__header,
      .preview__hero,
      .preview__info,
      .preview__totals,
      .preview__footer {
        break-inside: avoid;
        page-break-inside: avoid;
      }
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
          <div class="preview__hero-content">
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

        <section class="preview__bottom">
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
        </section>
      </div>
    </section>
  </body>
</html>`;
};
