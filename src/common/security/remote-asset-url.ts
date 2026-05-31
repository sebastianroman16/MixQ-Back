import { isIP } from 'net';

export function isAllowedRemoteAssetUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith('data:')) {
    return true;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  if (url.username || url.password) {
    return false;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return false;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    return false;
  }

  const allowedHosts = getAllowedAssetHosts();
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    return false;
  }

  return true;
}

export function getAllowedAssetHosts(): string[] {
  return (process.env.ALLOWED_ASSET_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isBlockedHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost')
  ) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isBlockedIpv4(hostname);
  }
  if (ipVersion === 6) {
    return isBlockedIpv6(hostname);
  }

  return false;
}

function isBlockedIpv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}
