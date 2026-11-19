import type { Logger } from "pino";
import type { CountryIsoCode } from "../contracts/country-iso-code.ts";
import type { EnvVars } from "../infra/config.env.ts";

const RESEND_EMAILS_URL = "https://api.resend.com/emails" as const;

type InjectedDependencies = {
  env: EnvVars;
  logger: Logger;
};

type SendEmployeeInvitationParams = {
  invitationId: string;
  to: string;
  employeeName: string;
  inviterName: string;
  merchantName: string;
  country: CountryIsoCode;
  expiresInDays: number;
};

type Language = "en" | "es";

type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

class EmailSender {
  private readonly logger: Logger;
  private readonly env: EnvVars;

  constructor({ env, logger }: InjectedDependencies) {
    this.logger = logger.child({ component: this.constructor.name });
    this.env = env;
  }

  async sendEmployeeInvitation(params: SendEmployeeInvitationParams): Promise<void> {
    const shouldSendEmails = this.env.NODE_ENV === "staging" || this.env.NODE_ENV === "production";
    if (!shouldSendEmails) {
      this.logger.debug({ invitationId: params.invitationId }, "Emails are skipped outside staging and production");
      return;
    }

    const link = new URL(`/invitations/${encodeURIComponent(params.invitationId)}`, this.env.APP_URL).toString();
    const content = this.composeEmployeeInvitation(params, link);
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `employee-invitation/${params.invitationId}`,
      },
      body: JSON.stringify({ from: this.env.EMAIL_FROM, to: [params.to], ...content }),
    }).catch((error: unknown) => {
      this.logger.error({ err: error, invitationId: params.invitationId }, "The invitation email could not be sent");
      return null;
    });

    if (!response) {
      return;
    }

    if (!response.ok) {
      const details = await response.text().catch(() => null);
      this.logger.error(
        { invitationId: params.invitationId, status: response.status, details },
        "The email provider rejected the invitation email",
      );
      return;
    }

    this.logger.info({ invitationId: params.invitationId }, "The invitation email has been sent");
  }

  private composeEmployeeInvitation(params: SendEmployeeInvitationParams, link: string): EmailContent {
    const language: Language = params.country === "bz" ? "en" : "es";
    const employeeName = escapeHtml(params.employeeName);
    const inviterName = escapeHtml(params.inviterName);
    const merchantName = escapeHtml(params.merchantName);
    const email = escapeHtml(params.to);
    const href = escapeHtml(link);

    if (language === "en") {
      const subject = `${params.inviterName} invited you to join ${params.merchantName} on Mipyme`;
      const lines = [
        `Hi ${params.employeeName},`,
        `${params.inviterName} invited you to create your Mipyme account to work at ${params.merchantName}.`,
        `Sign in or sign up with ${params.to} to accept the invitation: ${link}`,
        `This invitation expires in ${params.expiresInDays} days. If you weren't expecting it, you can ignore this email.`,
      ];

      return {
        subject,
        text: lines.join("\n\n"),
        html: [
          `<p>Hi ${employeeName},</p>`,
          `<p>${inviterName} invited you to create your Mipyme account to work at <strong>${merchantName}</strong>.</p>`,
          `<p>Sign in or sign up with <strong>${email}</strong> to accept the invitation.</p>`,
          `<p><a href="${href}">Accept the invitation</a></p>`,
          `<p>This invitation expires in ${params.expiresInDays} days. If you weren't expecting it, you can ignore this email.</p>`,
        ].join(""),
      };
    }

    const subject = `${params.inviterName} te invitó a unirte a ${params.merchantName} en Mipyme`;
    const lines = [
      `Hola ${params.employeeName}:`,
      `${params.inviterName} te invitó a crear tu cuenta de Mipyme para trabajar en ${params.merchantName}.`,
      `Inicia sesión o regístrate con ${params.to} para aceptar la invitación: ${link}`,
      `Esta invitación vence en ${params.expiresInDays} días. Si no la esperabas, puedes ignorar este correo.`,
    ];

    return {
      subject,
      text: lines.join("\n\n"),
      html: [
        `<p>Hola ${employeeName}:</p>`,
        `<p>${inviterName} te invitó a crear tu cuenta de Mipyme para trabajar en <strong>${merchantName}</strong>.</p>`,
        `<p>Inicia sesión o regístrate con <strong>${email}</strong> para aceptar la invitación.</p>`,
        `<p><a href="${href}">Aceptar la invitación</a></p>`,
        `<p>Esta invitación vence en ${params.expiresInDays} días. Si no la esperabas, puedes ignorar este correo.</p>`,
      ].join(""),
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export { EmailSender, type SendEmployeeInvitationParams };
