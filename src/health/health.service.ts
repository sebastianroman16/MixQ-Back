import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  live() {
    return {
      status: 'ok',
      service: 'mixq-back',
      timestamp: new Date().toISOString(),
    };
  }

  async ready() {
    const configuration = {
      database: this.isConfigured('DATABASE_URL'),
      jwt: this.hasStrongJwtSecret(),
      mail: this.isConfigured('RESEND_API_KEY', 'RESEND_FROM_EMAIL'),
      billing: this.isConfigured(
        'FLOW_API_KEY',
        'FLOW_SECRET_KEY',
        'PUBLIC_API_URL',
      ),
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const details =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      this.logger.error(`Database readiness check failed: ${details}`);
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: {
          database: false,
          configuration,
        },
      });
    }

    if (!configuration.database || !configuration.jwt) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: {
          database: true,
          configuration,
        },
      });
    }

    return {
      status: 'ok',
      checks: {
        database: true,
        configuration,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private isConfigured(...keys: string[]) {
    return keys.every((key) => Boolean(this.config.get<string>(key)?.trim()));
  }

  private hasStrongJwtSecret() {
    const secret = this.config.get<string>('JWT_SECRET')?.trim();
    return Boolean(secret && secret.length >= 32 && secret !== 'dev-secret');
  }
}
