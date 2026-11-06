import { describe, expect, it } from "vitest";

import { checkCallUrl, isPrivateAddress } from "./call-url";

describe("where a workflow may call", () => {
  it("knows private, loopback, link-local and mapped addresses", () => {
    for (const a of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "34.120.1.1", "2606:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });

  it("takes https names only, and Slack and Discord at their own hosts", () => {
    expect(checkCallUrl("webhook.call", "https://hooks.example.com/x").hostname).toBe("hooks.example.com");
    expect(() => checkCallUrl("webhook.call", "http://hooks.example.com/x")).toThrow(/https/);
    expect(() => checkCallUrl("webhook.call", "https://10.0.0.1/x")).toThrow(/IP/);
    expect(() => checkCallUrl("webhook.call", "https://[::1]/x")).toThrow(/IP/);
    expect(() => checkCallUrl("webhook.call", "https://intranet/x")).toThrow(/private/);
    expect(() => checkCallUrl("webhook.call", "https://db.internal/x")).toThrow(/private/);
    expect(() => checkCallUrl("webhook.call", "https://a:b@hooks.example.com/x")).toThrow(/password/);
    expect(() => checkCallUrl("webhook.call", "https://hooks.example.com:8443/x")).toThrow(/port/);
    expect(checkCallUrl("slack.post", "https://hooks.slack.com/services/T/B/x").hostname).toBe("hooks.slack.com");
    expect(() => checkCallUrl("slack.post", "https://evil.example.com/services/x")).toThrow(/Slack/);
    expect(checkCallUrl("discord.post", "https://discord.com/api/webhooks/1/abc").hostname).toBe("discord.com");
    expect(() => checkCallUrl("discord.post", "https://discord.com/channels/1")).toThrow(/Discord/);
  });
});
