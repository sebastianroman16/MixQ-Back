import { registerDecorator, ValidationOptions } from 'class-validator';
import { isAllowedRemoteAssetUrl } from '../security/remote-asset-url';

export type LogoUrlValidatorOptions = {
  maxBytes?: number;
  maxPixels?: number;
};

export function IsLogoUrl(
  options?: LogoUrlValidatorOptions,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isLogoUrl',
      target: object.constructor,
      propertyName,
      constraints: [options],
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isValidLogoUrl(value, options);
        },
        defaultMessage() {
          const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
          const maxMb = Math.round(maxBytes / 1024 / 1024);
          const maxPixels = options?.maxPixels ?? DEFAULT_MAX_LOGO_PIXELS;
          const maxMegapixels = maxPixels / 1_000_000;
          return `logoUrl must be a PNG or JPEG base64 data URL up to ${maxMb}MB and ${maxMegapixels} megapixels`;
        },
      },
    });
  };
}

const DEFAULT_MAX_LOGO_PIXELS = 16_000_000;

export function isValidLogoUrl(
  value: unknown,
  options?: LogoUrlValidatorOptions,
) {
  if (typeof value !== 'string') {
    return false;
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return isAllowedRemoteAssetUrl(value);
  }

  if (!value.startsWith('data:')) {
    return false;
  }

  const match = value.match(/^data:image\/(png|jpeg);base64,(.*)$/is);
  if (!match) {
    return false;
  }

  const base64Payload = match[2].replace(/\s/g, '');
  let image: Buffer;
  try {
    image = Buffer.from(base64Payload, 'base64');
  } catch {
    return false;
  }

  const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
  const maxPixels = options?.maxPixels ?? DEFAULT_MAX_LOGO_PIXELS;
  return (
    image.length <= maxBytes &&
    isSafeLogoImage(image, match[1], maxPixels)
  );
}

function isSafeLogoImage(image: Buffer, mime: string, maxPixels: number) {
  const dimensions =
    mime.toLowerCase() === 'png'
      ? getPngDimensions(image)
      : getJpegDimensions(image);
  return (
    dimensions !== null &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width * dimensions.height <= maxPixels
  );
}

function getPngDimensions(image: Buffer) {
  const signature = '89504e470d0a1a0a';
  if (image.length < 24 || image.subarray(0, 8).toString('hex') !== signature) {
    return null;
  }
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

function getJpegDimensions(image: Buffer) {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      return null;
    }
    const marker = image[offset + 1];
    offset += 2;
    while (marker === 0xff && offset < image.length) {
      offset += 1;
    }
    if (offset + 2 > image.length) {
      return null;
    }
    const length = image.readUInt16BE(offset);
    if (length < 2 || offset + length > image.length) {
      return null;
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: image.readUInt16BE(offset + 3),
        width: image.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}
