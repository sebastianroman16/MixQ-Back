import { AuthService } from './auth.service';

describe('AuthService registration privacy', () => {
  it('returns the same non-session response for an existing email', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-user' }),
      },
    };
    const mail = { isConfigured: jest.fn() };
    const service = new AuthService(
      prisma as never,
      {} as never,
      mail as never,
    );

    await expect(
      service.register({
        email: 'existing@example.com',
        password: 'a-long-enough-password',
      }),
    ).resolves.toEqual({
      success: true,
      message:
        'If the email can be registered, a verification link will be sent.',
    });
    expect(mail.isConfigured).not.toHaveBeenCalled();
  });
});
