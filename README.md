<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>

# mixq-back

Backend API en NestJS para MixQ (SaaS de cotizaciones empresariales).
Arquitectura modular con Prisma + PostgreSQL y seguridad con JWT.

## Requisitos

- Node.js (LTS recomendado)
- pnpm
- PostgreSQL

## Instalacion

```bash
pnpm install
```

## Configuracion

Variables esperadas:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public"
JWT_SECRET="change-me"
JWT_EXPIRES_IN="1d"
```

## Comandos utiles

```bash
# desarrollo
pnpm run start:dev

# produccion
pnpm run build
pnpm run start:prod

# lint y format
pnpm run lint
pnpm run format

# tests
pnpm run test
pnpm run test:e2e
pnpm run test:cov
```

## Endpoints actuales

Base URL local: `http://localhost:3000`

### Salud

- `GET /` -> "Hello World!"

### Auth

- `POST /auth/register`
- `POST /auth/login` (retorna 200)
- `GET /auth/me`

### Services

- `POST /services`
- `GET /services`
- `GET /services/:id`
- `PATCH /services/:id`
- `DELETE /services/:id`

### Service categories

- `POST /services/categories`
- `GET /services/categories`
- `GET /services/categories/:id`
- `PATCH /services/categories/:id`
- `DELETE /services/categories/:id`

### Templates

- `GET /templates?type=system|user`
- `GET /templates/:id`
- `POST /templates`
- `POST /templates/:id/clone`
- `PATCH /templates/:id`
- `DELETE /templates/:id`

### Quotes

- `POST /quotes`
- `GET /quotes`
- `GET /quotes/:id`
- `PATCH /quotes/:id`
- `DELETE /quotes/:id`

### Sender profile

- `GET /sender-profile`
- `PUT /sender-profile`

### Subscriptions

- `GET /subscriptions/me`

### Stats

- `POST /stats`
- `GET /stats`
- `GET /stats/:id`
- `PATCH /stats/:id`
- `DELETE /stats/:id`

## Modelo de datos (Prisma)

Archivo: `prisma/schema.prisma`

- `User`: cuenta del sistema; propietario de todos los datos (multiusuario por `userId`).
- `Service`: catalogo de servicios del usuario con inventario (codigo, categoria, precio unitario, stock).
- `Category`: categorias de servicios por usuario.
- `Template`: plantilla de cotizacion (system/user) con secciones editables.
- `TemplateSection`: bloque de la plantilla (header, cliente, tabla, totales, etc.).
- `TemplateItem`: campo dentro de cada seccion (texto, campo, columna).
- `Quote`: cotizacion generada; snapshot de plantilla y totales calculados en backend.
- `QuoteSection`: snapshot de secciones de plantilla.
- `QuoteSectionItem`: snapshot de items de seccion.
- `QuoteItem`: filas de servicios (items) con precios y cantidades.
- `User.onboardingCompleted`: true si existe displayName + contactEmail.
- `User.plan`: FREE | PRO (default FREE).
- `User.subscriptionStatus`: ACTIVE | CANCELED | PAST_DUE.
- `User.currentPeriodEnd`: fin de ciclo (opcional).
- `SenderProfile`: perfil del emisor (displayName, contacto, legales opcionales).
- `QuoteStatus`: estado de la cotizacion (DRAFT, SENT, ACCEPTED, REJECTED, CANCELLED).

## Estructura

```text
prisma/
  schema.prisma
src/
  app.module.ts
  auth/
    auth.controller.ts
    auth.service.ts
    dto/
  stats/
    stats.controller.ts
    stats.service.ts
    dto/
```

## Estado

- El esquema Prisma base ya esta definido.
- Aun no hay persistencia ni auth real configurada.
