import { registerDecorator, ValidationOptions } from 'class-validator';

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
            return true;
          }

          if (!value.startsWith('data:')) {
            return false;
          }

          const match = value.match(
            /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,(.*)$/s,
          );
          if (!match) {
            return false;
          }

          const base64Payload = match[1].replace(/\s/g, '');
          let payloadSize = 0;
          try {
            payloadSize = Buffer.from(base64Payload, 'base64').length;
          } catch {
            return false;
          }

          const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
          return payloadSize <= maxBytes;
        },
        defaultMessage() {
          const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
          const maxMb = Math.round(maxBytes / 1024 / 1024);
          return `logoUrl must be an http(s) URL or a base64 data URL up to ${maxMb}MB`;
        },
      },
    });
  };
}
