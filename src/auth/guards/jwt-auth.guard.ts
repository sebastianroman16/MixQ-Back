import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth-user';

type JwtPayload = {
  sub?: unknown;
  tokenVersion?: unknown;
  workspaceId?: unknown;
};

type CacheEntry = {
  user: AuthUser;
  expiresAt: number;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    // TTL 0 desactiva el cache (cada request consulta la base de datos).
    this.cacheTtlMs = Number(
      configService.get('AUTH_USER_CACHE_TTL_MS') ?? 30_000,
    );
    this.cacheMaxEntries = Number(
      configService.get('AUTH_USER_CACHE_MAX_ENTRIES') ?? 10_000,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const authHeader = String(request.headers?.authorization ?? '').trim();
    if (!authHeader) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    const [type, tokenPart] = authHeader.split(' ');
    const token = type?.toLowerCase() === 'bearer' ? tokenPart : authHeader;

    if (!token) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const tokenVersion = Number(payload.tokenVersion);
    const workspaceId =
      typeof payload.workspaceId === 'string' ? payload.workspaceId : '';

    if (!userId || !Number.isFinite(tokenVersion) || !workspaceId) {
      throw new UnauthorizedException('Invalid token');
    }

    request.user = await this.resolveAuthUser(userId, tokenVersion);
    return true;
  }

  private async resolveAuthUser(
    userId: string,
    tokenVersion: number,
  ): Promise<AuthUser> {
    const cached = this.getCached(userId, tokenVersion);
    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        tokenVersion: true,
        workspaceId: true,
        workspaceMembers: {
          select: {
            workspaceId: true,
            role: true,
          },
        },
      },
    });

    if (!user || user.tokenVersion !== tokenVersion) {
      throw new UnauthorizedException('Invalid token');
    }

    if (!user.workspaceId) {
      throw new UnauthorizedException('Invalid workspace');
    }

    const member = user.workspaceMembers.find(
      (membership) => membership.workspaceId === user.workspaceId,
    );

    if (!member) {
      throw new UnauthorizedException('Workspace membership not found');
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
      workspaceId: user.workspaceId,
      role: member.role,
    };

    this.setCached(authUser);
    return authUser;
  }

  private getCached(userId: string, tokenVersion: number): AuthUser | null {
    if (this.cacheTtlMs <= 0) {
      return null;
    }

    const entry = this.cache.get(userId);
    if (!entry) {
      return null;
    }

    // Si el tokenVersion del JWT no coincide con el cacheado se consulta la
    // base de datos. Un token revocado puede sobrevivir como maximo el TTL.
    if (
      entry.expiresAt <= Date.now() ||
      entry.user.tokenVersion !== tokenVersion
    ) {
      this.cache.delete(userId);
      return null;
    }

    return entry.user;
  }

  private setCached(user: AuthUser) {
    if (this.cacheTtlMs <= 0) {
      return;
    }

    if (this.cache.size >= this.cacheMaxEntries) {
      this.pruneCache();
    }

    this.cache.set(user.id, {
      user,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }

    while (this.cache.size >= this.cacheMaxEntries) {
      let oldestKey: string | undefined;
      for (const key of this.cache.keys()) {
        oldestKey = key;
        break;
      }
      if (oldestKey === undefined) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }
}
