import { describe, expect, it } from "vitest";

import { assertCronAuth, hasCronAuth } from "./auth";

const req = (authorization?: string) =>
  new Request("http://x/api/cron/jobs", {
    headers: authorization ? { authorization } : {},
  });

describe("assertCronAuth", () => {
  it("fails closed with 503 when CRON_SECRET is not configured", () => {
    const res = assertCronAuth(req("Bearer anything"), {});
    expect(res?.status).toBe(503);
  });

  it("answers 401 for a missing or wrong secret", () => {
    const env = { CRON_SECRET: "s3cret-value" };
    expect(assertCronAuth(req(), env)?.status).toBe(401);
    expect(assertCronAuth(req("Bearer wrong"), env)?.status).toBe(401);
    expect(assertCronAuth(req("s3cret-value"), env)?.status).toBe(401);
    expect(assertCronAuth(req("Bearer s3cret-valu"), env)?.status).toBe(401);
  });

  it("passes the right bearer secret", () => {
    const env = { CRON_SECRET: "s3cret-value" };
    expect(assertCronAuth(req("Bearer s3cret-value"), env)).toBeNull();
    expect(hasCronAuth(req("Bearer s3cret-value"), env)).toBe(true);
    expect(hasCronAuth(req(), env)).toBe(false);
  });
});
