/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PlanType, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/configure-app';

describe('MixQ critical HTTP flows (e2e)', () => {
  const email = 'e2e-owner@example.com';
  const password = 'e2e-password-123';
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshToken: string;
  let foreignServiceId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    assertTestDatabase(databaseUrl);

    process.env.DATABASE_URL = databaseUrl;
    process.env.PG_SSL_MODE = process.env.TEST_PG_SSL_MODE ?? 'disable';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ??
      'e2e-only-jwt-secret-with-more-than-32-characters';
    process.env.JWT_EXPIRES_IN = '10m';

    // La carga ocurre despues de fijar DATABASE_URL para impedir que
    // ConfigModule capture por accidente la base del entorno local.
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    const owner = await seedOwner(prisma, email, password, 'Primary');
    const foreignOwner = await seedOwner(
      prisma,
      'foreign-owner@example.com',
      password,
      'Foreign',
    );
    await seedWorkspaceViewer(prisma, owner.id, password);
    const foreignService = await prisma.service.create({
      data: {
        userId: foreignOwner.id,
        workspaceId: foreignOwner.id,
        inventoryCode: 'FOREIGN-001',
        name: 'Foreign service',
        unitPrice: 1000,
        quantity: 1,
      },
    });
    foreignServiceId = foreignService.id;
  });

  afterAll(async () => {
    if (prisma) {
      await resetDatabase(prisma);
    }
    if (app) {
      await app.close();
    }
  });

  it('reports liveness and database readiness', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(({ body, headers }) => {
        expect(body.status).toBe('ok');
        expect(headers['x-request-id']).toEqual(expect.any(String));
        expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.checks.database).toBe(true);
        expect(body.checks.configuration.jwt).toBe(true);
      });
  });

  it('rejects malformed and invalid login attempts correctly', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'incorrect-password' })
      .expect(401);
  });

  it('logs in and accesses authenticated workspace data', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(response.body.user.email).toBe(email);
    expect(response.body.user.role).toBe(WorkspaceRole.OWNER);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    accessToken = response.body.accessToken as string;
    refreshToken = response.body.refreshToken as string;

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.user.email).toBe(email));

    await request(app.getHttpServer())
      .get('/workspace/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('rotates refresh tokens and rejects token reuse', async () => {
    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(201);

    expect(rotated.body.refreshToken).not.toBe(refreshToken);
    accessToken = rotated.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('enforces authorization and validates unknown fields', async () => {
    await request(app.getHttpServer()).get('/services').expect(401);

    await request(app.getHttpServer())
      .post('/services/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Audio', unexpected: true })
      .expect(400);
  });

  it('loads the main authenticated modules without server errors', async () => {
    const routes = [
      '/templates',
      '/quotes',
      '/quotes/composer-bootstrap',
      '/dashboard/overview',
      '/dashboard/analytics',
      '/sender-profile',
      '/subscriptions/me',
    ];

    for (const route of routes) {
      await request(app.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    }
  });

  it('prevents cross-workspace access and enforces viewer permissions', async () => {
    await request(app.getHttpServer())
      .get(`/services/${foreignServiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    const viewerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'workspace-viewer@example.com', password })
      .expect(201);
    const viewerToken = viewerLogin.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: foreignServiceId }),
          ]),
        ),
      );

    await request(app.getHttpServer())
      .post('/services/categories')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Forbidden category' })
      .expect(403);
  });

  it('creates, lists, updates and deletes categories and services', async () => {
    const categoryResponse = await request(app.getHttpServer())
      .post('/services/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Audio' })
      .expect(201);
    const categoryId = categoryResponse.body.id as string;

    const serviceResponse = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Sonido para evento',
        description: 'Prueba E2E',
        categoryId,
        unitPrice: 150000,
        quantity: 1,
      })
      .expect(201);
    const serviceId = serviceResponse.body.id as string;

    await request(app.getHttpServer())
      .get('/services/counts')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(1);
        expect(body.byCategory[categoryId]).toBe(1);
      });

    await request(app.getHttpServer())
      .patch(`/services/${serviceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 2 })
      .expect(200)
      .expect(({ body }) => expect(body.quantity).toBe(2));

    await request(app.getHttpServer())
      .delete(`/services/${serviceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/services/categories/${categoryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('creates, lists and deletes frequent clients', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/frequent-clients')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'Cliente E2E',
        name: 'Empresa de Prueba',
        email: 'client-e2e@example.com',
      })
      .expect(201);
    const clientId = createResponse.body.id as string;

    await request(app.getHttpServer())
      .get('/frequent-clients')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toHaveLength(1));

    await request(app.getHttpServer())
      .delete(`/frequent-clients/${clientId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('exposes the subscription catalog', async () => {
    await request(app.getHttpServer())
      .get('/subscriptions/plans')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ plan: PlanType.FREE }),
            expect.objectContaining({ plan: PlanType.PRO }),
            expect.objectContaining({ plan: PlanType.BUSINESS }),
          ]),
        );
      });
  });
});

function assertTestDatabase(
  databaseUrl?: string,
): asserts databaseUrl is string {
  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required. It must point to an isolated test database.',
    );
  }

  const databaseName = new URL(databaseUrl).pathname.slice(1).toLowerCase();
  if (!databaseName.includes('test')) {
    throw new Error(
      `Refusing to run destructive E2E cleanup against database "${databaseName}". Its name must contain "test".`,
    );
  }
}

async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RateLimitEntry", "User" RESTART IDENTITY CASCADE',
  );
}

async function seedOwner(
  prisma: PrismaService,
  email: string,
  password: string,
  workspacePrefix: string,
) {
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: `${workspacePrefix} E2E Owner`,
      emailVerifiedAt: new Date(),
      plan: PlanType.BUSINESS,
    },
  });

  await prisma.workspace.create({
    data: {
      id: user.id,
      ownerId: user.id,
      name: `${workspacePrefix} E2E Workspace`,
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { workspaceId: user.id },
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId: user.id,
      userId: user.id,
      role: WorkspaceRole.OWNER,
    },
  });

  return user;
}

async function seedWorkspaceViewer(
  prisma: PrismaService,
  workspaceId: string,
  password: string,
) {
  const viewer = await prisma.user.create({
    data: {
      email: 'workspace-viewer@example.com',
      passwordHash: await bcrypt.hash(password, 4),
      name: 'E2E Viewer',
      emailVerifiedAt: new Date(),
      workspaceId,
      plan: PlanType.BUSINESS,
    },
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: viewer.id,
      role: WorkspaceRole.VIEWER,
    },
  });
}
