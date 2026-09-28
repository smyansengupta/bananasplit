import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /sign-in offers "Continue with Google" only when the Google client is
 * configured (src/lib/auth/google-sign-in.ts); otherwise the button would
 * only reach Auth.js's "server configuration" error.
 */

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/lib/auth/config", () => ({ auth: authMock, signIn: vi.fn() }));
vi.mock("./actions", () => ({ passwordSignInAction: vi.fn() }));

const { default: SignInPage } = await import("./page");

const props = { searchParams: Promise.resolve({}) } as unknown as PageProps<"/sign-in">;

async function render() {
  return renderToStaticMarkup(await SignInPage(props));
}

beforeEach(() => {
  authMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/sign-in", () => {
  it("offers Google and email/password when the Google client is configured", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
    const html = await render();
    expect(html).toContain("Continue with Google");
    expect(html).toContain(">or<");
    expect(html).toContain("Use your Google account or your email and password.");
    expect(html).toContain('name="password"');
  });

  it.each([
    ["neither is set", "", ""],
    ["the secret is missing", "client-id", ""],
    ["the ID is blank", "   ", "client-secret"],
  ])("offers email/password only when %s", async (_label, id, secret) => {
    vi.stubEnv("AUTH_GOOGLE_ID", id);
    vi.stubEnv("AUTH_GOOGLE_SECRET", secret);
    const html = await render();
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toContain(">or<");
    expect(html).not.toContain("Google account");
    expect(html).toContain("Use your email and password.");
    expect(html).toContain('name="password"');
  });
});
