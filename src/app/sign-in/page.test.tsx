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
// The "Signed in as … Sign out" line reads the session; not under test here.
vi.mock("@/components/auth/signed-in-as", () => ({ SignedInAs: () => null }));

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
  it("tells someone already signed in which account, with a way to sign out", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "wrong@example.com", name: "Wren Ong" },
    });
    const html = await render();
    expect(html).toContain("You&#x27;re already signed in.");
    expect(html).toContain("wrong@example.com");
    expect(html).toContain("Continue as Wren");
    expect(html).toContain("Sign out and use another account");
    expect(html).not.toContain('name="password"');
  });

  it("offers Google and email/password when the Google client is configured", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
    const html = await render();
    expect(html).toContain("Continue with Google");
    expect(html).toContain(">or<");
    expect(html).toContain("Welcome back.");
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
    expect(html).toContain("Welcome back.");
    expect(html).toContain('name="password"');
  });
});
