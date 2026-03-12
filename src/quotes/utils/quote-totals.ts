import { Prisma } from '@prisma/client';

export const DISCOUNT_EXCEEDS_SUBTOTAL = 'Discount exceeds subtotal';

type QuoteTotalsItem = {
  quantity: number;
  unitPrice: Prisma.Decimal | number | string;
};

export type QuoteTotals = {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  netTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

export function calculateQuoteTotals(
  items: QuoteTotalsItem[],
  discount?: Prisma.Decimal | number | string | null,
  taxRate?: Prisma.Decimal | number | string | null,
): QuoteTotals {
  const subtotal = items.reduce(
    (acc, item) => acc.plus(new Prisma.Decimal(item.unitPrice).mul(item.quantity)),
    new Prisma.Decimal(0),
  );

  const discountValue = new Prisma.Decimal(discount ?? 0);
  if (discountValue.greaterThan(subtotal)) {
    throw new Error(DISCOUNT_EXCEEDS_SUBTOTAL);
  }

  const netTotal = subtotal.minus(discountValue);
  const taxRateValue = new Prisma.Decimal(taxRate ?? 0);
  const taxTotal = netTotal.mul(taxRateValue).div(100);
  const total = netTotal.plus(taxTotal);

  return {
    subtotal,
    discount: discountValue,
    taxRate: taxRateValue,
    netTotal,
    taxTotal,
    total,
  };
}
