import { SetMetadata } from '@nestjs/common';

export type AuthRateLimitOptions = {
  limit: number;
  windowMs: number;
  keyPrefix: string;
  /** Incluye el usuario autenticado cuando el endpoint ya tiene JwtAuthGuard. */
  keyByUser?: boolean;
};

export const AUTH_RATE_LIMIT_KEY = 'auth_rate_limit';

export const AuthRateLimit = (options: AuthRateLimitOptions) =>
  SetMetadata(AUTH_RATE_LIMIT_KEY, options);
