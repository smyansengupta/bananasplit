import { describe, expect, it } from "vitest";

import { crmApprovalsHref, crmNewHref, crmPipelineHref } from "./href";
import { parseOpen } from "./overlay";
import { newItemRedirect, pipelineRedirect, queueRedirect } from "./redirects";

const params = (href: string) => new URL(href, "https://x.test").searchParams;

describe("the CRM's retired pages", () => {
  it("sends Review (/crm/queue) to Today's To approve", () => {
    expect(queueRedirect("acme")).toBe(crmApprovalsHref("acme"));
    expect(params(queueRedirect("acme")).get("show")).toBe("approve");
  });

  it("sends New item (/crm/items/new) to the New deal card", () => {
    const href = newItemRedirect("acme");
    expect(href).toBe(crmNewHref("acme", "deal"));
    expect(parseOpen(params(href).get("open"))).toEqual({ kind: "new", what: "deal" });
  });

  it("keeps a pipeline's params, and opens New deal for ?new=1", () => {
    const plain = pipelineRedirect("acme", "p1", {});
    expect(plain).toBe(crmPipelineHref("acme", "p1"));
    const withNew = params(pipelineRedirect("acme", "p1", { new: "1", owner: "me" }));
    expect(withNew.get("pipeline")).toBe("p1");
    expect(withNew.get("owner")).toBe("me");
    expect(withNew.get("open")).toBe("new:deal");
    expect(withNew.has("new")).toBe(false);
    // A card it was asked to open stays open.
    const opened = params(pipelineRedirect("acme", "p1", { open: "deal:d1", new: "1" }));
    expect(opened.get("open")).toBe("deal:d1");
    // Its own pipeline wins over a stray one.
    expect(params(pipelineRedirect("acme", "p1", { pipeline: "p2" })).get("pipeline")).toBe("p1");
  });
});
