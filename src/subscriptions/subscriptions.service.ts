import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BUSINESS_LIMITS,
  FREE_LIMITS,
  PRO_LIMITS,
  SubscriptionFeature,
} from './subscriptions.constants';

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
    if (plan === PlanType.BUSINESS) {
      return BUSINESS_LIMITS;
    }
    if (plan === PlanType.PRO) {
      return PRO_LIMITS;
    }
    return FREE_LIMITS;
  }

  async getUsage(workspaceId: string) {
    const [quotesCount, templatesCount, servicesCount, membersCount] = await Promise.all([
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

    return {
      plan: entitlement.plan,
      status: entitlement.subscriptionStatus,
      currentPeriodEnd: null,
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
    const entitlement = await this.getWorkspaceEntitlementByUser(userId);
    const limits = this.getLimits(entitlement.plan);
    if (!limits.exportPdf) {
      throw this.planLimitError('export_pdf', PlanType.PRO);
    }
  }

  async assertCanAddWorkspaceMember(workspaceId: string) {
    const entitlement = await this.getWorkspaceEntitlement(workspaceId);

    if (entitlement.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
      throw this.planLimitError('workspace_members', PlanType.PRO);
    }

    const limits = this.getLimits(entitlement.plan);
    const usage = await this.getUsage(workspaceId);
    if (usage.membersCount >= limits.maxWorkspaceMembers) {
      const planRequired = entitlement.plan === PlanType.PRO ? PlanType.BUSINESS : PlanType.PRO;
      throw this.planLimitError('workspace_members', planRequired);
    }
  }

  private async assertLimit(userId: string, feature: SubscriptionFeature) {
    const entitlement = await this.getWorkspaceEntitlementByUser(userId);

    if (entitlement.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
      throw this.planLimitError(feature, PlanType.PRO);
    }

    const limits = this.getLimits(entitlement.plan);
    const usage = await this.getUsage(entitlement.workspaceId);

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

  private async getWorkspaceEntitlementByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });

    if (!user?.workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    return this.getWorkspaceEntitlement(user.workspaceId);
  }

  private async getWorkspaceEntitlement(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        owner: {
          select: {
            plan: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return {
      workspaceId: workspace.id,
      plan: workspace.owner.plan,
      subscriptionStatus: workspace.owner.subscriptionStatus,
    };
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
