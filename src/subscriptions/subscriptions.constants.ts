import { PlanType } from '@prisma/client';

export const SUBSCRIPTION_GRACE_PERIOD_DAYS = 5;

/**
 * Limite de uso por plan. Un valor `null` significa ilimitado; los limites
 * numericos por cantidad (quotes, templates, etc.) son topes inclusivos: se
 * bloquea cuando el uso actual alcanza el limite.
 */
export interface PlanLimits {
  /** Cotizaciones que se pueden crear por mes calendario. */
  maxQuotesPerMonth: number | null;
  maxTemplates: number | null;
  maxServices: number | null;
  maxFrequentClients: number | null;
  /** Miembros adicionales al dueno del workspace. */
  maxWorkspaceMembers: number | null;
  /** Si el plan puede exportar PDF. */
  exportPdf: boolean;
  /** Si los PDF exportados llevan marca de agua de MixQ. */
  pdfWatermark: boolean;
  /** Acceso a metricas avanzadas del workspace. */
  advancedMetrics: boolean;
}

export const FREE_LIMITS: PlanLimits = {
  maxQuotesPerMonth: 7,
  maxTemplates: 0,
  maxServices: 0,
  maxFrequentClients: 0,
  maxWorkspaceMembers: 0,
  exportPdf: true,
  pdfWatermark: true,
  advancedMetrics: false,
};

export const PRO_LIMITS: PlanLimits = {
  maxQuotesPerMonth: null,
  maxTemplates: 5,
  maxServices: 50,
  maxFrequentClients: 20,
  maxWorkspaceMembers: 0,
  exportPdf: true,
  pdfWatermark: false,
  advancedMetrics: false,
};

export const BUSINESS_LIMITS: PlanLimits = {
  maxQuotesPerMonth: null,
  maxTemplates: null,
  maxServices: null,
  maxFrequentClients: null,
  maxWorkspaceMembers: 20,
  exportPdf: true,
  pdfWatermark: false,
  advancedMetrics: true,
};

export type PaidPlanType = PlanType;

export type PlanCatalogItem = {
  plan: PlanType;
  name: string;
  currency: 'CLP';
  monthlyAmount: number;
  providerPlanId: string | null;
  limits: PlanLimits;
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
  | 'frequent_clients'
  | 'export_pdf'
  | 'workspace_members'
  | 'advanced_metrics';

/**
 * Plan minimo requerido por feature. Fuente de verdad compartida para los
 * mensajes de upgrade (`planRequired`) que devuelve el backend.
 */
export const FEATURE_MIN_PLAN: Record<SubscriptionFeature, PlanType> = {
  quotes: PlanType.FREE,
  export_pdf: PlanType.FREE,
  templates: PlanType.PRO,
  services: PlanType.PRO,
  frequent_clients: PlanType.PRO,
  workspace_members: PlanType.BUSINESS,
  advanced_metrics: PlanType.BUSINESS,
};
