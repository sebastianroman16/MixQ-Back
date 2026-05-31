import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WorkspaceRole } from '@prisma/client';
import { WORKSPACE_ROLES_KEY } from '../auth/decorators/require-workspace-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from '../auth/guards/workspace-role.guard';
import { SubscriptionsController } from './subscriptions.controller';

describe('SubscriptionsController security contracts', () => {
  const previousFlowCallbackSecret = process.env.FLOW_CALLBACK_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;

  const service = {
    getPlanCatalog: jest.fn(),
    getSubscriptionSummary: jest.fn(),
    createCheckout: jest.fn(),
    cancelCurrentSubscription: jest.fn(),
    handleFlowRegisterReturn: jest.fn(),
    handleFlowInvoiceCallback: jest.fn(),
    reconcileOverdueSubscriptions: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
    process.env.FLOW_CALLBACK_SECRET = previousFlowCallbackSecret;
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('restricts checkout and cancellation to workspace managers', () => {
    for (const methodName of ['createCheckout', 'cancel'] as const) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        SubscriptionsController.prototype[methodName],
      );
      const roles = Reflect.getMetadata(
        WORKSPACE_ROLES_KEY,
        SubscriptionsController.prototype[methodName],
      );

      expect(guards).toEqual([JwtAuthGuard, WorkspaceRoleGuard]);
      expect(roles).toEqual([WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    }
  });

  it('rejects Flow invoice callbacks with an invalid configured secret', () => {
    process.env.FLOW_CALLBACK_SECRET = 'expected-secret';
    const controller = new SubscriptionsController(service as never);

    expect(() =>
      controller.flowInvoiceCallback({ token: 'flow-token' }, 'wrong-secret'),
    ).toThrow(ForbiddenException);
    expect(service.handleFlowInvoiceCallback).not.toHaveBeenCalled();
  });

  it('accepts Flow invoice callbacks with the configured secret', () => {
    process.env.FLOW_CALLBACK_SECRET = 'expected-secret';
    service.handleFlowInvoiceCallback.mockReturnValue({ success: true });
    const controller = new SubscriptionsController(service as never);

    expect(
      controller.flowInvoiceCallback(
        { token: 'flow-token', invoiceId: 123 },
        'expected-secret',
      ),
    ).toEqual({ success: true });
    expect(service.handleFlowInvoiceCallback).toHaveBeenCalledWith({
      token: 'flow-token',
      invoiceId: '123',
      rawPayload: { token: 'flow-token', invoiceId: 123 },
    });
  });
});
