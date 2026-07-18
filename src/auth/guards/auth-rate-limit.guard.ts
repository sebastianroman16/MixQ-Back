import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTH_RATE_LIMIT_KEY,
  AuthRateLimitOptions,
} from '../decorators/auth-rate-limit.decorator';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private lastCleanupAt = 0;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    const { count, resetAt } = await this.increment(key, options.windowMs);
    if (count > options.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetAt.getTime() - now) / 1000),
      );
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cleanupExpiredEntries(now);
    return true;
  }

  private buildKey(
    request: {
      ip?: string;
      socket?: { remoteAddress?: string };
      headers?: Record<string, string | string[] | undefined>;
      body?: Record<string, unknown>;
      user?: { id?: string };
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
    // Para endpoints anonimos el limite debe depender exclusivamente de la IP.
    // Incluir email, token u otros campos controlados por el cliente permite
    // evadirlo cambiando el valor en cada intento y crea filas sin limite.
    // En recursos autenticados, el usuario es una identidad estable.
    const subject = options.keyByUser ? (request.user?.id ?? ip) : ip;
    const rawKey = `${options.keyPrefix}:${subject}`;
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private async increment(key: string, windowMs: number) {
    const now = new Date();
    const nextResetAt = new Date(now.getTime() + windowMs);
    const [entry] = await this.prisma.$queryRaw<
      Array<{ count: number; resetAt: Date }>
    >`
      INSERT INTO "RateLimitEntry" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${nextResetAt}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitEntry"."resetAt" <= ${now} THEN 1
          ELSE "RateLimitEntry"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitEntry"."resetAt" <= ${now} THEN ${nextResetAt}
          ELSE "RateLimitEntry"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `;

    return entry;
  }

  private cleanupExpiredEntries(now: number) {
    // El borrado no participa en la decision y no agrega latencia a cada
    // request. Una replica limpia cada cinco minutos como maximo.
    if (now - this.lastCleanupAt < 5 * 60_000) {
      return;
    }
    this.lastCleanupAt = now;
    void this.prisma.rateLimitEntry
      .deleteMany({ where: { resetAt: { lt: new Date(now) } } })
      .catch(() => undefined);
  }
}
