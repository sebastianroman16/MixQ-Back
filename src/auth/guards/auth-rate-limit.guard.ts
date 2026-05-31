import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AUTH_RATE_LIMIT_KEY,
  AuthRateLimitOptions,
} from '../decorators/auth-rate-limit.decorator';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<AuthRateLimitOptions>(
      AUTH_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const key = this.buildKey(request, options);
    const existing = this.entries.get(key);

    if (!existing || existing.resetAt <= now) {
      this.entries.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      this.pruneExpiredEntries(now);
      this.pruneOverflowEntries();
      return true;
    }

    existing.count += 1;
    if (existing.count > options.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private buildKey(
    request: {
      ip?: string;
      socket?: { remoteAddress?: string };
      headers?: Record<string, string | string[] | undefined>;
      body?: Record<string, unknown>;
    },
    options: AuthRateLimitOptions,
  ) {
    const trustProxy =
      process.env.TRUST_PROXY === '1' ||
      process.env.TRUST_PROXY?.toLowerCase() === 'true';
    const forwardedFor = trustProxy ? request.headers?.['x-forwarded-for'] : '';
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor;
    const ip = String(
      forwardedIp?.split(',')[0]?.trim() ||
        request.ip ||
        request.socket?.remoteAddress ||
        'unknown',
    );
    const bodyParts =
      options.bodyFields
        ?.map((field) => {
          const value = request.body?.[field];
          return typeof value === 'string' ? value.trim().toLowerCase() : '';
        })
        .filter(Boolean)
        .join(':') ?? '';

    return `${options.keyPrefix}:${ip}:${bodyParts}`;
  }

  private pruneExpiredEntries(now: number) {
    if (this.entries.size < this.maxEntries()) {
      return;
    }

    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private pruneOverflowEntries() {
    const maxEntries = this.maxEntries();
    while (this.entries.size > maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }

  private maxEntries() {
    const configured = Number(process.env.AUTH_RATE_LIMIT_MAX_ENTRIES);
    return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
  }
}
