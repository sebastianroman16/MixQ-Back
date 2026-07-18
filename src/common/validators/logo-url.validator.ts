import { registerDecorator, ValidationOptions } from 'class-validator';
import { isAllowedRemoteAssetUrl } from '../security/remote-asset-url';

type LogoUrlValidatorOptions = {
  maxBytes?: number;
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

          const base64Payload = match[1].replace(/\s/g, '');
          let image: Buffer;
          try {
            image = Buffer.from(base64Payload, 'base64');
          } catch {
            return false;
          }

          const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
          return image.length <= maxBytes && isSafeLogoImage(image, match[1]);
        },
        defaultMessage() {
          const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
          const maxMb = Math.round(maxBytes / 1024 / 1024);
          return `logoUrl must be a PNG or JPEG base64 data URL up to ${maxMb}MB and 4 megapixels`;
        },
      },
    });
  };
}

const MAX_LOGO_PIXELS = 4_000_000;

function isSafeLogoImage(image: Buffer, mime: string) {
  const dimensions =
    mime.toLowerCase() === 'png'
      ? getPngDimensions(image)
      : getJpegDimensions(image);
  return (
    dimensions !== null &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width * dimensions.height <= MAX_LOGO_PIXELS
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
