export type FlowScalar = string | number | boolean | null | undefined;

export type FlowParams = Record<string, FlowScalar>;

export type FlowCustomer = {
  customerId: string;
  email: string;
  name: string;
  externalId: string;
  status?: string | number;
  registerDate?: string | null;
  pay_mode?: string;
};

export type FlowRegisterResponse = {
  token: string;
  url?: string;
  redirect?: string;
};

export type FlowRegisterStatus = {
  status: string | number;
  customerId?: string;
  token?: string;
  message?: string;
};

export type FlowSubscription = {
  subscriptionId: string;
  planId: string;
  plan_name?: string;
  customerId: string;
  period_start?: string | null;
  period_end?: string | null;
  next_invoice_date?: string | null;
  days_until_due?: number;
  status: number;
  morose?: number;
  cancel_at_period_end?: number;
  cancel_at?: string | null;
  invoices?: FlowInvoice[];
};

export type FlowInvoice = {
  id: number;
  subscriptionId: string;
  customerId: string;
  currency: string;
  amount: number;
  period_start?: string | null;
  period_end?: string | null;
  due_date?: string | null;
  status: number;
  paymentLink?: string;
  payment?: {
    status?: number;
    paymentData?: {
      date?: string;
    };
  } | null;
};

export type FlowPaginated<T> = {
  total: number;
  hasMore: number;
  data: T[];
};
