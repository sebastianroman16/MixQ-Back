import { isAllowedRemoteAssetUrl } from './remote-asset-url';

describe('isAllowedRemoteAssetUrl', () => {
  it('allows safe image data URLs for embedded assets', () => {
    expect(isAllowedRemoteAssetUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isAllowedRemoteAssetUrl('data:text/html;base64,AAAA')).toBe(false);
    expect(isAllowedRemoteAssetUrl('data:image/gif;base64,AAAA')).toBe(false);
  });

  it('blocks all remote URLs so the PDF renderer never fetches a user URL', () => {
    expect(isAllowedRemoteAssetUrl('http://localhost/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://127.0.0.1/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://10.0.0.5/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://192.168.1.10/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://[::1]/logo.png')).toBe(false);
    expect(isAllowedRemoteAssetUrl('http://[::ffff:127.0.0.1]/logo.png')).toBe(
      false,
    );
    expect(isAllowedRemoteAssetUrl('https://cdn.example.com/logo.png')).toBe(
      false,
    );
  });

  it('does not enable remote URLs through configuration', () => {
    process.env.ALLOWED_ASSET_HOSTS = 'cdn.example.com';
    expect(isAllowedRemoteAssetUrl('https://cdn.example.com/logo.png')).toBe(
      false,
    );
  });
});
