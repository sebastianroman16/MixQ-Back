import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FREE_LIMITS, PRO_LIMITS, SubscriptionFeature } from './subscriptions.constants';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlan(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  getLimits(plan: PlanType) {
    return plan === PlanType.PRO ? PRO_LIMITS : FREE_LIMITS;
  }

  async getUsage(userId: string) {
    const [quotesCount, templatesCount, servicesCount] = await Promise.all([
      this.prisma.quote.count({ where: { userId } }),
      this.prisma.template.count({ where: { userId, type: 'USER' } }),
      this.prisma.service.count({ where: { userId } }),
    ]);

    return { quotesCount, templatesCount, servicesCount };
  }

  async getSubscriptionSummary(userId: string) {
    const plan = await this.getPlan(userId);
    const limits = this.getLimits(plan.plan);
    const usage = await this.getUsage(userId);

    return {
      plan: plan.plan,
      status: plan.subscriptionStatus,
      currentPeriodEnd: plan.currentPeriodEnd,
      limits,
      usage,
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
    const plan = await this.getPlan(userId);
    const limits = this.getLimits(plan.plan);
    if (!limits.exportPdf) {
      throw this.planLimitError('export_pdf', PlanType.PRO);
    }
  }

  private async assertLimit(userId: string, feature: SubscriptionFeature) {
    const plan = await this.getPlan(userId);
    if (plan.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
      throw this.planLimitError(feature, PlanType.PRO);
    }

    const limits = this.getLimits(plan.plan);
    const usage = await this.getUsage(userId);

    if (feature === 'quotes' && usage.quotesCount >= limits.maxQuotes) {
      throw this.planLimitError('quotes', PlanType.PRO);
    }

    if (feature === 'templates' && usage.templatesCount >= limits.maxTemplates) {
      throw this.planLimitError('templates', PlanType.PRO);
    }

    if (feature === 'services' && usage.servicesCount >= limits.maxServices) {
      throw this.planLimitError('services', PlanType.PRO);
    }
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
