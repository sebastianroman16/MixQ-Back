import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool, PoolConfig } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');

    const pool = new Pool({
      connectionString,
      max: Number(configService.get('PG_POOL_MAX') ?? 10),
      idleTimeoutMillis: Number(
        configService.get('PG_IDLE_TIMEOUT_MS') ?? 30_000,
      ),
      connectionTimeoutMillis: Number(
        configService.get('PG_CONNECTION_TIMEOUT_MS') ?? 10_000,
      ),
      keepAlive: true,
      keepAliveInitialDelayMillis: Number(
        configService.get('PG_KEEPALIVE_DELAY_MS') ?? 10_000,
      ),
      ssl: resolvePgSsl(
        connectionString,
        configService.get<string>('PG_SSL_MODE'),
        configService.get<string>('PG_SSL_CA'),
      ),
    });

    pool.on('error', (error) => {
      this.logger.error('PostgreSQL pool idle client error', error);
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    const maxAttempts = Number(
      this.configService.get('PRISMA_CONNECT_RETRIES') ?? 3,
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(
            `Prisma connected after retry ${attempt}/${maxAttempts}`,
          );
        }
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        const backoffMs = attempt * 1_000;
        this.logger.warn(
          `Prisma connection attempt ${attempt}/${maxAttempts} failed. Retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePgSsl(
  connectionString?: string | null,
  configuredMode?: string | null,
  configuredCa?: string | null,
): PoolConfig['ssl'] {
  if (!connectionString) {
    return undefined;
  }

  const mode = (
    configuredMode?.trim() ||
    getSslModeFromUrl(connectionString) ||
    ''
  ).toLowerCase();

  if (mode === 'disable') {
    return undefined;
  }

  if (mode === 'require' || mode === 'no-verify') {
    return { rejectUnauthorized: false };
  }

  if (mode === 'verify-ca' || mode === 'verify-full') {
    return {
      rejectUnauthorized: true,
      ...(configuredCa ? { ca: normalizeCertificate(configuredCa) } : {}),
    };
  }

  if (/localhost|127\.0\.0\.1/i.test(connectionString)) {
    return undefined;
  }

  // Las conexiones remotas sin modo explicito mantienen validacion estricta.
  return {
    rejectUnauthorized: true,
    ...(configuredCa ? { ca: normalizeCertificate(configuredCa) } : {}),
  };
}

function getSslModeFromUrl(connectionString: string) {
  try {
    return new URL(connectionString).searchParams.get('sslmode');
  } catch {
    return null;
  }
}

function normalizeCertificate(certificate: string) {
  return certificate.replace(/\\n/g, '\n');
}
