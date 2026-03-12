import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = String(request.headers?.authorization ?? '').trim();
    if (!authHeader) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    const [type, tokenPart] = authHeader.split(' ');
    const token = type?.toLowerCase() === 'bearer' ? tokenPart : authHeader;

    if (!token) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    try {
      const payload = this.jwtService.verify(token) as {
        sub?: string;
        email?: string;
        tokenVersion?: number;
        workspaceId?: string;
        role?: WorkspaceRole;
      };

      const userId = String(payload.sub ?? '');
      const tokenVersion = Number(payload.tokenVersion);
      const workspaceId = String(payload.workspaceId ?? '');

      if (!userId || !Number.isFinite(tokenVersion) || !workspaceId) {
        throw new UnauthorizedException('Invalid token');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, tokenVersion: true, workspaceId: true },
      });

      if (!user || user.tokenVersion !== tokenVersion) {
        throw new UnauthorizedException('Invalid token');
      }

      if (!user.workspaceId) {
        throw new UnauthorizedException('Invalid workspace');
      }

      const member = await this.prisma.workspaceMember.findFirst({
        where: {
          userId: user.id,
          workspaceId: user.workspaceId,
        },
        select: {
          role: true,
        },
      });

      if (!member) {
        throw new UnauthorizedException('Workspace membership not found');
      }

      request.user = {
        id: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
        workspaceId: user.workspaceId,
        role: member.role,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
