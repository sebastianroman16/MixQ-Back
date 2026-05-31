import { ConfigService } from '@nestjs/config';
import { FlowClientService } from './flow-client.service';

describe('FlowClientService', () => {
  it('signs params in Flow alphabetical format', () => {
    const config = {
      get: (key: string, fallback?: string) => {
        const values: Record<string, string> = {
          FLOW_API_KEY: 'api-key',
          FLOW_SECRET_KEY: 'secret',
        };
        return values[key] ?? fallback;
      },
    } as ConfigService;
    const service = new FlowClientService(config);

    expect(
      service.signParams({
        currency: 'CLP',
        amount: 5000,
        apiKey: 'api-key',
      }),
    ).toBe('14cd27edacd346f077358114d554d5ea59d6a1ded7179edf013b3e6437e71868');
  });
});
