import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, TemplateItemType, TemplateSectionType, TemplateType } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  ),
});

async function main() {
  const name = 'Cotizacion Estudio White Ltda';
  const existing = await prisma.template.findFirst({
    where: {
      type: TemplateType.SYSTEM,
      name,
    },
  });

  if (existing) {
    return;
  }

  await prisma.template.create({
    data: {
      type: TemplateType.SYSTEM,
      name,
      isDefault: true,
      isActive: true,
      sections: {
        create: [
          {
            title: 'Header',
            type: TemplateSectionType.HEADER,
            position: 0,
            items: {
              create: [
                {
                  label: 'Titulo',
                  value: 'Cotizacion Estudio White Ltda',
                  type: TemplateItemType.TEXT,
                  position: 0,
                },
                {
                  label: 'Direccion',
                  value: 'Moneda 1479, Of 21, Santiago Centro',
                  type: TemplateItemType.TEXT,
                  position: 1,
                },
                {
                  label: 'Numero',
                  value: 'Cotizacion N° 001',
                  type: TemplateItemType.FIELD,
                  position: 2,
                },
                {
                  label: 'Logo',
                  value: 'LOGO_URL',
                  type: TemplateItemType.FIELD,
                  position: 3,
                },
              ],
            },
          },
          {
            title: 'Subtitulo',
            type: TemplateSectionType.SUBTITLE,
            position: 1,
            items: {
              create: [
                {
                  label: 'Subtitulo',
                  value: 'Colegio San Antonio de Colina',
                  type: TemplateItemType.TEXT,
                  position: 0,
                },
                {
                  label: 'Descripcion',
                  value: 'Fiesta costumbrista septiembre Colegio San Antonio',
                  type: TemplateItemType.TEXT,
                  position: 1,
                },
              ],
            },
          },
          {
            title: 'Cliente',
            type: TemplateSectionType.CLIENT,
            position: 2,
            items: {
              create: [
                {
                  label: 'Nombre o Razon Social',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 0,
                },
                {
                  label: 'RUT',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 1,
                },
                {
                  label: 'Giro',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 2,
                },
                {
                  label: 'Correo',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 3,
                },
                {
                  label: 'Direccion',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 4,
                },
                {
                  label: 'Fecha Cotizacion',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 5,
                },
                {
                  label: 'Valido hasta',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 6,
                },
              ],
            },
          },
          {
            title: 'Evento',
            type: TemplateSectionType.EVENT,
            position: 3,
            items: {
              create: [
                {
                  label: 'Persona a Cargo',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 0,
                },
                {
                  label: 'Telefono',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 1,
                },
                {
                  label: 'Correo Electronico',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 2,
                },
                {
                  label: 'Fecha Evento',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 3,
                },
                {
                  label: 'Direccion Evento',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 4,
                },
              ],
            },
          },
          {
            title: 'Tabla',
            type: TemplateSectionType.TABLE,
            position: 4,
            items: {
              create: [
                {
                  label: 'Servicio',
                  value: '',
                  type: TemplateItemType.TABLE_COLUMN,
                  position: 0,
                },
                {
                  label: 'Descripcion',
                  value: '',
                  type: TemplateItemType.TABLE_COLUMN,
                  position: 1,
                },
                {
                  label: 'Cant.',
                  value: '',
                  type: TemplateItemType.TABLE_COLUMN,
                  position: 2,
                },
                {
                  label: 'Precio',
                  value: '',
                  type: TemplateItemType.TABLE_COLUMN,
                  position: 3,
                },
                {
                  label: 'Subtotal',
                  value: '',
                  type: TemplateItemType.TABLE_COLUMN,
                  position: 4,
                },
              ],
            },
          },
          {
            title: 'Totales',
            type: TemplateSectionType.TOTALS,
            position: 5,
            items: {
              create: [
                {
                  label: 'Subtotal',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 0,
                },
                {
                  label: 'Descuento',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 1,
                },
                {
                  label: 'Total Neto',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 2,
                },
                {
                  label: 'IVA 19%',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 3,
                },
                {
                  label: 'Total',
                  value: '',
                  type: TemplateItemType.FIELD,
                  position: 4,
                },
              ],
            },
          },
          {
            title: 'Terminos',
            type: TemplateSectionType.TERMS,
            position: 6,
            items: {
              create: [
                {
                  label: 'Terminos',
                  value: 'Texto de terminos...',
                  type: TemplateItemType.TEXT,
                  position: 0,
                },
              ],
            },
          },
          {
            title: 'Pago',
            type: TemplateSectionType.PAYMENT,
            position: 7,
            items: {
              create: [
                {
                  label: 'Informacion de pago',
                  value: 'Datos bancarios...',
                  type: TemplateItemType.TEXT,
                  position: 0,
                },
              ],
            },
          },
          {
            title: 'Contacto',
            type: TemplateSectionType.CONTACT,
            position: 8,
            items: {
              create: [
                {
                  label: 'Contacto',
                  value: 'contacto@empresa.com',
                  type: TemplateItemType.TEXT,
                  position: 0,
                },
              ],
            },
          },
        ],
      },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
