import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

describe('AuthRateLimitGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const prisma = {
    $queryRaw: jest.fn(),
    rateLimitEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      keyPrefix: 'auth:register',
      limit: 2,
      windowMs: 60_000,
    });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { count: 1, resetAt: new Date(Date.now() + 60_000) },
    ]);
  });

  it('uses the same key when an anonymous caller changes email or token', () => {
    const guard = new AuthRateLimitGuard(reflector, prisma);
    const buildKey = (body: Record<string, string>) =>
      (
        guard as unknown as {
          buildKey: (
            request: { ip: string; body: Record<string, string> },
            options: { keyPrefix: string; limit: number; windowMs: number },
          ) => string;
        }
      ).buildKey(
        { ip: '203.0.113.8', body },
        { keyPrefix: 'auth:register', limit: 2, windowMs: 60_000 },
      );

    expect(buildKey({ email: 'one@example.com', token: 'one' })).toBe(
      buildKey({ email: 'two@example.com', token: 'two' }),
    );
  });

  it('rejects once the shared IP limit is exceeded', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { count: 3, resetAt: new Date(Date.now() + 60_000) },
    ]);
    const guard = new AuthRateLimitGuard(reflector, prisma);
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '203.0.113.8', body: {} }),
      }),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
