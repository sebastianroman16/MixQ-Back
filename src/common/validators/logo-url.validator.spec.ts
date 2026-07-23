import { isValidLogoUrl } from './logo-url.validator';

function pngDataUrl(width: number, height: number, bytes = 24) {
  const image = Buffer.alloc(bytes);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  return `data:image/png;base64,${image.toString('base64')}`;
}

describe('IsLogoUrl', () => {
  it('accepts PNG logos up to 2MB and 16 megapixels', () => {
    expect(isValidLogoUrl(pngDataUrl(4000, 4000))).toBe(true);
  });

  it('rejects images over 16 megapixels', () => {
    expect(isValidLogoUrl(pngDataUrl(4001, 4000))).toBe(false);
  });

  it('rejects image payloads over 2MB', () => {
    expect(
      isValidLogoUrl(pngDataUrl(1, 1, 2 * 1024 * 1024 + 1)),
    ).toBe(false);
  });
});
