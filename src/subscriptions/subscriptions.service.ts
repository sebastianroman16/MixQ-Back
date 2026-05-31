import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingEventStatus,
  BillingSubscriptionStatus,
  PlanType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { AuthUser } from '../auth/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';
import { FlowClientService } from './flow/flow-client.service';
import { FlowInvoice, FlowSubscription } from './flow/flow.types';
import {
  BUSINESS_LIMITS,
  FREE_LIMITS,
  PLAN_CATALOG,
  PRO_LIMITS,
  SUBSCRIPTION_GRACE_PERIOD_DAYS,
  SubscriptionFeature,
} from './subscriptions.constants';

type WorkspaceEntitlement = {
  workspaceId: string;
  plan: PlanType;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  billingStatus: BillingSubscriptionStatus | null;
  gracePeriodEnd: Date | null;
};

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowClient: FlowClientService,
  ) {}

  getPlanCatalog() {
    return Object.values(PLAN_CATALOG).map((plan) => ({
      plan: plan.plan,
      name: plan.name,
      currency: plan.currency,
      monthlyAmount: plan.monthlyAmount,
      limits: plan.limits,
      availableForCheckout: plan.plan !== PlanType.FREE,
    }));
  }

  async getPlan(userId: string) {
    const entitlement = await this.getWorkspaceEntitlementByUser(userId);

    return {
      plan: entitlement.plan,
      subscriptionStatus: entitlement.subscriptionStatus,
      currentPeriodEnd: entitlement.currentPeriodEnd,
    };
  }

  getLimits(plan: PlanType) {
    if (plan === PlanType.BUSINESS) {
      return BUSINESS_LIMITS;
    }
    if (plan === PlanType.PRO) {
      return PRO_LIMITS;
    }
    return FREE_LIMITS;
  }

  async getUsage(workspaceId: string) {
    const [quotesCount, templatesCount, servicesCount, membersCount] =
      await Promise.all([
        this.prisma.quote.count({ where: { workspaceId } }),
        this.prisma.template.count({ where: { workspaceId, type: 'USER' } }),
        this.prisma.service.count({ where: { workspaceId } }),
        this.prisma.workspaceMember.count({
          where: {
            workspaceId,
            role: { not: 'OWNER' },
          },
        }),
      ]);

    return { quotesCount, templatesCount, servicesCount, membersCount };
  }

  async getSubscriptionSummary(userId: string) {
    const entitlement = await this.getWorkspaceEntitlementByUser(userId);
    const limits = this.getLimits(entitlement.plan);
    const usage = await this.getUsage(entitlement.workspaceId);
    const billingSubscription =
      await this.prisma.billingSubscription.findUnique({
        where: { workspaceId: entitlement.workspaceId },
      });

    return {
      plan: entitlement.plan,
      status: entitlement.subscriptionStatus,
      billingStatus: entitlement.billingStatus,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      gracePeriodEnd: entitlement.gracePeriodEnd,
      limits,
      usage,
      subscription: billingSubscription
        ? {
            provider: billingSubscription.provider,
            providerPlanId: billingSubscription.providerPlanId,
            plan: billingSubscription.plan,
            status: billingSubscription.status,
            currency: billingSubscription.currency,
            monthlyAmount: billingSubscription.monthlyAmount,
            currentPeriodStart: billingSubscription.currentPeriodStart,
            currentPeriodEnd: billingSubscription.currentPeriodEnd,
            gracePeriodEnd: billingSubscription.gracePeriodEnd,
            cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
            canceledAt: billingSubscription.canceledAt,
          }
        : null,
    };
  }

  async createCheckout(user: AuthUser, dto: CreateSubscriptionCheckoutDto) {
    if (dto.plan === PlanType.FREE) {
      throw new BadRequestException('FREE plan does not require checkout');
    }

    const plan = PLAN_CATALOG[dto.plan];
    if (!plan.providerPlanId) {
      throw new BadRequestException('Plan is not available for checkout');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        billingSubscription: true,
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (
      workspace.billingSubscription?.status ===
        BillingSubscriptionStatus.ACTIVE &&
      workspace.billingSubscription.plan === dto.plan &&
      !workspace.billingSubscription.cancelAtPeriodEnd
    ) {
      throw new ConflictException(
        'Workspace is already subscribed to this plan',
      );
    }

    const providerCustomerId =
      workspace.billingSubscription?.providerCustomerId ??
      (
        await this.flowClient.createCustomer({
          name: workspace.owner.name ?? workspace.owner.email,
          email: workspace.owner.email,
          externalId: workspace.id,
        })
      ).customerId;

    const session = await this.prisma.billingCheckoutSession.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        providerCustomerId,
        targetPlan: dto.plan,
        providerPlanId: plan.providerPlanId,
        currency: plan.currency,
        monthlyAmount: plan.monthlyAmount,
        expiresAt: this.addMinutes(new Date(), 30),
      },
    });

    await this.prisma.billingSubscription.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        providerCustomerId,
        providerPlanId: plan.providerPlanId,
        plan: dto.plan,
        status: BillingSubscriptionStatus.PENDING,
        currency: plan.currency,
        monthlyAmount: plan.monthlyAmount,
      },
      update: {
        providerCustomerId,
        providerPlanId: plan.providerPlanId,
        plan: dto.plan,
        status: BillingSubscriptionStatus.PENDING,
        currency: plan.currency,
        monthlyAmount: plan.monthlyAmount,
      },
    });

    const register = await this.flowClient.registerCard({
      customerId: providerCustomerId,
      urlReturn: this.buildApiUrl(
        `/subscriptions/flow/register-return?sessionId=${session.id}`,
      ),
    });

    await this.prisma.billingCheckoutSession.update({
      where: { id: session.id },
      data: { token: register.token },
    });

    return {
      sessionId: session.id,
      plan: dto.plan,
      currency: plan.currency,
      monthlyAmount: plan.monthlyAmount,
      provider: 'FLOW',
      token: register.token,
      url: register.url ?? register.redirect ?? null,
      redirectUrl: this.buildFlowRedirectUrl(register),
      expiresAt: session.expiresAt,
    };
  }

  async handleFlowRegisterReturn(input: { sessionId: string; token: string }) {
    const session = await this.prisma.billingCheckoutSession.findUnique({
      where: { id: input.sessionId },
    });

    if (!session || session.status !== 'PENDING') {
      throw new NotFoundException('Checkout session not found');
    }

    if (session.expiresAt <= new Date()) {
      await this.prisma.billingCheckoutSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Checkout session expired');
    }

    const registerStatus = await this.flowClient.getRegisterStatus(input.token);
    const customerId =
      registerStatus.customerId ?? session.providerCustomerId ?? null;

    if (!customerId || customerId !== session.providerCustomerId) {
      throw new BadRequestException('Flow customer mismatch');
    }

    if (!this.isSuccessfulFlowStatus(registerStatus.status)) {
      await this.prisma.billingCheckoutSession.update({
        where: { id: session.id },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException('Card registration failed');
    }

    const subscription = await this.flowClient.createSubscription({
      planId: session.providerPlanId,
      customerId,
      subscriptionStart: this.formatDateOnly(new Date()),
    });

    await this.applyFlowSubscription(session.workspaceId, subscription);

    await this.prisma.billingCheckoutSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await this.recordBillingEvent({
      providerEventId: `flow_register_${input.token}`,
      type: 'FLOW_CARD_REGISTERED',
      workspaceId: session.workspaceId,
      payload: {
        registerStatus,
        subscription,
      },
      status: BillingEventStatus.PROCESSED,
    });

    return {
      success: true,
      plan: session.targetPlan,
      subscriptionId: subscription.subscriptionId,
    };
  }

  async handleFlowInvoiceCallback(input: {
    token?: string;
    invoiceId?: string;
    rawPayload: Record<string, unknown>;
  }) {
    const invoiceId = input.invoiceId ?? input.token;
    if (!invoiceId) {
      throw new BadRequestException('Missing Flow invoice identifier');
    }

    const invoice = await this.flowClient.getInvoice(invoiceId);
    const eventId = `flow_invoice_${invoice.id}_${invoice.status}`;
    const existing = await this.prisma.billingEvent.findUnique({
      where: { providerEventId: eventId },
    });

    if (existing?.status === BillingEventStatus.PROCESSED) {
      return { success: true, duplicated: true };
    }

    const billingSubscription = await this.prisma.billingSubscription.findFirst(
      {
        where: {
          providerSubscriptionId: invoice.subscriptionId,
          providerCustomerId: invoice.customerId,
        },
      },
    );

    if (!billingSubscription) {
      await this.recordBillingEvent({
        providerEventId: eventId,
        type: 'FLOW_INVOICE_CALLBACK',
        workspaceId: null,
        payload: { rawPayload: input.rawPayload, invoice },
        status: BillingEventStatus.FAILED,
        error: 'Billing subscription not found for invoice',
      });
      throw new NotFoundException('Billing subscription not found');
    }

    await this.applyFlowInvoice(billingSubscription.workspaceId, invoice);

    await this.recordBillingEvent({
      providerEventId: eventId,
      type: 'FLOW_INVOICE_CALLBACK',
      workspaceId: billingSubscription.workspaceId,
      payload: { rawPayload: input.rawPayload, invoice },
      status: BillingEventStatus.PROCESSED,
    });

    return { success: true };
  }

  async cancelCurrentSubscription(user: AuthUser) {
    const subscription = await this.prisma.billingSubscription.findUnique({
      where: { workspaceId: user.workspaceId },
    });

    if (!subscription?.providerSubscriptionId) {
      throw new NotFoundException('Active provider subscription not found');
    }

    const flowSubscription = await this.flowClient.cancelSubscription({
      subscriptionId: subscription.providerSubscriptionId,
      atPeriodEnd: true,
    });

    await this.applyFlowSubscription(user.workspaceId, flowSubscription);

    return {
      success: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: this.parseFlowDate(flowSubscription.period_end),
    };
  }

  async reconcileOverdueSubscriptions() {
    const now = new Date();
    const expired = await this.prisma.billingSubscription.findMany({
      where: {
        OR: [
          {
            status: BillingSubscriptionStatus.PAST_DUE,
            gracePeriodEnd: {
              lt: now,
            },
          },
          {
            status: BillingSubscriptionStatus.ACTIVE,
            cancelAtPeriodEnd: true,
            currentPeriodEnd: {
              lt: now,
            },
          },
        ],
      },
    });

    for (const subscription of expired) {
      await this.downgradeWorkspaceToFree(subscription.workspaceId, {
        status: BillingSubscriptionStatus.CANCELED,
        canceledAt: now,
      });
    }

    return {
      success: true,
      downgraded: expired.length,
    };
  }

  async assertCanCreateQuote(userId: string) {
    await this.assertLimit(userId, 'quotes');
  }

  async assertCanCreateTemplate(userId: string) {
    await this.assertLimit(userId, 'templates');
  }

  async assertCanCreateService(userId: string) {
    await this.assertLimit(userId, 'services');
  }

  async assertCanExportPdf(userId: string) {
    const entitlement = await this.getWorkspaceEntitlementByUser(userId);
    const limits = this.getLimits(entitlement.plan);
    if (!limits.exportPdf) {
      throw this.planLimitError('export_pdf', PlanType.PRO);
    }
  }

  async assertCanAddWorkspaceMember(workspaceId: string) {
    const entitlement = await this.getWorkspaceEntitlement(workspaceId);

    if (!this.isEntitlementUsable(entitlement)) {
      throw this.planLimitError('workspace_members', PlanType.PRO);
    }

    const limits = this.getLimits(entitlement.plan);
    const usage = await this.getUsage(workspaceId);
    if (usage.membersCount >= limits.maxWorkspaceMembers) {
      const planRequired =
        entitlement.plan === PlanType.PRO ? PlanType.BUSINESS : PlanType.PRO;
      throw this.planLimitError('workspace_members', planRequired);
    }
  }

  private async assertLimit(userId: string, feature: SubscriptionFeature) {
    const entitlement = await this.getWorkspaceEntitlementByUser(userId);

    if (!this.isEntitlementUsable(entitlement)) {
      throw this.planLimitError(feature, PlanType.PRO);
    }

    const limits = this.getLimits(entitlement.plan);
    const usage = await this.getUsage(entitlement.workspaceId);

    if (feature === 'quotes' && usage.quotesCount >= limits.maxQuotes) {
      throw this.planLimitError('quotes', PlanType.PRO);
    }

    if (
      feature === 'templates' &&
      usage.templatesCount >= limits.maxTemplates
    ) {
      throw this.planLimitError('templates', PlanType.PRO);
    }

    if (feature === 'services' && usage.servicesCount >= limits.maxServices) {
      throw this.planLimitError('services', PlanType.PRO);
    }
  }

  private async getWorkspaceEntitlementByUser(
    userId: string,
  ): Promise<WorkspaceEntitlement> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });

    if (!user?.workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    return this.getWorkspaceEntitlement(user.workspaceId);
  }

  private async getWorkspaceEntitlement(
    workspaceId: string,
  ): Promise<WorkspaceEntitlement> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        owner: {
          select: {
            id: true,
            plan: true,
            subscriptionStatus: true,
            currentPeriodEnd: true,
          },
        },
        billingSubscription: true,
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const subscription = workspace.billingSubscription;
    if (!subscription) {
      return {
        workspaceId: workspace.id,
        plan: workspace.owner.plan,
        subscriptionStatus: workspace.owner.subscriptionStatus,
        currentPeriodEnd: workspace.owner.currentPeriodEnd,
        billingStatus: null,
        gracePeriodEnd: null,
      };
    }

    if (
      subscription.status === BillingSubscriptionStatus.PAST_DUE &&
      subscription.gracePeriodEnd &&
      subscription.gracePeriodEnd < new Date()
    ) {
      await this.downgradeWorkspaceToFree(workspace.id, {
        status: BillingSubscriptionStatus.CANCELED,
        canceledAt: new Date(),
      });

      return {
        workspaceId: workspace.id,
        plan: PlanType.FREE,
        subscriptionStatus: SubscriptionStatus.CANCELED,
        currentPeriodEnd: subscription.currentPeriodEnd,
        billingStatus: BillingSubscriptionStatus.CANCELED,
        gracePeriodEnd: subscription.gracePeriodEnd,
      };
    }

    if (
      subscription.status === BillingSubscriptionStatus.ACTIVE ||
      subscription.status === BillingSubscriptionStatus.PAST_DUE
    ) {
      return {
        workspaceId: workspace.id,
        plan: subscription.plan,
        subscriptionStatus:
          subscription.status === BillingSubscriptionStatus.PAST_DUE
            ? SubscriptionStatus.PAST_DUE
            : SubscriptionStatus.ACTIVE,
        currentPeriodEnd: subscription.currentPeriodEnd,
        billingStatus: subscription.status,
        gracePeriodEnd: subscription.gracePeriodEnd,
      };
    }

    return {
      workspaceId: workspace.id,
      plan: PlanType.FREE,
      subscriptionStatus:
        subscription.status === BillingSubscriptionStatus.CANCELED
          ? SubscriptionStatus.CANCELED
          : SubscriptionStatus.ACTIVE,
      currentPeriodEnd: subscription.currentPeriodEnd,
      billingStatus: subscription.status,
      gracePeriodEnd: subscription.gracePeriodEnd,
    };
  }

  private async applyFlowSubscription(
    workspaceId: string,
    flowSubscription: FlowSubscription,
  ) {
    const plan = this.planFromProviderPlanId(flowSubscription.planId);
    const status = this.mapFlowSubscriptionStatus(flowSubscription);
    const periodStart = this.parseFlowDate(flowSubscription.period_start);
    const periodEnd = this.parseFlowDate(flowSubscription.period_end);
    const gracePeriodEnd =
      status === BillingSubscriptionStatus.PAST_DUE
        ? this.addDays(periodEnd ?? new Date(), SUBSCRIPTION_GRACE_PERIOD_DAYS)
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.billingSubscription.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          providerCustomerId: flowSubscription.customerId,
          providerSubscriptionId: flowSubscription.subscriptionId,
          providerPlanId: flowSubscription.planId,
          plan,
          status,
          currency: PLAN_CATALOG[plan].currency,
          monthlyAmount: PLAN_CATALOG[plan].monthlyAmount,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          gracePeriodEnd,
          cancelAtPeriodEnd: flowSubscription.cancel_at_period_end === 1,
          canceledAt:
            status === BillingSubscriptionStatus.CANCELED
              ? (this.parseFlowDate(flowSubscription.cancel_at) ?? new Date())
              : null,
          metadata: flowSubscription as unknown as Prisma.InputJsonValue,
        },
        update: {
          providerCustomerId: flowSubscription.customerId,
          providerSubscriptionId: flowSubscription.subscriptionId,
          providerPlanId: flowSubscription.planId,
          plan,
          status,
          currency: PLAN_CATALOG[plan].currency,
          monthlyAmount: PLAN_CATALOG[plan].monthlyAmount,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          gracePeriodEnd,
          cancelAtPeriodEnd: flowSubscription.cancel_at_period_end === 1,
          canceledAt:
            status === BillingSubscriptionStatus.CANCELED
              ? (this.parseFlowDate(flowSubscription.cancel_at) ?? new Date())
              : null,
          metadata: flowSubscription as unknown as Prisma.InputJsonValue,
        },
      });

      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
      });

      if (workspace) {
        await tx.user.update({
          where: { id: workspace.ownerId },
          data: {
            plan:
              status === BillingSubscriptionStatus.CANCELED
                ? PlanType.FREE
                : plan,
            subscriptionStatus: this.mapBillingStatusToUserStatus(status),
            currentPeriodEnd: periodEnd,
          },
        });
      }
    });
  }

  private async applyFlowInvoice(workspaceId: string, invoice: FlowInvoice) {
    const subscription = await this.prisma.billingSubscription.findUnique({
      where: { workspaceId },
    });

    if (!subscription) {
      throw new NotFoundException('Billing subscription not found');
    }

    if (invoice.status === 1) {
      const expectedPlan = PLAN_CATALOG[subscription.plan];
      if (
        invoice.currency !== expectedPlan.currency ||
        invoice.amount !== expectedPlan.monthlyAmount
      ) {
        throw new BadRequestException({
          code: 'BILLING_AMOUNT_MISMATCH',
          expected: {
            currency: expectedPlan.currency,
            amount: expectedPlan.monthlyAmount,
          },
          received: {
            currency: invoice.currency,
            amount: invoice.amount,
          },
        });
      }

      const periodStart = this.parseFlowDate(invoice.period_start);
      const periodEnd = this.parseFlowDate(invoice.period_end);
      await this.prisma.$transaction(async (tx) => {
        await tx.billingSubscription.update({
          where: { workspaceId },
          data: {
            status: BillingSubscriptionStatus.ACTIVE,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            gracePeriodEnd: null,
            lastInvoiceId: String(invoice.id),
            lastPaymentAt:
              this.parseFlowDate(invoice.payment?.paymentData?.date) ??
              new Date(),
            metadata: invoice as unknown as Prisma.InputJsonValue,
          },
        });
        await this.updateWorkspaceOwnerPlan(tx, workspaceId, {
          plan: subscription.plan,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: periodEnd,
        });
      });
      return;
    }

    if (invoice.status === 0) {
      const dueDate = this.parseFlowDate(invoice.due_date) ?? new Date();
      const gracePeriodEnd = this.addDays(
        dueDate,
        SUBSCRIPTION_GRACE_PERIOD_DAYS,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.billingSubscription.update({
          where: { workspaceId },
          data: {
            status: BillingSubscriptionStatus.PAST_DUE,
            gracePeriodEnd,
            lastInvoiceId: String(invoice.id),
            metadata: invoice as unknown as Prisma.InputJsonValue,
          },
        });
        await this.updateWorkspaceOwnerPlan(tx, workspaceId, {
          plan: subscription.plan,
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: subscription.currentPeriodEnd,
        });
      });
      return;
    }

    if (invoice.status === 2) {
      await this.prisma.billingSubscription.update({
        where: { workspaceId },
        data: {
          lastInvoiceId: String(invoice.id),
          metadata: invoice as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async downgradeWorkspaceToFree(
    workspaceId: string,
    patch: {
      status: BillingSubscriptionStatus;
      canceledAt?: Date;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.billingSubscription.update({
        where: { workspaceId },
        data: {
          status: patch.status,
          plan: PlanType.FREE,
          canceledAt: patch.canceledAt,
          cancelAtPeriodEnd: false,
        },
      });
      await this.updateWorkspaceOwnerPlan(tx, workspaceId, {
        plan: PlanType.FREE,
        subscriptionStatus: SubscriptionStatus.CANCELED,
        currentPeriodEnd: null,
      });
    });
  }

  private async updateWorkspaceOwnerPlan(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    data: {
      plan: PlanType;
      subscriptionStatus: SubscriptionStatus;
      currentPeriodEnd: Date | null;
    },
  ) {
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    if (!workspace) {
      return;
    }

    await tx.user.update({
      where: { id: workspace.ownerId },
      data,
    });
  }

  private async recordBillingEvent(input: {
    providerEventId: string;
    type: string;
    workspaceId: string | null;
    payload: unknown;
    status: BillingEventStatus;
    error?: string;
  }) {
    await this.prisma.billingEvent.upsert({
      where: { providerEventId: input.providerEventId },
      create: {
        providerEventId: input.providerEventId,
        type: input.type,
        workspaceId: input.workspaceId,
        payload: input.payload as Prisma.InputJsonValue,
        status: input.status,
        error: input.error,
        processedAt:
          input.status === BillingEventStatus.PROCESSED ? new Date() : null,
      },
      update: {
        payload: input.payload as Prisma.InputJsonValue,
        status: input.status,
        error: input.error,
        processedAt:
          input.status === BillingEventStatus.PROCESSED ? new Date() : null,
      },
    });
  }

  private isEntitlementUsable(entitlement: WorkspaceEntitlement) {
    if (entitlement.subscriptionStatus === SubscriptionStatus.ACTIVE) {
      return true;
    }

    return (
      entitlement.subscriptionStatus === SubscriptionStatus.PAST_DUE &&
      !!entitlement.gracePeriodEnd &&
      entitlement.gracePeriodEnd >= new Date()
    );
  }

  private mapFlowSubscriptionStatus(subscription: FlowSubscription) {
    if (subscription.status === 4) {
      return BillingSubscriptionStatus.CANCELED;
    }
    if (subscription.morose === 1) {
      return BillingSubscriptionStatus.PAST_DUE;
    }
    if (subscription.status === 1 || subscription.status === 2) {
      return BillingSubscriptionStatus.ACTIVE;
    }
    return BillingSubscriptionStatus.PENDING;
  }

  private mapBillingStatusToUserStatus(status: BillingSubscriptionStatus) {
    if (status === BillingSubscriptionStatus.PAST_DUE) {
      return SubscriptionStatus.PAST_DUE;
    }
    if (status === BillingSubscriptionStatus.CANCELED) {
      return SubscriptionStatus.CANCELED;
    }
    return SubscriptionStatus.ACTIVE;
  }

  private planFromProviderPlanId(providerPlanId: string): PlanType {
    const found = Object.values(PLAN_CATALOG).find(
      (plan) => plan.providerPlanId === providerPlanId,
    );
    if (!found || found.plan === PlanType.FREE) {
      throw new BadRequestException('Unknown provider plan');
    }
    return found.plan;
  }

  private isSuccessfulFlowStatus(status: string | number) {
    return String(status) === '1';
  }

  private buildApiUrl(path: string) {
    const baseUrl = (
      process.env.PUBLIC_API_URL ??
      process.env.API_URL ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${baseUrl}${path}`;
  }

  private buildFlowRedirectUrl(response: { url?: string; token: string }) {
    if (!response.url) {
      return null;
    }

    const separator = response.url.includes('?') ? '&' : '?';
    return `${response.url}${separator}token=${encodeURIComponent(response.token)}`;
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60_000);
  }

  private addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDateOnly(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private parseFlowDate(value?: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private planLimitError(feature: SubscriptionFeature, planRequired: PlanType) {
    return new HttpException(
      {
        code: 'PLAN_LIMIT_REACHED',
        feature,
        planRequired,
      },
      403,
    );
  }
}
