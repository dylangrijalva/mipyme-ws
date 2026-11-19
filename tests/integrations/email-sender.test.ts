import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/infra/config.env.ts";
import { EmailSender, type SendEmployeeInvitationParams } from "../../src/integrations/email-sender.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

const INVITATION: SendEmployeeInvitationParams = {
  invitationId: "invt_K7Q4MZ8P2D9XW3LT5R",
  to: "nami@strawhatpirates.example.com",
  employeeName: "Nami",
  inviterName: "Monkey D. Luffy",
  merchantName: "Baratie Market",
  country: "co",
  expiresInDays: 7,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(environment: Environment = "production") {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ id: "email_1" }));
  vi.stubGlobal("fetch", fetch);
  const logger = pino({ enabled: false });
  const error = vi.spyOn(logger, "error");
  vi.spyOn(logger, "child").mockReturnValue(logger as unknown as ReturnType<typeof logger.child>);
  const sender = new EmailSender({ env: createRealtimeEnv(environment), logger });
  return { fetch, error, sender };
}

function sentEmail(fetch: ReturnType<typeof setup>["fetch"]) {
  const [url, init] = fetch.mock.calls[0]!;
  return { url, headers: init?.headers, body: JSON.parse(String(init?.body)) };
}

describe("EmailSender", () => {
  it.each(["test", "development"] as const)("does not contact Resend in %s", async (environment) => {
    const { fetch, sender } = setup(environment);

    await sender.sendEmployeeInvitation(INVITATION);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a Spanish invitation through Resend with a link to the invitation", async () => {
    const { fetch, sender } = setup("staging");

    await sender.sendEmployeeInvitation(INVITATION);

    const email = sentEmail(fetch);
    expect(email.url).toBe("https://api.resend.com/emails");
    expect(email.headers).toEqual({
      Authorization: "Bearer test-resend-key",
      "Content-Type": "application/json",
      "Idempotency-Key": "employee-invitation/invt_K7Q4MZ8P2D9XW3LT5R",
    });
    expect(email.body).toMatchObject({
      from: "Mipyme <hello@strawhatpirates.example.com>",
      to: ["nami@strawhatpirates.example.com"],
      subject: "Monkey D. Luffy te invitó a unirte a Baratie Market en Mipyme",
    });
    const link = "https://app.strawhatpirates.example.com/invitations/invt_K7Q4MZ8P2D9XW3LT5R";
    expect(email.body.html).toContain(`href="${link}"`);
    expect(email.body.text).toContain(link);
    expect(email.body.text).toContain("vence en 7 días");
  });

  it("writes the invitation in English for merchants in Belize", async () => {
    const { fetch, sender } = setup();

    await sender.sendEmployeeInvitation({ ...INVITATION, country: "bz" });

    const email = sentEmail(fetch);
    expect(email.body.subject).toBe("Monkey D. Luffy invited you to join Baratie Market on Mipyme");
    expect(email.body.text).toContain("expires in 7 days");
  });

  it("escapes names in the HTML body", async () => {
    const { fetch, sender } = setup();

    await sender.sendEmployeeInvitation({ ...INVITATION, merchantName: `<script>alert("Buggy")</script> & Co` });

    const { html } = sentEmail(fetch).body;
    expect(html).toContain("&lt;script&gt;alert(&quot;Buggy&quot;)&lt;/script&gt; &amp; Co");
    expect(html).not.toContain("<script>");
  });

  it("logs instead of failing when Resend is unreachable or rejects the email", async () => {
    const { fetch, error, sender } = setup();
    fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetch.mockResolvedValueOnce(Response.json({ message: "Invalid `from` field." }, { status: 422 }));

    await expect(sender.sendEmployeeInvitation(INVITATION)).resolves.toBeUndefined();
    await expect(sender.sendEmployeeInvitation(INVITATION)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 422, invitationId: INVITATION.invitationId }),
      expect.any(String),
    );
  });
});
