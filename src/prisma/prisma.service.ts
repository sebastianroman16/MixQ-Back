import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

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
      ssl: shouldUseSsl(connectionString)
        ? {
            // La CA del proveedor debe estar disponible en el contenedor. No
            // aceptar certificados no verificables evita ataques MITM contra
            // datos y credenciales de la base de datos.
            rejectUnauthorized: true,
          }
        : undefined,
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

function shouldUseSsl(connectionString?: string | null) {
  if (!connectionString) {
    return false;
  }

  if (/sslmode=(require|verify-ca|verify-full)/i.test(connectionString)) {
    return true;
  }

  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}
