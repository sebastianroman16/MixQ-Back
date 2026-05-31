import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from './guards/workspace-role.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresInRaw = configService.get<string>('JWT_EXPIRES_IN', '1d');
        const expiresIn = parseExpiresIn(expiresInRaw);
        return {
          secret: getJwtSecret(configService),
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitGuard,
    JwtAuthGuard,
    WorkspaceRoleGuard,
  ],
  exports: [JwtModule, JwtAuthGuard, WorkspaceRoleGuard, AuthService],
})
export class AuthModule {}

function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')?.trim();
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  if (
    isProduction &&
    (!secret || secret === 'dev-secret' || secret.length < 32)
  ) {
    throw new Error(
      'JWT_SECRET must be set to a strong value with at least 32 characters in production',
    );
  }

  return secret || 'dev-secret';
}

function parseExpiresIn(value: string): number {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) {
    return 86400;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return amount * multipliers[unit];
}
