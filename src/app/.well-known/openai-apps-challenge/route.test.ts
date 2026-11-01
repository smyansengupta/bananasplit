// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("/.well-known/openai-apps-challenge", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers 404 while OPENAI_APPS_CHALLENGE is unset or blank", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", "");
    expect(GET().status).toBe(404);
    vi.stubEnv("OPENAI_APPS_CHALLENGE", "   ");
    const blank = GET();
    expect(blank.status).toBe(404);
    expect(await blank.text()).toBe("");
  });

  it("serves exactly the token as plain text, never cached", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", " oa_challenge_3f9c1e \n");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("oa_challenge_3f9c1e");
  });
});
