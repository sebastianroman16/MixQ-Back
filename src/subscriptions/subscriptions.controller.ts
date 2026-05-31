import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { AuthRateLimit } from '../auth/decorators/auth-rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireWorkspaceRoles } from '../auth/decorators/require-workspace-roles.decorator';
import { AuthRateLimitGuard } from '../auth/guards/auth-rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';
import { FlowTokenDto } from './dto/flow-token.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  getPlans() {
    return this.subscriptionsService.getPlanCatalog();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.getSubscriptionSummary(user.id);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  createCheckout(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubscriptionCheckoutDto,
  ) {
    return this.subscriptionsService.createCheckout(user, dto);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  cancel(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.cancelCurrentSubscription(user);
  }

  @Post('flow/register-return')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'billing:flow:register-return',
    limit: 20,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['token'],
  })
  flowRegisterReturn(
    @Query('sessionId') sessionId: string,
    @Body() dto: FlowTokenDto,
  ) {
    return this.subscriptionsService.handleFlowRegisterReturn({
      sessionId,
      token: dto.token,
    });
  }

  @Post('flow/invoice-callback')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit({
    keyPrefix: 'billing:flow:invoice-callback',
    limit: 60,
    windowMs: 15 * 60 * 1000,
    bodyFields: ['token', 'invoiceId'],
  })
  flowInvoiceCallback(
    @Body() body: Record<string, unknown>,
    @Headers('x-flow-callback-secret') secret?: string,
  ) {
    this.assertFlowCallbackSecret(secret);
    const token = typeof body.token === 'string' ? body.token : undefined;
    const invoiceId =
      typeof body.invoiceId === 'string' || typeof body.invoiceId === 'number'
        ? String(body.invoiceId)
        : undefined;

    return this.subscriptionsService.handleFlowInvoiceCallback({
      token,
      invoiceId,
      rawPayload: body,
    });
  }

  @Post('cron/reconcile-overdue')
  reconcileOverdue(@Headers('x-billing-cron-secret') secret?: string) {
    const expected = process.env.BILLING_CRON_SECRET;
    if (!expected || !safeSecretEquals(secret, expected)) {
      throw new ForbiddenException({ code: 'INVALID_CRON_SECRET' });
    }

    return this.subscriptionsService.reconcileOverdueSubscriptions();
  }

  private assertFlowCallbackSecret(secret?: string) {
    const expected = process.env.FLOW_CALLBACK_SECRET?.trim();
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException({ code: 'FLOW_CALLBACK_SECRET_REQUIRED' });
      }
      return;
    }

    if (!safeSecretEquals(secret, expected)) {
      throw new ForbiddenException({ code: 'INVALID_FLOW_CALLBACK_SECRET' });
    }
  }
}

function safeSecretEquals(received: string | undefined, expected: string) {
  if (!received) {
    return false;
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}
