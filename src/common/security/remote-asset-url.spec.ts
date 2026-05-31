import { isAllowedRemoteAssetUrl } from './remote-asset-url';

describe('isAllowedRemoteAssetUrl', () => {
  const previousAllowedHosts = process.env.ALLOWED_ASSET_HOSTS;

  afterEach(() => {
    if (previousAllowedHosts === undefined) {
      delete process.env.ALLOWED_ASSET_HOSTS;
    } else {
      process.env.ALLOWED_ASSET_HOSTS = previousAllowedHosts;
    }
  });

  it('allows data URLs for embedded assets', () => {
    expect(isAllowedRemoteAssetUrl('data:image/png;base64,AAAA')).toBe(true);
  });

  it('blocks local and private network URLs', () => {
    expect(isAllowedRemoteAssetUrl('http://localhost/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://127.0.0.1/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://10.0.0.5/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://192.168.1.10/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://[::1]/logo.png')).toBe(false);
  });

  it('enforces an optional host allowlist', () => {
    process.env.ALLOWED_ASSET_HOSTS = 'cdn.example.com';

    expect(isAllowedRemoteAssetUrl('https://cdn.example.com/logo.png')).toBe(
      true,
    );
    expect(isAllowedRemoteAssetUrl('https://assets.example.com/logo.png')).toBe(
      false,
    );
  });
});
