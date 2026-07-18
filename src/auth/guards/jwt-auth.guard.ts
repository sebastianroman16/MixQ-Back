import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth-user';

type JwtPayload = {
  sub?: unknown;
  tokenVersion?: unknown;
  workspaceId?: unknown;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

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
    // Se consulta la fuente de verdad en cada request. Asi un logout, cambio
    // de rol o eliminacion de miembro invalida el token inmediatamente.
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

    return authUser;
  }
}
