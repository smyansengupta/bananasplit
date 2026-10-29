import { afterEach, describe, expect, it, vi } from "vitest";

import { emailConfigProblems, emailDelivery, fromMatchesAppDomain } from "./config";
import { displayName, escapeHtml, safeHref, subjectLine } from "./escape";
import {
  EMAIL_COLORS,
  invitationEmail,
  notificationEmail,
  passwordResetEmail,
  reimbursementStatusEmail,
  testEmail,
  treasurerDigestEmail,
  trialEndingEmail,
  verifyEmailEmail,
} from "./templates";

const XSS = `<img src=x onerror="alert('x')">`;

describe("escaping", () => {
  it("escapes HTML, rejects non-http links and flattens subjects", () => {
    expect(escapeHtml(XSS)).toBe("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;");
    expect(() => safeHref("javascript:alert(1)")).toThrow();
    expect(() => safeHref("/app/x")).toThrow();
    expect(safeHref("https://x.org/a?b=1&c=2")).toBe("https://x.org/a?b=1&amp;c=2");
    expect(subjectLine("Hi\r\nBcc: victim@x.org")).toBe("Hi Bcc: victim@x.org");
    expect(displayName('Evil" <a@b.c>')).toBe("Evil a@b.c");
  });
});

describe("templates", () => {
  it("escape every interpolated value", () => {
    const rendered = [
      notificationEmail({ orgName: XSS, title: XSS, body: XSS, url: "https://p.org/app/x" }),
      invitationEmail({
        orgName: XSS,
        inviterName: XSS,
        role: "MEMBER",
        acceptUrl: "https://p.org/invite/tok",
        expiresAt: new Date("2026-10-01T00:00:00Z"),
      }),
      reimbursementStatusEmail({
        orgName: XSS,
        description: XSS,
        status: "REJECTED",
        rejectionReason: XSS,
        url: "https://p.org/app/x",
      }),
      treasurerDigestEmail({
        orgName: XSS,
        pending: [{ description: XSS, amountFormatted: "$1.00", submitterName: XSS }],
        url: "https://p.org/app/x",
      }),
      verifyEmailEmail({
        name: XSS,
        verifyUrl: "https://p.org/verify-email/tok",
        expiresHours: 24,
      }),
    ];
    for (const email of rendered) {
      // The only image is the logo; the hostile one only ever appears escaped.
      expect(email.html.match(/<img /g)).toHaveLength(1);
      expect(email.html).not.toContain("<img src=x");
      expect(email.html).toContain("&lt;img");
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.text.length).toBeGreaterThan(0);
    }
  });

  it("use absolute links and include a plain-text copy of the link", () => {
    const email = invitationEmail({
      orgName: "Claude Builders Club",
      inviterName: "Jackson",
      role: "ADMIN",
      acceptUrl: "https://portal.example.org/invite/abc",
      expiresAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(email.subject).toBe("Jackson invited you to Claude Builders Club on Bananasplit");
    expect(email.html).toContain('href="https://portal.example.org/invite/abc"');
    expect(email.text).toContain("https://portal.example.org/invite/abc");
    expect(email.html).toContain("as admin");
    expect(() =>
      notificationEmail({ orgName: "x", title: "t", url: "javascript:alert(1)" }),
    ).toThrow();
  });

  it("only shows the rejection reason for a rejection", () => {
    const approved = reimbursementStatusEmail({
      orgName: "o",
      description: "Pizza",
      status: "APPROVED",
      rejectionReason: "leftover",
      url: "https://p.org/x",
    });
    expect(approved.subject).toBe('Your expense "Pizza" was approved');
    expect(approved.text).not.toContain("leftover");
  });
});

describe("trialEndingEmail", () => {
  const base = {
    name: "Maya",
    freePlan: "Free",
    trialPlan: "Team Advanced",
    daysLeft: 3,
    endsOn: "Saturday, November 8",
    url: "https://app.example.com/app/robotics/settings/plan",
  };

  it("tells an organization's owner the trial is almost up, and that no card was taken", () => {
    const email = trialEndingEmail({ ...base, orgName: "Robotics Club" });
    expect(email.subject).toBe("Your free trial is almost up");
    expect(email.text).toContain("Robotics Club's free trial of Team Advanced ends in 3 days");
    expect(email.text).toContain("you won't be charged");
    expect(email.html).toContain("See plans");
  });

  it("speaks to the person for a Personal space", () => {
    const email = trialEndingEmail({
      ...base,
      orgName: null,
      trialPlan: "Personal Plus",
      freePlan: "Personal Free",
      daysLeft: 1,
    });
    expect(email.text).toContain("Your free trial of Personal Plus ends in 1 day");
    expect(email.text).toContain("you move to Personal Free");
  });
});

describe("layout (Moonstone light)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("puts the logo above a white card on a grey page, with an ink pill", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://portal.example.org");
    const email = passwordResetEmail({
      name: "Maya",
      resetUrl: "https://portal.example.org/reset-password/tok",
      expiresMinutes: 60,
    });
    expect(email.html).toContain(
      '<img src="https://portal.example.org/brand/bananasplit-logo.png" width="140" height="28" alt="Bananasplit"',
    );
    expect(email.html).toContain(`background:${EMAIL_COLORS.page}`);
    expect(email.html).toContain(`background:${EMAIL_COLORS.card}`);
    expect(email.html).toContain(`background:${EMAIL_COLORS.ink};color:${EMAIL_COLORS.onInk}`);
    expect(email.html).toContain('<meta name="color-scheme" content="light only">');
    // Sentence case and no uppercase labels anywhere.
    expect(email.html).not.toMatch(/text-transform|letter-spacing/);
  });

  it("keeps the plain-text copy in step with the HTML", () => {
    const email = notificationEmail({
      orgName: "Riverside Robotics",
      title: "Venue booked",
      body: "Maya booked Engineering Hall 112.",
      url: "https://p.org/app/riverside",
    });
    expect(email.text).toBe(
      [
        "Riverside Robotics",
        "Venue booked\n\nMaya booked Engineering Hall 112.",
        "Open in Bananasplit: https://p.org/app/riverside",
        "Change which notifications email you on your profile.",
      ].join("\n\n"),
    );
    for (const line of ["Riverside Robotics", "Venue booked", "Open in Bananasplit"]) {
      expect(email.html).toContain(line);
    }
  });

  it("leaves the logo out when there is no app URL, and still renders", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    const email = testEmail({ orgName: "Riverside Robotics", senderLabel: "Resend" });
    expect(email.html).not.toContain("<img");
    expect(email.text).toContain("If you received it, the sender works.");
  });
});

describe("email configuration", () => {
  it("chooses live, sink or off", () => {
    expect(emailDelivery({})).toBe("sink");
    expect(emailDelivery({ RESEND_API_KEY: "re_x" })).toBe("live");
    expect(emailDelivery({ RESEND_API_KEY: "re_x", EMAIL_DELIVERY: "sink" })).toBe("sink");
    expect(emailDelivery({ EMAIL_SINK: "log", RESEND_API_KEY: "re_x" })).toBe("sink");
    expect(emailDelivery({ EMAIL_DELIVERY: "off" })).toBe("off");
    // Previews never deliver, whatever they are configured with.
    expect(
      emailDelivery({ VERCEL_ENV: "preview", RESEND_API_KEY: "re_x", EMAIL_DELIVERY: "live" }),
    ).toBe("sink");
    // Production without a key must fail loudly, not fall back to the sink.
    expect(emailDelivery({ VERCEL_ENV: "production" })).toBe("live");
  });

  it("checks the production sender against the app domain", () => {
    expect(
      fromMatchesAppDomain("CBC <no-reply@mail.claudeneu.com>", "https://portal.claudeneu.com"),
    ).toBe(true);
    expect(
      fromMatchesAppDomain("CBC <no-reply@claudeneu.com>", "https://portal.claudeneu.com"),
    ).toBe(true);
    expect(fromMatchesAppDomain("CBC <no-reply@gmail.com>", "https://portal.claudeneu.com")).toBe(
      false,
    );
    expect(
      fromMatchesAppDomain("no-reply@portal.claudeneu.com", "https://portal.claudeneu.com"),
    ).toBe(true);
    expect(fromMatchesAppDomain("CBC <no-reply@example.com>", "https://example.com")).toBe(false);
    expect(
      emailConfigProblems({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://portal.claudeneu.com",
      }),
    ).toEqual(["RESEND_API_KEY is not set", "EMAIL_FROM is not set"]);
    expect(
      emailConfigProblems({
        VERCEL_ENV: "production",
        RESEND_API_KEY: "re_x",
        EMAIL_FROM: "CBC <no-reply@claudeneu.com>",
        NEXT_PUBLIC_APP_URL: "https://portal.claudeneu.com",
      }),
    ).toEqual([]);
    expect(emailConfigProblems({ VERCEL_ENV: "production", EMAIL_DELIVERY: "off" })).toEqual([]);
  });
});
