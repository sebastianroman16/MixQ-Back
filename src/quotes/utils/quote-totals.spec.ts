import {
  calculateQuoteTotals,
  DISCOUNT_EXCEEDS_SUBTOTAL,
} from './quote-totals';

describe('calculateQuoteTotals', () => {
  it('calculates subtotal, net, tax and total with tax included', () => {
    const totals = calculateQuoteTotals(
      [
        { quantity: 2, unitPrice: 10000 },
        { quantity: 1, unitPrice: 5000 },
      ],
      1000,
      19,
    );

    expect(totals.subtotal.toNumber()).toBe(25000);
    expect(totals.discount.toNumber()).toBe(1000);
    expect(totals.netTotal.toNumber()).toBe(24000);
    expect(totals.taxTotal.toNumber()).toBe(4560);
    expect(totals.total.toNumber()).toBe(28560);
  });

  it('supports zero tax rate', () => {
    const totals = calculateQuoteTotals(
      [{ quantity: 3, unitPrice: 2000 }],
      500,
      0,
    );

    expect(totals.subtotal.toNumber()).toBe(6000);
    expect(totals.netTotal.toNumber()).toBe(5500);
    expect(totals.taxTotal.toNumber()).toBe(0);
    expect(totals.total.toNumber()).toBe(5500);
  });

  it('throws when discount is greater than subtotal', () => {
    expect(() =>
      calculateQuoteTotals([{ quantity: 1, unitPrice: 1000 }], 1001, 19),
    ).toThrow(DISCOUNT_EXCEEDS_SUBTOTAL);
  });
});
