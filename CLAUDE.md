# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backend API for MixQ, a SaaS for business quotes (cotizaciones). NestJS 11 + Prisma 7 + PostgreSQL, deployed on Railway. Package manager is **pnpm**.

## Commands

```bash
pnpm run start:dev              # dev server with watch (port 3000)
pnpm run build                  # prisma generate + nest build
pnpm run lint                   # eslint with --fix
pnpm run test                   # jest (unit tests, *.spec.ts colocated in src/)
pnpm run test -- quote-totals   # run a single test file by name pattern
pnpm run test:e2e               # jest with test/jest-e2e.json
npx prisma migrate dev --name <name>   # create/apply a migration
pnpm run seed:massive           # seed dev data (--reset variant wipes first)
docker compose up -d            # local Postgres on port 41137 (db "railway", user/pass postgres)
```

Prisma config lives in `prisma.config.ts` (not in schema datasource); it loads `DATABASE_URL` from `.env`. `prisma generate` runs on postinstall and as part of build. See `.env.example` for all required env vars.

## Architecture

Modular NestJS monolith. Each domain (auth, services, templates, quotes, dashboard, sender-profile, subscriptions, workspace, frequent-clients) is a standard module with controller/service/dto. There is no global guard — controllers apply `JwtAuthGuard` explicitly.

### Multi-tenancy: workspaces

All business data is scoped by `workspaceId`, not by user. The flow that ties it together:

- JWT payload carries `sub` (userId), `tokenVersion`, and `workspaceId`.
- `JwtAuthGuard` (src/auth/guards/jwt-auth.guard.ts) verifies the token against the DB (single query: user + memberships): rejects if `user.tokenVersion` mismatches (token revocation mechanism) or if the user has no `WorkspaceMember` row for their workspace. The resolved user is cached in memory per `userId` with a short TTL (`AUTH_USER_CACHE_TTL_MS`, default 30s, 0 disables) — so role/membership changes can take up to the TTL to propagate, and a revoked token can survive at most the TTL. It attaches `{ id, email, tokenVersion, workspaceId, role }` to `request.user`, read via the `@CurrentUser()` decorator.
- Role-based access uses `WorkspaceRoleGuard` + `@RequireWorkspaceRoles(...)`. Roles are OWNER/ADMIN/EDITOR/VIEWER; the capability→roles mapping is centralized in `src/workspace/workspace-capabilities.ts` — extend that map rather than hardcoding role lists in controllers.

Services must always filter queries by `workspaceId` from the authenticated user.

### Database access

`PrismaService` (src/prisma/prisma.service.ts) extends PrismaClient using the **pg driver adapter** (`@prisma/adapter-pg` with an explicit `Pool`). Pool sizing/timeouts come from `PG_*` env vars; SSL is enabled automatically unless the URL points to localhost. Connection has retry logic on startup.

Quotes store **snapshots**: creating a quote copies the template into `QuoteSection`/`QuoteSectionItem` and computes totals server-side (`src/quotes/utils/quote-totals.ts`), so later template edits don't mutate existing quotes.

### Billing (Flow)

Subscriptions integrate with Flow (Chilean payment gateway) via `src/subscriptions/flow/flow-client.service.ts` — every API call is HMAC-SHA256 signed with `FLOW_SECRET_KEY`. Plans (FREE/PRO/BUSINESS) and their quota limits live in `src/subscriptions/subscriptions.constants.ts`. Flow calls back to `PUBLIC_API_URL` (must be publicly reachable); the overdue-reconciliation endpoint `POST /subscriptions/cron/reconcile-overdue` is protected by the `x-billing-cron-secret` header. The backend never stores card data.

### PDF generation

Quote PDFs are rendered with Puppeteer via `PdfRendererService` (src/quotes/pdf/pdf-renderer.service.ts), which keeps a singleton browser instance alive (relaunched if it disconnects) and opens a page per export. The HTML comes from `src/quotes/pdf/quote-pdf.template.ts`. Remote images (logos) are gated through `src/common/security/remote-asset-url.ts` against `ALLOWED_ASSET_HOSTS` (SSRF protection — required in production). `PUPPETEER_EXECUTABLE_PATH` can override the Chrome binary locally.

### Other cross-cutting details

- Global `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true, transform: true` — any request field not declared in a DTO causes a 400, so DTOs must be complete.
- CORS is driven by the `CORS_ORIGINS` env var (comma-separated); in production no origins configured means CORS is off.
- Invitation emails go through Resend (`src/mail/invitation-mail.service.ts`); without `RESEND_API_KEY` the invitation is still created and the `invitationUrl` is returned as fallback. Links point to `${FRONTEND_URL}/invitacion/:token`.
- Uploaded logos are served statically from `uploads/` under the `/uploads` prefix.
- Auth endpoints are rate-limited via `AuthRateLimitGuard` (in-memory).

## Notes

- The README's endpoint list and "Estado" section are partially outdated (e.g. mentions a `stats` module that no longer exists; auth and persistence are fully implemented). Trust the code over the README.
- Commit messages in this repo are in Spanish.
