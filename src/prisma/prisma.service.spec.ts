import { resolvePgSsl } from './prisma.service';

describe('resolvePgSsl', () => {
  const remoteUrl = 'postgresql://user:password@db.example.com:5432/app';

  it('uses encrypted TLS without CA verification in require mode', () => {
    expect(resolvePgSsl(remoteUrl, 'require')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('keeps strict verification for verify-full and supports escaped CA text', () => {
    expect(resolvePgSsl(remoteUrl, 'verify-full', 'line-1\\nline-2')).toEqual({
      rejectUnauthorized: true,
      ca: 'line-1\nline-2',
    });
  });

  it('honors sslmode from the connection URL', () => {
    expect(resolvePgSsl(`${remoteUrl}?sslmode=require`)).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('disables TLS explicitly or for localhost by default', () => {
    expect(resolvePgSsl(remoteUrl, 'disable')).toBeUndefined();
    expect(
      resolvePgSsl('postgresql://user:password@localhost:5432/app'),
    ).toBeUndefined();
  });

  it('uses strict verification for remote connections without a mode', () => {
    expect(resolvePgSsl(remoteUrl)).toEqual({ rejectUnauthorized: true });
  });
});
