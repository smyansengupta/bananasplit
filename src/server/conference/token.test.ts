// @vitest-environment node
import { format } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/secrets", () => ({ getSecret: vi.fn(), rotateSecret: vi.fn() }));
vi.mock("./oauth", () => ({ refreshTokens: vi.fn() }));

import { IntegrationProvider } from "@/generated/prisma/enums";
import { getSecret, rotateSecret } from "@/server/secrets";

import { refreshTokens, type ProviderTokens } from "./oauth";
import { providerOf } from "./providers";
import {
  ROTATION_SETTLE_MS,
  clearAccessToken,
  clearAllAccessTokens,
  getAccessToken,
} from "./token";
import { ConferenceApiError, ConferenceReauthError } from "./types";

/**
 * The access-token cache and the refresh around it (spec B8), and keeping
 * the refresh token a provider rotates: Zoom issues a new one on every
 * refresh and Microsoft recommends replacing it, so dropping it would leave
 * the org on NEEDS_REAUTH an hour after connecting.
 */

const ORG = "org_A";
const ZOOM = IntegrationProvider.ZOOM;
const zoom = providerOf(ZOOM)!;
const T0 = new Date("2026-10-26T12:00:00.000Z").getTime();

function tokens(over: Partial<ProviderTokens> = {}): ProviderTokens {
  return {
    accessToken: "at-1",
    refreshToken: null,
    scopes: [],
    accountEmail: null,
    expiresInSeconds: 3600,
    ...over,
  };
}

function invalidGrant(): ConferenceApiError {
  return new ConferenceApiError(
    400,
    "invalid_grant",
    "Zoom token refresh failed (400 invalid_grant)",
  );
}

/** getSecret answers these in order, then keeps answering the last one. */
function stored(...values: string[]): void {
  const mock = vi.mocked(getSecret);
  for (const value of values) mock.mockResolvedValueOnce(value);
  mock.mockResolvedValue(values.at(-1)!);
}

beforeEach(() => {
  vi.mocked(getSecret).mockReset();
  vi.mocked(refreshTokens).mockReset();
  vi.mocked(rotateSecret).mockReset();
  vi.mocked(rotateSecret).mockResolvedValue(true);
  clearAllAccessTokens();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the access-token cache", () => {
  it("caches the access token until a minute before it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    stored("r1");
    vi.mocked(refreshTokens)
      .mockResolvedValueOnce(tokens({ accessToken: "at-1" }))
      .mockResolvedValueOnce(tokens({ accessToken: "at-2" }));

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(refreshTokens).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + (3600 - 61) * 1000);
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(refreshTokens).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + (3600 - 59) * 1000);
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-2");
    expect(refreshTokens).toHaveBeenCalledTimes(2);
  });

  it("a different stored refresh token bypasses the cache", async () => {
    stored("r1", "r9");
    vi.mocked(refreshTokens)
      .mockResolvedValueOnce(tokens({ accessToken: "at-1" }))
      .mockResolvedValueOnce(tokens({ accessToken: "at-9" }));

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-9");
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(refreshTokens).toHaveBeenNthCalledWith(2, zoom, "r9");
  });

  it("clearAccessToken forgets the cached token", async () => {
    stored("r1");
    vi.mocked(refreshTokens)
      .mockResolvedValueOnce(tokens({ accessToken: "at-1" }))
      .mockResolvedValueOnce(tokens({ accessToken: "at-2" }));

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    clearAccessToken(ORG, ZOOM);
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-2");
    expect(refreshTokens).toHaveBeenCalledTimes(2);
  });
});

describe("a rotated refresh token", () => {
  it("persists a rotated refresh token", async () => {
    stored("r1", "r2");
    vi.mocked(refreshTokens).mockResolvedValueOnce(tokens({ refreshToken: "r2" }));

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(rotateSecret).toHaveBeenCalledTimes(1);
    expect(rotateSecret).toHaveBeenCalledWith({
      orgId: ORG,
      provider: "ZOOM",
      kind: "REFRESH_TOKEN",
      previous: "r1",
      value: "r2",
    });

    // Cached under the new token, which is what the store now answers.
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("does not persist when the provider echoes the same token or none", async () => {
    stored("r1");
    vi.mocked(refreshTokens)
      .mockResolvedValueOnce(tokens({ refreshToken: "r1" }))
      .mockResolvedValueOnce(tokens({ refreshToken: null }));

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    clearAccessToken(ORG, ZOOM);
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-1");
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(rotateSecret).not.toHaveBeenCalled();
  });

  it("invalid_grant with an unchanged stored token throws ConferenceReauthError", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    stored("r1");
    vi.mocked(refreshTokens).mockRejectedValue(invalidGrant());

    const refused = expect(getAccessToken(ORG, ZOOM)).rejects.toBeInstanceOf(ConferenceReauthError);
    await vi.advanceTimersByTimeAsync(ROTATION_SETTLE_MS);
    await refused;
    // It looked again, then once more after the settle wait, found the same
    // token both times, and did not retry.
    expect(getSecret).toHaveBeenCalledTimes(3);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("invalid_grant before the other server's rotation commits still retries with the newer token", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    // The first look is too early; the one after the settle wait sees r2.
    stored("r1", "r1", "r2");
    vi.mocked(refreshTokens)
      .mockRejectedValueOnce(invalidGrant())
      .mockResolvedValueOnce(tokens({ accessToken: "at-2" }));

    const result = getAccessToken(ORG, ZOOM);
    await vi.advanceTimersByTimeAsync(ROTATION_SETTLE_MS - 1);
    expect(getSecret).toHaveBeenCalledTimes(2);
    expect(refreshTokens).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("at-2");
    expect(getSecret).toHaveBeenCalledTimes(3);
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(refreshTokens).toHaveBeenNthCalledWith(2, zoom, "r2");
  });

  it("invalid_grant after someone else rotated retries once with the newer token", async () => {
    stored("r1", "r2");
    vi.mocked(refreshTokens)
      .mockRejectedValueOnce(invalidGrant())
      .mockResolvedValueOnce(tokens({ accessToken: "at-2", refreshToken: "r3" }));

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-2");
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(refreshTokens).toHaveBeenNthCalledWith(1, zoom, "r1");
    expect(refreshTokens).toHaveBeenNthCalledWith(2, zoom, "r2");
    // The retry's own rotation is checked against the token it used.
    expect(rotateSecret).toHaveBeenCalledTimes(1);
    expect(rotateSecret).toHaveBeenCalledWith(
      expect.objectContaining({ previous: "r2", value: "r3" }),
    );
  });

  it("retries at most once: a refused retry is ConferenceReauthError", async () => {
    stored("r1", "r2", "r3");
    vi.mocked(refreshTokens).mockRejectedValue(invalidGrant());

    await expect(getAccessToken(ORG, ZOOM)).rejects.toBeInstanceOf(ConferenceReauthError);
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    // The first look already found a newer token, so there was no wait.
    expect(getSecret).toHaveBeenCalledTimes(2);
    expect(rotateSecret).not.toHaveBeenCalled();
  });

  it("two calls racing one refresh share it, so the second never refreshes a token the first used up", async () => {
    stored("r1", "r1", "r2");
    let release: (value: ProviderTokens) => void = () => {};
    vi.mocked(refreshTokens).mockImplementationOnce(
      () => new Promise<ProviderTokens>((resolve) => (release = resolve)),
    );

    const first = getAccessToken(ORG, ZOOM);
    const second = getAccessToken(ORG, ZOOM);
    // Let both calls get as far as they can while the provider is answering.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshTokens).toHaveBeenCalledTimes(1);

    release(tokens({ accessToken: "at-2", refreshToken: "r2" }));
    expect(await Promise.all([first, second])).toEqual(["at-2", "at-2"]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(rotateSecret).toHaveBeenCalledTimes(1);
    expect(rotateSecret).toHaveBeenCalledWith(
      expect.objectContaining({ previous: "r1", value: "r2" }),
    );
  });

  it("callers racing a rotation share the retry on the newer token: one refresh of it, no reauth", async () => {
    // The store and the provider as they really behave: a refresh token is
    // good for one refresh (Zoom rotates it and retires the old one), and
    // rotateSecret is a compare-and-set.
    let store = "r1";
    vi.mocked(getSecret).mockImplementation(async () => store);
    vi.mocked(rotateSecret).mockImplementation(async ({ previous, value }) => {
      if (store !== previous) return false;
      store = value;
      return true;
    });
    const spent = new Set<string>();
    let release: (value: ProviderTokens) => void = () => {};
    vi.mocked(refreshTokens).mockImplementation(async (_def, token) => {
      if (token === "r1") {
        // Another server refreshed r1 first and has stored the r2 it got.
        store = "r2";
        throw invalidGrant();
      }
      if (spent.has(token)) throw invalidGrant();
      spent.add(token);
      return new Promise<ProviderTokens>((resolve) => (release = resolve));
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Two callers here read r1 and hit invalid_grant on it...
    const a = getAccessToken(ORG, ZOOM);
    const b = getAccessToken(ORG, ZOOM);
    // ...and a third reads r2, the token the retry is already using.
    await tick();
    const c = getAccessToken(ORG, ZOOM);
    const settled = Promise.allSettled([a, b, c]);
    await tick();

    const withR2 = vi.mocked(refreshTokens).mock.calls.filter(([, token]) => token === "r2");
    expect(withR2).toHaveLength(1);

    release(tokens({ accessToken: "at-2", refreshToken: "r3" }));
    expect(await settled).toEqual([
      { status: "fulfilled", value: "at-2" },
      { status: "fulfilled", value: "at-2" },
      { status: "fulfilled", value: "at-2" },
    ]);
    expect(store).toBe("r3");
  });

  it("a caller that hit invalid_grant on r1 after another's retry finished reuses the token r2 already got", async () => {
    // Both read r1; the second's read was just slow enough to come back after
    // the first had retried on r2. r2 was not rotated (Microsoft does not
    // always), so the store still holds it and the access token is cached.
    stored("r1", "r2", "r1", "r2");
    vi.mocked(refreshTokens).mockImplementation(async (_def, token) => {
      if (token === "r1") throw invalidGrant();
      return tokens({ accessToken: "at-2", refreshToken: null });
    });

    expect(await getAccessToken(ORG, ZOOM)).toBe("at-2");
    expect(await getAccessToken(ORG, ZOOM)).toBe("at-2");

    const withR2 = vi.mocked(refreshTokens).mock.calls.filter(([, token]) => token === "r2");
    expect(withR2).toHaveLength(1);
  });

  it("one caller aborting does not fail the others sharing the refresh", async () => {
    stored("r1");
    let release: (value: ProviderTokens) => void = () => {};
    vi.mocked(refreshTokens).mockImplementationOnce(
      () => new Promise<ProviderTokens>((resolve) => (release = resolve)),
    );

    // The caller that starts the shared refresh is the one that gives up.
    const quitter = new AbortController();
    const first = getAccessToken(ORG, ZOOM, { signal: quitter.signal });
    const second = getAccessToken(ORG, ZOOM, { signal: new AbortController().signal });
    const third = getAccessToken(ORG, ZOOM);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    // No caller's signal rides on the shared refresh.
    expect(vi.mocked(refreshTokens).mock.calls[0]![2]).toBeUndefined();

    const deadline = new Error("job deadline");
    quitter.abort(deadline);
    await expect(first).rejects.toBe(deadline);

    release(tokens({ accessToken: "at-2" }));
    expect(await Promise.all([second, third])).toEqual(["at-2", "at-2"]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("a failed rotateSecret does not fail the call", async () => {
    const OLD = "zoom-rt-OLD-0001";
    const NEW = "zoom-rt-NEW-0002";
    const ACCESS = "zoom-at-0003";
    stored(OLD);
    vi.mocked(refreshTokens).mockResolvedValueOnce(
      tokens({ accessToken: ACCESS, refreshToken: NEW }),
    );
    vi.mocked(rotateSecret).mockRejectedValueOnce(
      new Error(`secret_write failed: refresh_token=${NEW}`),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await getAccessToken(ORG, ZOOM)).toBe(ACCESS);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toMatch(/ZOOM/);
    expect(logged).not.toContain(NEW);
    expect(logged).not.toContain(OLD);
    expect(logged).not.toContain(ACCESS);

    // The store still holds OLD, so the access token stays cached under it
    // instead of forcing a refresh with a token the provider may have retired.
    expect(await getAccessToken(ORG, ZOOM)).toBe(ACCESS);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });
});
