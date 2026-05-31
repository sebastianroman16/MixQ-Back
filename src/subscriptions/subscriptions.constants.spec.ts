import { PlanType } from '@prisma/client';
import {
  PLAN_CATALOG,
  SUBSCRIPTION_GRACE_PERIOD_DAYS,
} from './subscriptions.constants';

describe('PLAN_CATALOG', () => {
  it('defines monthly paid plans with CLP amounts and Flow plan IDs', () => {
    expect(PLAN_CATALOG[PlanType.FREE].monthlyAmount).toBe(0);
    expect(PLAN_CATALOG[PlanType.PRO].currency).toBe('CLP');
    expect(PLAN_CATALOG[PlanType.PRO].monthlyAmount).toBeGreaterThan(0);
    expect(PLAN_CATALOG[PlanType.PRO].providerPlanId).toBeTruthy();
    expect(PLAN_CATALOG[PlanType.BUSINESS].monthlyAmount).toBeGreaterThan(
      PLAN_CATALOG[PlanType.PRO].monthlyAmount,
    );
  });

  it('keeps a local grace period after provider due dates', () => {
    expect(SUBSCRIPTION_GRACE_PERIOD_DAYS).toBeGreaterThanOrEqual(3);
  });
});
