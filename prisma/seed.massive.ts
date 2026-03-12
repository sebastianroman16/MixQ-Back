import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Prisma,
  PrismaClient,
  QuoteStatus,
  TemplateItemType,
  TemplateSectionType,
  TemplateType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  ),
});

const SEED_PREFIX = 'seed150+';
const SEED_DOMAIN = '@mixq.test';
const TOTAL_USERS = 150;
const BATCH_SIZE = 25;
const FIXED_PASSWORD = 'Test1234!';
const BCRYPT_ROUNDS = 10;
const DEFAULT_TAX_RATE = 19;

const FIRST_NAMES = [
  'Sebastian',
  'Matias',
  'Camila',
  'Valentina',
  'Javiera',
  'Francisco',
  'Felipe',
  'Ignacio',
  'Catalina',
  'Daniela',
  'Diego',
  'Nicolas',
  'Tomas',
  'Constanza',
  'Antonia',
  'Benjamin',
  'Pablo',
  'Cristobal',
  'Macarena',
  'Paula',
  'Jorge',
  'Rodrigo',
  'Vicente',
  'Andres',
];

const LAST_NAMES = [
  'Gonzalez',
  'Munoz',
  'Rojas',
  'Diaz',
  'Perez',
  'Soto',
  'Contreras',
  'Silva',
  'Martinez',
  'Sepulveda',
  'Morales',
  'Rodriguez',
  'Lopez',
  'Fuentes',
  'Hernandez',
  'Torres',
  'Araya',
];

const COMMUNES = [
  'Santiago Centro',
  'Providencia',
  'Nunoa',
  'Las Condes',
  'Vitacura',
  'Estacion Central',
  'Maipu',
  'La Florida',
  'San Miguel',
  'Independencia',
  'Quilicura',
  'Puente Alto',
];

const STREETS = [
  'Av. Alameda',
  'Av. Vicuna Mackenna',
  'Av. Apoquindo',
  'Av. Providencia',
  'Gran Avenida',
  'Av. Pajaritos',
  'Av. Recoleta',
  'Av. Matta',
  'Av. Grecia',
  'Av. Macul',
];

const GIROS = [
  'Servicios audiovisuales',
  'Produccion de eventos',
  'Servicios de marketing',
  'Desarrollo de software',
  'Servicios de limpieza',
  'Diseno grafico',
  'Servicios de mantencion',
  'Arriendo de equipos',
  'Fotografia y video',
  'Servicios de impresion',
  'Consultoria TI',
  'Catering y banqueteria',
];

const CATEGORY_POOL = [
  'Audiovisual',
  'Eventos',
  'Marketing',
  'Diseno',
  'Desarrollo',
  'Limpieza',
  'Mantencion',
  'Arriendo',
  'Impresion',
  'Consultoria',
  'Catering',
  'Logistica',
];

const SERVICE_TEMPLATES = [
  { name: 'Servicio de fotografia', base: 85000, minQ: 1, maxQ: 2 },
  { name: 'Servicio de video Full HD', base: 140000, minQ: 1, maxQ: 2 },
  { name: 'Edicion de video', base: 65000, minQ: 1, maxQ: 6 },
  { name: 'Diseno de pieza grafica', base: 25000, minQ: 1, maxQ: 10 },
  { name: 'Community management', base: 180000, minQ: 1, maxQ: 1 },
  { name: 'Landing page', base: 220000, minQ: 1, maxQ: 1 },
  { name: 'Mantencion mensual', base: 90000, minQ: 1, maxQ: 1 },
  { name: 'Aseo departamento 2-3 hrs', base: 28000, minQ: 1, maxQ: 2 },
  { name: 'Aseo profundo', base: 55000, minQ: 1, maxQ: 1 },
  { name: 'Arriendo camara + lente', base: 45000, minQ: 1, maxQ: 3 },
  { name: 'Arriendo iluminacion', base: 35000, minQ: 1, maxQ: 4 },
  { name: 'Soporte tecnico', base: 30000, minQ: 1, maxQ: 8 },
  { name: 'Impresion flyers 100u', base: 18000, minQ: 1, maxQ: 10 },
  { name: 'Traslado logistica', base: 15000, minQ: 1, maxQ: 6 },
];

type RNG = () => number;

type Counters = {
  users: number;
  senderProfiles: number;
  categories: number;
  services: number;
  templates: number;
  templateSections: number;
  templateItems: number;
  quotes: number;
  quoteItems: number;
  quoteSections: number;
  quoteSectionItems: number;
  skippedUsers: number;
  failedUsers: number;
};

type CreatedBundle = {
  users: number;
  senderProfiles: number;
  categories: number;
  services: number;
  templates: number;
  templateSections: number;
  templateItems: number;
  quotes: number;
  quoteItems: number;
  quoteSections: number;
  quoteSectionItems: number;
};

type CreateUserBundleResult =
  | { skipped: true }
  | { skipped: false; created: CreatedBundle };

function nowMs(): number {
  return Date.now();
}

function msToHuman(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return m > 0 ? `${m}m ${rs}s` : `${rs}s`;
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: RNG, arr: T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}

function chance(rng: RNG, p: number): boolean {
  return rng() < p;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function makeEmail(i: number): string {
  return `${SEED_PREFIX}${pad4(i)}${SEED_DOMAIN}`;
}

function makePerson(rng: RNG): { first: string; last: string; full: string } {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  return { first, last, full: `${first} ${last}` };
}

function makePhoneCL(rng: RNG): string {
  const a = randInt(rng, 1000, 9999);
  const b = randInt(rng, 1000, 9999);
  return `+56 9 ${a} ${b}`;
}

function makeAddress(rng: RNG): string {
  const street = pick(rng, STREETS);
  const num = randInt(rng, 100, 9999);
  const commune = pick(rng, COMMUNES);
  return `${street} ${num}, ${commune}, Santiago, Chile`;
}

function makeRut(rng: RNG): string {
  const n1 = randInt(rng, 10, 25);
  const n2 = randInt(rng, 100, 999);
  const n3 = randInt(rng, 100, 999);
  const dv = randInt(rng, 0, 9);
  return `${n1}.${n2}.${n3}-${dv}`;
}

function pickStatus(rng: RNG): QuoteStatus {
  const roll = rng();
  if (roll < 0.25) return 'DRAFT';
  if (roll < 0.6) return 'SENT';
  if (roll < 0.8) return 'ACCEPTED';
  if (roll < 0.9) return 'REJECTED';
  return 'CANCELLED';
}

function makeIssuedDates(rng: RNG): { issuedAt: Date; validUntil: Date } {
  const daysAgo = randInt(rng, 0, 180);
  const issuedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const validDays = randInt(rng, 7, 30);
  const validUntil = new Date(issuedAt.getTime() + validDays * 24 * 60 * 60 * 1000);
  return { issuedAt, validUntil };
}

function makeClientData(rng: RNG) {
  const person = makePerson(rng);
  return {
    name: chance(rng, 0.55) ? `Empresa ${pick(rng, LAST_NAMES)} SpA` : person.full,
    rut: chance(rng, 0.6) ? makeRut(rng) : '',
    giro: pick(rng, GIROS),
    email: `cliente.${randInt(rng, 1000, 9999)}@mail.test`,
    address: makeAddress(rng),
  };
}

function makeEventData(rng: RNG) {
  if (!chance(rng, 0.45)) return null;
  return {
    personInCharge: makePerson(rng).full,
    phone: makePhoneCL(rng),
    email: `evento.${randInt(rng, 1000, 9999)}@mail.test`,
    date: new Date(Date.now() + randInt(rng, 1, 90) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    address: `${pick(rng, COMMUNES)}, Santiago`,
  };
}

function makePaymentData(rng: RNG) {
  return {
    beneficiaryName: makePerson(rng).full,
    rut: makeRut(rng),
    bank: pick(rng, ['Banco de Chile', 'Santander', 'BCI', 'Estado']),
    accountType: pick(rng, ['Cuenta Corriente', 'Cuenta Vista']),
    accountNumber: String(randInt(rng, 10000000, 999999999)),
  };
}

function makeContactData(rng: RNG) {
  return {
    email: `contacto.${randInt(rng, 1000, 9999)}@mixq.test`,
    phone: makePhoneCL(rng),
    address: makeAddress(rng),
  };
}

function computeTotals(itemTotals: number[], discountRate: number, taxRate: number) {
  const subtotal = Math.round(itemTotals.reduce((a, b) => a + b, 0));
  const discount = Math.round(subtotal * discountRate);
  const netTotal = Math.round(subtotal - discount);
  const taxTotal = Math.round(netTotal * (taxRate / 100));
  const total = Math.round(netTotal + taxTotal);
  return { subtotal, discount, netTotal, taxTotal, total };
}

async function resetSeedOnly(): Promise<void> {
  const t0 = nowMs();
  console.log('Reset: eliminando datos seed...');

  const seedUsers = await prisma.user.findMany({
    where: { email: { startsWith: SEED_PREFIX, endsWith: SEED_DOMAIN } },
    select: { id: true },
  });

  const userIds = seedUsers.map((u) => u.id);
  if (!userIds.length) {
    console.log('No hay usuarios seed para borrar.');
    return;
  }

  await prisma.quoteSectionItem.deleteMany({
    where: { section: { quote: { userId: { in: userIds } } } },
  });
  await prisma.quoteSection.deleteMany({
    where: { quote: { userId: { in: userIds } } },
  });
  await prisma.quoteItem.deleteMany({
    where: { quote: { userId: { in: userIds } } },
  });
  await prisma.quote.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.templateItem.deleteMany({
    where: { section: { template: { userId: { in: userIds } } } },
  });
  await prisma.templateSection.deleteMany({
    where: { template: { userId: { in: userIds } } },
  });
  await prisma.template.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.service.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.category.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.senderProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(`Reset completado (${userIds.length} usuarios) en ${msToHuman(nowMs() - t0)}.`);
}

async function createUserBundle(
  userIndex: number,
  passwordHash: string,
): Promise<CreateUserBundleResult> {
  const rng = mulberry32(100000 + userIndex);
  const email = makeEmail(userIndex);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { skipped: true };
  }

  const person = makePerson(rng);
  const displayName = `${person.first} ${person.last}`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: displayName,
      onboardingCompleted: true,
    },
    select: { id: true },
  });

  await prisma.senderProfile.create({
    data: {
      userId: user.id,
      displayName,
      contactEmail: email,
      contactPhone: makePhoneCL(rng),
      address: makeAddress(rng),
      legalName: `${displayName} SpA`,
      rut: makeRut(rng),
      giro: pick(rng, GIROS),
      logoUrl: chance(rng, 0.35) ? `https://picsum.photos/seed/mixq-${userIndex}/256/256` : null,
    },
  });

  const catCount = randInt(rng, 3, 8);
  const catNames = new Set<string>();
  while (catNames.size < catCount) catNames.add(pick(rng, CATEGORY_POOL));

  await prisma.category.createMany({
    data: [...catNames].map((name) => ({ userId: user.id, name })),
  });

  const categories = await prisma.category.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const serviceCount = randInt(rng, 20, 60);
  const servicesData: Array<{
    userId: string;
    categoryId: string;
    inventoryCode: string;
    name: string;
    description: string | null;
    unitPrice: number;
    quantity: number;
  }> = [];

  for (let i = 1; i <= serviceCount; i++) {
    const tpl = pick(rng, SERVICE_TEMPLATES);
    const variance = 1 + (rng() * 2 - 1) * 0.35;
    const unitPrice = clamp(Math.round(tpl.base * variance), 5000, 450000);
    const quantity = randInt(rng, tpl.minQ, tpl.maxQ);
    servicesData.push({
      userId: user.id,
      categoryId: pick(rng, categories).id,
      inventoryCode: `U${pad4(userIndex)}-S${String(i).padStart(3, '0')}`,
      name: tpl.name,
      description: chance(rng, 0.35) ? 'Incluye coordinacion y ejecucion segun alcance.' : null,
      unitPrice,
      quantity,
    });
  }

  await prisma.service.createMany({ data: servicesData });

  const services = await prisma.service.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, unitPrice: true, quantity: true },
  });

  const templateCount = randInt(rng, 2, 4);
  const templateIds: string[] = [];
  let templateSectionsCount = 0;
  let templateItemsCount = 0;

  for (let t = 1; t <= templateCount; t++) {
    const template = await prisma.template.create({
      data: {
        userId: user.id,
        type: TemplateType.USER,
        name: `Plantilla ${t} - ${displayName}`,
        isDefault: t === 1,
        isActive: true,
      },
      select: { id: true },
    });

    templateIds.push(template.id);

    const sections: Array<{ type: TemplateSectionType; title: string; position: number }> = [
      { type: 'HEADER', title: 'Encabezado', position: 1 },
      { type: 'CLIENT', title: 'Cliente', position: 2 },
      { type: 'TABLE', title: 'Detalle', position: 3 },
      { type: 'TOTALS', title: 'Totales', position: 4 },
    ];

    if (chance(rng, 0.55)) sections.push({ type: 'EVENT', title: 'Evento', position: sections.length + 1 });
    if (chance(rng, 0.6)) sections.push({ type: 'PAYMENT', title: 'Pago', position: sections.length + 1 });
    if (chance(rng, 0.5)) sections.push({ type: 'TERMS', title: 'Terminos', position: sections.length + 1 });
    if (chance(rng, 0.7)) sections.push({ type: 'CONTACT', title: 'Contacto', position: sections.length + 1 });

    for (const sectionData of sections) {
      const section = await prisma.templateSection.create({
        data: {
          templateId: template.id,
          title: sectionData.title,
          type: sectionData.type,
          position: sectionData.position,
        },
        select: { id: true, type: true },
      });
      templateSectionsCount++;

      const itemsForSection: Array<{ label: string; value: string; type: TemplateItemType }> = [];

      if (section.type === 'HEADER') {
        itemsForSection.push({ label: 'Titulo', value: 'Cotizacion', type: 'TEXT' });
      } else if (section.type === 'CLIENT') {
        itemsForSection.push({ label: 'Nombre', value: '{{client.name}}', type: 'FIELD' });
        itemsForSection.push({ label: 'Email', value: '{{client.email}}', type: 'FIELD' });
      } else if (section.type === 'TABLE') {
        itemsForSection.push({ label: 'Item', value: 'item', type: 'TABLE_COLUMN' });
        itemsForSection.push({ label: 'Cantidad', value: 'qty', type: 'TABLE_COLUMN' });
        itemsForSection.push({ label: 'Precio', value: 'price', type: 'TABLE_COLUMN' });
      } else if (section.type === 'TOTALS') {
        itemsForSection.push({ label: 'IVA', value: String(DEFAULT_TAX_RATE), type: 'FIELD' });
      } else if (section.type === 'EVENT') {
        itemsForSection.push({ label: 'Evento', value: '{{event.date}}', type: 'FIELD' });
      } else if (section.type === 'PAYMENT') {
        itemsForSection.push({ label: 'Banco', value: '{{payment.bank}}', type: 'FIELD' });
      } else if (section.type === 'TERMS') {
        itemsForSection.push({ label: 'Condicion', value: 'Validez 15 dias', type: 'TEXT' });
      } else if (section.type === 'CONTACT') {
        itemsForSection.push({ label: 'Telefono', value: '{{contact.phone}}', type: 'FIELD' });
      }

      for (let i = 0; i < itemsForSection.length; i++) {
        await prisma.templateItem.create({
          data: {
            sectionId: section.id,
            label: itemsForSection[i].label,
            value: itemsForSection[i].value,
            type: itemsForSection[i].type,
            position: i + 1,
          },
        });
        templateItemsCount++;
      }
    }
  }

  const quotesCount = randInt(rng, 12, 40);
  let quoteItemsCount = 0;
  let quoteSectionsCount = 0;
  let quoteSectionItemsCount = 0;

  for (let q = 1; q <= quotesCount; q++) {
    const status = pickStatus(rng);
    const dates = makeIssuedDates(rng);

    const selectedServices = new Map<string, (typeof services)[number]>();
    const targetItems = randInt(rng, 2, 8);
    while (selectedServices.size < Math.min(targetItems, services.length)) {
      const s = pick(rng, services);
      selectedServices.set(s.id, s);
    }

    const quoteItemsData: Array<{
      serviceId: string;
      title: string;
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
      position: number;
    }> = [];

    const itemTotals: number[] = [];
    let pos = 1;
    for (const s of selectedServices.values()) {
      const quantity = clamp(s.quantity + randInt(rng, -1, 3), 1, 30);
      const unitPrice = Number(s.unitPrice);
      const total = Math.round(unitPrice * quantity);
      itemTotals.push(total);
      quoteItemsData.push({
        serviceId: s.id,
        title: s.name,
        description: 'Servicio segun alcance acordado.',
        quantity,
        unitPrice,
        total,
        position: pos++,
      });
    }

    const discountRate = chance(rng, 0.35) ? randInt(rng, 2, 12) / 100 : 0;
    const totals = computeTotals(itemTotals, discountRate, DEFAULT_TAX_RATE);

    const quote = await prisma.quote.create({
      data: {
        userId: user.id,
        templateId: pick(rng, templateIds),
        quoteNumber: `Q-${pad4(userIndex)}-${String(q).padStart(4, '0')}`,
        title: `Cotizacion ${q} ${displayName}`,
        subtitle: chance(rng, 0.5) ? 'Propuesta de servicios' : null,
        description: chance(rng, 0.5) ? 'Documento generado para cliente.' : null,
        termsText: chance(rng, 0.5) ? 'Valores sujetos a disponibilidad.' : null,
        status,
        clientData: makeClientData(rng),
        eventData: makeEventData(rng) ?? Prisma.JsonNull,
        paymentData: makePaymentData(rng),
        contactData: makeContactData(rng),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxRate: DEFAULT_TAX_RATE,
        netTotal: totals.netTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        issuedAt: dates.issuedAt,
        validUntil: dates.validUntil,
      },
      select: { id: true, templateId: true },
    });

    await prisma.quoteItem.createMany({
      data: quoteItemsData.map((it) => ({
        quoteId: quote.id,
        serviceId: it.serviceId,
        title: it.title,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
        position: it.position,
      })),
    });
    quoteItemsCount += quoteItemsData.length;

    if (quote.templateId) {
      const tplSections = await prisma.templateSection.findMany({
        where: { templateId: quote.templateId },
        include: { items: true },
        orderBy: { position: 'asc' },
      });

      for (const tplSection of tplSections) {
        const quoteSection = await prisma.quoteSection.create({
          data: {
            quoteId: quote.id,
            title: tplSection.title,
            type: tplSection.type,
            position: tplSection.position,
          },
          select: { id: true },
        });
        quoteSectionsCount++;

        if (tplSection.items.length) {
          await prisma.quoteSectionItem.createMany({
            data: tplSection.items.map((item) => ({
              sectionId: quoteSection.id,
              label: item.label,
              value: item.value,
              type: item.type,
              position: item.position,
            })),
          });
          quoteSectionItemsCount += tplSection.items.length;
        }
      }
    }
  }

  return {
    skipped: false,
    created: {
      users: 1,
      senderProfiles: 1,
      categories: categories.length,
      services: services.length,
      templates: templateCount,
      templateSections: templateSectionsCount,
      templateItems: templateItemsCount,
      quotes: quotesCount,
      quoteItems: quoteItemsCount,
      quoteSections: quoteSectionsCount,
      quoteSectionItems: quoteSectionItemsCount,
    },
  };
}

async function main(): Promise<void> {
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) {
    await resetSeedOnly();
    return;
  }

  const t0 = nowMs();
  const counters: Counters = {
    users: 0,
    senderProfiles: 0,
    categories: 0,
    services: 0,
    templates: 0,
    templateSections: 0,
    templateItems: 0,
    quotes: 0,
    quoteItems: 0,
    quoteSections: 0,
    quoteSectionItems: 0,
    skippedUsers: 0,
    failedUsers: 0,
  };

  console.log('Seed masivo iniciado');
  console.log(`Usuarios objetivo: ${TOTAL_USERS}`);

  const passwordHash = await bcrypt.hash(FIXED_PASSWORD, BCRYPT_ROUNDS);

  for (let start = 1; start <= TOTAL_USERS; start += BATCH_SIZE) {
    const end = Math.min(TOTAL_USERS, start + BATCH_SIZE - 1);
    console.log(`Lote ${start}-${end}`);

    for (let i = start; i <= end; i++) {
      try {
        const res = await createUserBundle(i, passwordHash);
        if (res.skipped) {
          counters.skippedUsers++;
          continue;
        }
        const created = res.created;
        counters.users += created.users;
        counters.senderProfiles += created.senderProfiles;
        counters.categories += created.categories;
        counters.services += created.services;
        counters.templates += created.templates;
        counters.templateSections += created.templateSections;
        counters.templateItems += created.templateItems;
        counters.quotes += created.quotes;
        counters.quoteItems += created.quoteItems;
        counters.quoteSections += created.quoteSections;
        counters.quoteSectionItems += created.quoteSectionItems;
      } catch (error) {
        counters.failedUsers++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error usuario ${makeEmail(i)}: ${message}`);
      }
    }
  }

  console.log('Seed finalizado');
  console.log(`Usuarios creados: ${counters.users}`);
  console.log(`Usuarios omitidos: ${counters.skippedUsers}`);
  console.log(`Usuarios fallidos: ${counters.failedUsers}`);
  console.log(`Sender profiles: ${counters.senderProfiles}`);
  console.log(`Categorias: ${counters.categories}`);
  console.log(`Servicios: ${counters.services}`);
  console.log(`Plantillas: ${counters.templates}`);
  console.log(`Secciones plantilla: ${counters.templateSections}`);
  console.log(`Items plantilla: ${counters.templateItems}`);
  console.log(`Cotizaciones: ${counters.quotes}`);
  console.log(`Items cotizacion: ${counters.quoteItems}`);
  console.log(`Secciones cotizacion: ${counters.quoteSections}`);
  console.log(`Items seccion cotizacion: ${counters.quoteSectionItems}`);
  console.log(`Tiempo total: ${msToHuman(nowMs() - t0)}`);
}

main()
  .catch((error) => {
    console.error('Seed fatal:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
