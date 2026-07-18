import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { GlobalExceptionFilter } from './common/http/global-exception.filter';
import { RequestTimeoutInterceptor } from './common/http/request-timeout.interceptor';

const httpLogger = new Logger('HTTP');

export function configureApp(app: NestExpressApplication) {
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true }
          : false,
    }),
  );
  app.use(compression());

  const bodyLimit = process.env.REQUEST_BODY_LIMIT ?? '5mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.use(requestContextMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestTimeoutInterceptor());

  const origins =
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      optionsSuccessStatus: 204,
    });
  } else if (process.env.NODE_ENV !== 'production') {
    app.enableCors({ exposedHeaders: ['X-Request-Id'] });
  }

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });
}

function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const startedAt = process.hrtime.bigint();
  const requestId = sanitizeRequestId(request.header('x-request-id'));
  response.setHeader('X-Request-Id', requestId);

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    httpLogger.log(
      JSON.stringify({
        event: 'request_completed',
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
      }),
    );
  });

  next();
}

function sanitizeRequestId(value?: string) {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)
    ? trimmed
    : randomUUID();
}
