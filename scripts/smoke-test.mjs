const baseUrl = requiredEnv('SMOKE_BASE_URL').replace(/\/$/, '');
const publicOnly = process.env.SMOKE_PUBLIC_ONLY === 'true';
const requireIntegrations = process.env.SMOKE_REQUIRE_INTEGRATIONS === 'true';

await check('liveness', '/health/live', { expectedStatus: 200 });
const readiness = await check('readiness', '/health/ready', {
  expectedStatus: 200,
});
await check('subscription catalog', '/subscriptions/plans', {
  expectedStatus: 200,
});

if (requireIntegrations) {
  const configuration = readiness.body?.checks?.configuration;
  if (!configuration?.mail || !configuration?.billing) {
    fail('readiness integrations', 'mail and billing must both be configured');
  }
  pass('readiness integrations');
}

if (!publicOnly) {
  const email = requiredEnv('SMOKE_EMAIL');
  const password = requiredEnv('SMOKE_PASSWORD');
  const login = await check('login', '/auth/login', {
    method: 'POST',
    expectedStatus: [200, 201],
    body: { email, password },
  });
  const accessToken = login.body?.accessToken;
  if (!accessToken) {
    fail('login', 'response did not include accessToken');
  }

  const authenticatedChecks = [
    ['current user', '/auth/me'],
    ['workspace', '/workspace/me'],
    ['services', '/services?limit=1'],
    ['service counts', '/services/counts'],
    ['frequent clients', '/frequent-clients'],
    ['templates', '/templates'],
    ['quotes', '/quotes'],
    ['subscription', '/subscriptions/me'],
    ['dashboard', '/dashboard/overview'],
    ['sender profile', '/sender-profile'],
  ];

  for (const [name, path] of authenticatedChecks) {
    await check(name, path, {
      expectedStatus: 200,
      accessToken,
    });
  }
}

process.stdout.write('Smoke test completed successfully.\n');

async function check(
  name,
  path,
  { method = 'GET', expectedStatus, body, accessToken } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(Number(process.env.SMOKE_TIMEOUT_MS ?? 15000)),
  }).catch((error) => fail(name, error.message));

  const responseBody = await response
    .json()
    .catch(() => ({ nonJsonResponse: true }));
  const acceptedStatuses = Array.isArray(expectedStatus)
    ? expectedStatus
    : [expectedStatus];
  if (!acceptedStatuses.includes(response.status)) {
    fail(
      name,
      `expected ${acceptedStatuses.join('/')} but got ${response.status}`,
    );
  }

  pass(name);
  return { status: response.status, body: responseBody };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    process.stderr.write(`Missing required environment variable: ${name}\n`);
    process.exit(1);
  }
  return value;
}

function pass(name) {
  process.stdout.write(`PASS ${name}\n`);
}

function fail(name, reason) {
  process.stderr.write(`FAIL ${name}: ${reason}\n`);
  process.exit(1);
}
