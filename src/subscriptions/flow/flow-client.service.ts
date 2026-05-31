import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  FlowCustomer,
  FlowInvoice,
  FlowPaginated,
  FlowParams,
  FlowRegisterResponse,
  FlowRegisterStatus,
  FlowSubscription,
} from './flow.types';

@Injectable()
export class FlowClientService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FLOW_API_KEY', '');
    this.secretKey = this.configService.get<string>('FLOW_SECRET_KEY', '');
    this.baseUrl = this.configService
      .get<string>('FLOW_API_BASE_URL', 'https://sandbox.flow.cl/api')
      .replace(/\/+$/, '');
    this.timeoutMs = Number(
      this.configService.get<string>('FLOW_API_TIMEOUT_MS', '15000'),
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secretKey);
  }

  signParams(params: FlowParams): string {
    const toSign = Object.keys(params)
      .filter((key) => key !== 's' && params[key] !== undefined)
      .sort()
      .map((key) => `${key}${String(params[key] ?? '')}`)
      .join('');

    return createHmac('sha256', this.secretKey).update(toSign).digest('hex');
  }

  async createCustomer(input: {
    name: string;
    email: string;
    externalId: string;
  }): Promise<FlowCustomer> {
    return this.post<FlowCustomer>('/customer/create', input);
  }

  async registerCard(input: {
    customerId: string;
    urlReturn: string;
  }): Promise<FlowRegisterResponse> {
    return this.post<FlowRegisterResponse>('/customer/register', {
      customerId: input.customerId,
      url_return: input.urlReturn,
    });
  }

  async getRegisterStatus(token: string): Promise<FlowRegisterStatus> {
    return this.get<FlowRegisterStatus>('/customer/getRegisterStatus', {
      token,
    });
  }

  async createSubscription(input: {
    planId: string;
    customerId: string;
    subscriptionStart?: string;
  }): Promise<FlowSubscription> {
    return this.post<FlowSubscription>('/subscription/create', {
      planId: input.planId,
      customerId: input.customerId,
      subscription_start: input.subscriptionStart,
    });
  }

  async getSubscription(subscriptionId: string): Promise<FlowSubscription> {
    return this.get<FlowSubscription>('/subscription/get', {
      subscriptionId,
    });
  }

  async getCustomerSubscriptions(input: {
    customerId: string;
    filter?: string;
    start?: number;
    limit?: number;
  }): Promise<FlowPaginated<FlowSubscription>> {
    return this.get<FlowPaginated<FlowSubscription>>(
      '/customer/getSubscriptions',
      {
        customerId: input.customerId,
        filter: input.filter,
        start: input.start ?? 0,
        limit: input.limit ?? 10,
      },
    );
  }

  async getInvoice(invoiceId: string | number): Promise<FlowInvoice> {
    return this.get<FlowInvoice>('/invoice/get', {
      invoiceId,
    });
  }

  async cancelSubscription(input: {
    subscriptionId: string;
    atPeriodEnd: boolean;
  }): Promise<FlowSubscription> {
    return this.post<FlowSubscription>('/subscription/cancel', {
      subscriptionId: input.subscriptionId,
      at_period_end: input.atPeriodEnd ? 1 : 0,
    });
  }

  private async get<T>(path: string, params: FlowParams): Promise<T> {
    const signedParams = this.withAuth(params);
    const query = new URLSearchParams(
      Object.entries(signedParams).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    );
    const response = await fetch(`${this.baseUrl}${path}?${query.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    return this.parseResponse<T>(response);
  }

  private async post<T>(path: string, params: FlowParams): Promise<T> {
    const signedParams = this.withAuth(params);
    const body = new URLSearchParams(
      Object.entries(signedParams).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    );
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    return this.parseResponse<T>(response);
  }

  private withAuth(params: FlowParams): FlowParams {
    if (!this.isConfigured()) {
      throw new BadGatewayException({
        code: 'FLOW_NOT_CONFIGURED',
      });
    }

    const signedParams = {
      ...params,
      apiKey: this.apiKey,
    };

    return {
      ...signedParams,
      s: this.signParams(signedParams),
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};

    if (!response.ok) {
      throw new BadGatewayException({
        code: 'FLOW_API_ERROR',
        status: response.status,
        payload,
      });
    }

    return payload as T;
  }
}
