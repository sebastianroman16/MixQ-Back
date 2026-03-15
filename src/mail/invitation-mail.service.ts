import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InvitationMailService {
  private readonly logger = new Logger(InvitationMailService.name);
  private readonly resendApiKey: string;
  private readonly resendFrom: string;
  private readonly frontendBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.resendApiKey = this.configService.get<string>('RESEND_API_KEY', '');
    this.resendFrom = this.configService.get<string>('RESEND_FROM_EMAIL', 'no-reply@mixq.app');
    this.frontendBaseUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
  }

  buildInvitationUrl(token: string): string {
    const base = this.frontendBaseUrl.replace(/\/+$/, '');
    return `${base}/invitacion/${token}`;
  }

  private buildMessageFromStatus(status: number): string {
    if (status === 401 || status === 403) {
      return 'AUTH_ERROR';
    }
    if (status === 422) {
      return 'INVALID_FROM_OR_PAYLOAD';
    }
    if (status >= 500) {
      return 'PROVIDER_UNAVAILABLE';
    }
    return 'PROVIDER_ERROR';
  }

  async sendWorkspaceInvitationEmail(input: {
    to: string;
    invitedUserName: string;
    workspaceName: string;
    invitedByName?: string | null;
    roleLabel: string;
    token: string;
    temporaryPassword: string;
  }): Promise<{ sent: boolean; code: 'SENT' | 'SKIPPED_NOT_CONFIGURED' | 'FAILED'; detail?: string }> {
    const invitationUrl = this.buildInvitationUrl(input.token);

    if (!this.resendApiKey) {
      this.logger.warn(`RESEND_API_KEY not configured. Invitation email skipped for ${input.to}. URL: ${invitationUrl}`);
      return { sent: false, code: 'SKIPPED_NOT_CONFIGURED' };
    }

    const inviter = input.invitedByName?.trim() || 'Tu equipo';

    const html = `
      <div style="font-family: Arial, sans-serif; color:#0f172a; line-height:1.5;">
        <h2>Invitacion a ${input.workspaceName}</h2>
        <p>Hola <strong>${input.invitedUserName}</strong>, ${inviter} te invito al equipo con rol <strong>${input.roleLabel}</strong>.</p>
        <p>Tu acceso temporal es:</p>
        <p><strong>Correo:</strong> ${input.to}<br/><strong>Contrasena temporal:</strong> ${input.temporaryPassword}</p>
        <p>Al activar la invitacion deberas cambiar esta contrasena por una definitiva.</p>
        <p>
          <a href="${invitationUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;">
            Activar invitacion
          </a>
        </p>
        <p>Si el boton no funciona, copia este enlace:</p>
        <p><a href="${invitationUrl}">${invitationUrl}</a></p>
        <p style="font-size:12px;color:#64748b;">Este enlace puede expirar en 7 dias.</p>
      </div>
    `;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.resendFrom,
          to: [input.to],
          subject: `Invitacion a ${input.workspaceName}`,
          html,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`Resend failed (${response.status}): ${body}`);
        return {
          sent: false,
          code: 'FAILED',
          detail: this.buildMessageFromStatus(response.status),
        };
      }

      this.logger.log(`Invitation email sent to ${input.to}`);
      return { sent: true, code: 'SENT' };
    } catch (error) {
      this.logger.error(`Invitation email error for ${input.to}`, error as Error);
      return { sent: false, code: 'FAILED', detail: 'NETWORK_OR_PROVIDER_ERROR' };
    }
  }
}
