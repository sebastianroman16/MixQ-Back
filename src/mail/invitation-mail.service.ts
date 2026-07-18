import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InvitationMailService {
  private readonly logger = new Logger(InvitationMailService.name);
  private readonly resendApiKey: string;
  private readonly resendFrom: string;
  private readonly frontendBaseUrl: string;
  private readonly mailTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.resendApiKey = this.configService.get<string>('RESEND_API_KEY', '');
    this.resendFrom = this.configService.get<string>(
      'RESEND_FROM_EMAIL',
      'no-reply@mixq.app',
    );
    this.frontendBaseUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:4200',
    );
    this.mailTimeoutMs = this.getPositiveNumber('MAIL_TIMEOUT_MS', 10_000);

    this.logger.log(
      `Mail config loaded | apiKey=${this.resendApiKey ? 'configured' : 'missing'} | from=${this.resendFrom} | frontend=${this.frontendBaseUrl}`,
    );
  }

  buildInvitationUrl(token: string): string {
    const base = this.frontendBaseUrl.replace(/\/+$/, '');
    return `${base}/invitacion/${token}`;
  }

  isConfigured() {
    return Boolean(this.resendApiKey);
  }

  async sendEmailVerificationEmail(input: {
    to: string;
    name?: string | null;
    token: string;
  }) {
    if (!this.resendApiKey) {
      return { sent: false };
    }

    const base = this.frontendBaseUrl.replace(/\/+$/, '');
    const verificationUrl = `${base}/verificar-correo?token=${encodeURIComponent(input.token)}`;
    const name = this.escapeHtml(input.name?.trim() || '');
    const safeUrl = this.escapeHtml(verificationUrl);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(this.mailTimeoutMs),
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.resendFrom,
        to: [input.to],
        subject: 'Verifica tu correo en MixQ',
        html: `<p>Hola ${name}, confirma tu correo para activar tu cuenta.</p><p><a href="${safeUrl}">Verificar correo</a></p><p>Este enlace expira en 24 horas.</p>`,
      }),
    });

    if (!response.ok) {
      this.logger.error(`Verification email failed (${response.status})`);
      return { sent: false };
    }

    return { sent: true };
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

  private getPositiveNumber(key: string, fallback: number): number {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  async sendWorkspaceInvitationEmail(input: {
    to: string;
    invitedUserName: string;
    workspaceName: string;
    invitedByName?: string | null;
    roleLabel: string;
    token: string;
    temporaryPassword: string;
  }): Promise<{
    sent: boolean;
    code: 'SENT' | 'SKIPPED_NOT_CONFIGURED' | 'FAILED';
    detail?: string;
  }> {
    const invitationUrl = this.buildInvitationUrl(input.token);

    if (!this.resendApiKey) {
      this.logger.warn(
        `RESEND_API_KEY not configured. Invitation email skipped for ${input.to}. URL: ${invitationUrl}`,
      );
      return { sent: false, code: 'SKIPPED_NOT_CONFIGURED' };
    }

    const inviter = input.invitedByName?.trim() || 'Tu equipo';
    const escaped = {
      workspaceName: this.escapeHtml(input.workspaceName),
      invitedUserName: this.escapeHtml(input.invitedUserName),
      inviter: this.escapeHtml(inviter),
      roleLabel: this.escapeHtml(input.roleLabel),
      to: this.escapeHtml(input.to),
      temporaryPassword: this.escapeHtml(input.temporaryPassword),
      invitationUrl: this.escapeHtml(invitationUrl),
    };

    const html = `
      <div style="font-family: Arial, sans-serif; color:#0f172a; line-height:1.5;">
        <h2>Invitacion a ${escaped.workspaceName}</h2>
        <p>Hola <strong>${escaped.invitedUserName}</strong>, ${escaped.inviter} te invito al equipo con rol <strong>${escaped.roleLabel}</strong>.</p>
        <p>Tu acceso temporal es:</p>
        <p><strong>Correo:</strong> ${escaped.to}<br/><strong>Contrasena temporal:</strong> ${escaped.temporaryPassword}</p>
        <p>Al activar la invitacion deberas cambiar esta contrasena por una definitiva.</p>
        <p>
          <a href="${escaped.invitationUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;">
            Activar invitacion
          </a>
        </p>
        <p>Si el boton no funciona, copia este enlace:</p>
        <p><a href="${escaped.invitationUrl}">${escaped.invitationUrl}</a></p>
        <p style="font-size:12px;color:#64748b;">Este enlace puede expirar en 7 dias.</p>
      </div>
    `;

    this.logger.log(
      `Sending workspace invitation email to ${input.to} using from=${this.resendFrom}`,
    );

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(this.mailTimeoutMs),
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
      this.logger.error(
        `Invitation email error for ${input.to}`,
        error as Error,
      );
      return {
        sent: false,
        code: 'FAILED',
        detail: 'NETWORK_OR_PROVIDER_ERROR',
      };
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
