export const FREE_LIMITS = {
  maxQuotes: 3,
  maxTemplates: 1,
  maxServices: 5,
  maxWorkspaceMembers: 0,
  exportPdf: false,
} as const;

export const PRO_LIMITS = {
  maxQuotes: Number.POSITIVE_INFINITY,
  maxTemplates: Number.POSITIVE_INFINITY,
  maxServices: Number.POSITIVE_INFINITY,
  maxWorkspaceMembers: 3,
  exportPdf: true,
} as const;

export const BUSINESS_LIMITS = {
  maxQuotes: Number.POSITIVE_INFINITY,
  maxTemplates: Number.POSITIVE_INFINITY,
  maxServices: Number.POSITIVE_INFINITY,
  maxWorkspaceMembers: 10,
  exportPdf: true,
} as const;

export type SubscriptionFeature =
  | 'quotes'
  | 'templates'
  | 'services'
  | 'export_pdf'
  | 'workspace_members';
