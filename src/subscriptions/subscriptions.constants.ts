import { PlanType } from '@prisma/client';

export const SUBSCRIPTION_GRACE_PERIOD_DAYS = 5;

export const FREE_LIMITS = {
  maxQuotes: 5,
  maxTemplates: 1,
  maxServices: 10,
  maxWorkspaceMembers: 0,
  exportPdf: false,
} as const;

export const PRO_LIMITS = {
  maxQuotes: 500,
  maxTemplates: 25,
  maxServices: 500,
  maxWorkspaceMembers: 3,
  exportPdf: true,
} as const;

export const BUSINESS_LIMITS = {
  maxQuotes: 2_000,
  maxTemplates: 100,
  maxServices: 3_000,
  maxWorkspaceMembers: 20,
  exportPdf: true,
} as const;

export type PaidPlanType = PlanType;

export type PlanCatalogItem = {
  plan: PlanType;
  name: string;
  currency: 'CLP';
  monthlyAmount: number;
  providerPlanId: string | null;
  limits: typeof FREE_LIMITS | typeof PRO_LIMITS | typeof BUSINESS_LIMITS;
};

export const PLAN_CATALOG: Record<PlanType, PlanCatalogItem> = {
  [PlanType.FREE]: {
    plan: PlanType.FREE,
    name: 'Free',
    currency: 'CLP',
    monthlyAmount: 0,
    providerPlanId: null,
    limits: FREE_LIMITS,
  },
  [PlanType.PRO]: {
    plan: PlanType.PRO,
    name: 'Pro mensual',
    currency: 'CLP',
    monthlyAmount: Number(process.env.MIXQ_PRO_MONTHLY_PRICE_CLP ?? 14990),
    providerPlanId: process.env.FLOW_PRO_PLAN_ID ?? 'mixq_pro_monthly',
    limits: PRO_LIMITS,
  },
  [PlanType.BUSINESS]: {
    plan: PlanType.BUSINESS,
    name: 'Business mensual',
    currency: 'CLP',
    monthlyAmount: Number(process.env.MIXQ_BUSINESS_MONTHLY_PRICE_CLP ?? 39990),
    providerPlanId:
      process.env.FLOW_BUSINESS_PLAN_ID ?? 'mixq_business_monthly',
    limits: BUSINESS_LIMITS,
  },
};

export type SubscriptionFeature =
  | 'quotes'
  | 'templates'
  | 'services'
  | 'export_pdf'
  | 'workspace_members';
