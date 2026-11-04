// @vitest-environment node
import { describe, expect, it } from "vitest";

import { crmApprovalsHref, crmDealsHref, crmNewHref, crmPipelineHref, crmPlanHref } from "./href";
import { parseOpen } from "./overlay";
import { peopleDealFilters, rowDeal, rowNext } from "./people-view";
import {
  dealsRedirectHref,
  newItemRedirect,
  outreachRedirectHref,
  pipelineRedirect,
  queueRedirect,
} from "./redirects";

const params = (href: string) => new URL(`https://x${href}`).searchParams;
const path = (href: string) => new URL(`https://x${href}`).pathname;

describe("old Deals links", () => {
  it("land on People as a board", () => {
    expect(dealsRedirectHref("o", {})).toBe("/app/o/crm/people?view=board");
  });

  it("carry the pipeline, stage, owner, type, show and search over", () => {
    const href = dealsRedirectHref("o", {
      view: "list",
      pipeline: "p1",
      stage: "s2",
      owner: "me",
      type: "renewal",
      show: "won",
      q: "grove",
    });
    expect(path(href)).toBe("/app/o/crm/people");
    const p = params(href);
    expect(p.get("view")).toBe("board");
    expect(p.get("pipeline")).toBe("p1");
    expect(p.get("stage")).toBe("s2");
    expect(p.get("owner")).toBe("me");
    expect(p.get("type")).toBe("renewal");
    expect(p.get("show")).toBe("won");
    expect(p.get("q")).toBe("grove");
  });

  it("keep a deal's card open, and drop an open value that names nothing", () => {
    const href = dealsRedirectHref("o", { open: "deal:d1", tab: "quote" });
    expect(parseOpen(params(href).get("open"))).toEqual({ kind: "deal", id: "d1" });
    expect(params(href).get("tab")).toBe("quote");
    expect(params(dealsRedirectHref("o", { open: "nope:<x>" })).has("open")).toBe(false);
  });

  it("are what the record and pipeline links point at now", () => {
    expect(crmPipelineHref("o", "p1")).toBe("/app/o/crm/people?view=board&pipeline=p1");
    expect(crmDealsHref("o")).toBe("/app/o/crm/people?view=board");
  });
});

describe("old Outreach links", () => {
  const automations = "/app/o/crm/settings/automations";

  it("open a plan with an id over Settings > Automations", () => {
    for (const open of ["plan:sequence:s1", "plan:campaign:c1"]) {
      const href = outreachRedirectHref("o", "outreach", { open });
      expect(path(href)).toBe(automations);
      expect(params(href).get("open")).toBe(open);
    }
    expect(crmPlanHref("o", "sequence", "s1")).toBe(`${automations}?open=plan%3Asequence%3As1`);
  });

  it("open a new split list over Automations, and one email to many over People with its list", () => {
    expect(params(outreachRedirectHref("o", "outreach", { open: "plan:split" })).get("open")).toBe("plan:split");
    expect(path(outreachRedirectHref("o", "outreach", { open: "plan:split" }))).toBe(automations);
    const email = outreachRedirectHref("o", "outreach", { open: "plan:email", list: "v1" });
    expect(path(email)).toBe("/app/o/crm/people");
    expect(params(email).get("open")).toBe("plan:email");
    expect(params(email).get("to")).toBe("v1");
    const bulk = outreachRedirectHref("o", "bulk", { list: "v2" });
    expect(path(bulk)).toBe("/app/o/crm/people");
    expect(params(bulk).get("to")).toBe("v2");
    expect(params(outreachRedirectHref("o", "bulk", {})).has("to")).toBe(false);
  });

  it("send Templates and Your mail to their Settings sections", () => {
    expect(outreachRedirectHref("o", "outreach", { view: "templates" })).toBe("/app/o/crm/settings/templates");
    expect(outreachRedirectHref("o", "outreach", { view: "mail" })).toBe("/app/o/crm/settings/you");
    expect(outreachRedirectHref("o", "mail")).toBe("/app/o/crm/settings/you");
  });

  it("send the lists of sequences and campaigns to Automations, and the rest to People", () => {
    expect(outreachRedirectHref("o", "sequences")).toBe(automations);
    expect(outreachRedirectHref("o", "campaigns")).toBe(automations);
    expect(outreachRedirectHref("o", "outreach", {})).toBe("/app/o/crm/people");
    expect(outreachRedirectHref("o", "outreach", { status: "running", q: "spring" })).toBe("/app/o/crm/people");
    expect(params(outreachRedirectHref("o", "outreach", { open: "person:p1" })).get("open")).toBe("person:p1");
  });
});

describe("People's deal filters", () => {
  it("are off until one is picked, and mean open deals unless told otherwise", () => {
    expect(peopleDealFilters({}).on).toBe(false);
    expect(peopleDealFilters({}).filters.show).toBe("open");
    expect(peopleDealFilters({ pipeline: "p1" })).toMatchObject({ on: true, filters: { pipeline: "p1", show: "open" } });
    expect(peopleDealFilters({ show: "lost" })).toMatchObject({ on: true, filters: { show: "lost" } });
  });

  it("show a picked stage whatever its kind", () => {
    expect(peopleDealFilters({ stage: "s_won" }).filters).toMatchObject({ stage: "s_won", show: "all" });
    expect(peopleDealFilters({ stage: "s1", show: "open" }).filters.show).toBe("open");
  });
});

describe("the deal a row shows", () => {
  it("is the most advanced, then the biggest, with how many more", () => {
    expect(rowDeal([])).toBeNull();
    const r = rowDeal([
      { id: "a", stageOrder: 1, amountCents: 900 },
      { id: "b", stageOrder: 3, amountCents: 100 },
      { id: "c", stageOrder: 3, amountCents: 500 },
    ]);
    expect(r?.deal.id).toBe("c");
    expect(r?.more).toBe(2);
  });

  it("asks for the quote, then the deal's next step, before going cold", () => {
    const now = new Date("2026-11-03T15:00:00Z");
    const deal = { id: "d1", title: "Spring gala", quote: null, nextStep: null, nextStepAt: null };
    const base = { nextFollowUpAt: null, lastContactedAt: new Date("2026-08-01T00:00:00Z") };
    expect(rowNext({ ...base, deal: { ...deal, quote: "DRAFT" } }, now).action).toMatchObject({
      kind: "quote",
      label: "Send the quote",
      reason: "Quote drafted, not sent",
      dealId: "d1",
    });
    expect(rowNext({ ...base, deal }, now).action).toMatchObject({
      kind: "deal-step",
      label: "Add a next step",
      reason: "Spring gala has no next step",
    });
    const late = rowNext(
      { ...base, deal: { ...deal, nextStep: "Send the deck", nextStepAt: new Date("2026-10-31T00:00:00Z") } },
      now,
    );
    expect(late.action).toMatchObject({ kind: "deal-step", label: "Follow up", reason: "Spring gala: 3 days late" });
    const soon = rowNext(
      {
        nextFollowUpAt: null,
        lastContactedAt: new Date("2026-11-01T00:00:00Z"),
        deal: { ...deal, nextStep: "Send the deck", nextStepAt: new Date("2026-11-07T00:00:00Z") },
      },
      now,
    );
    expect(soon).toEqual({ action: null, text: "Send the deck, Nov 7" });
    // Someone who wrote comes first.
    expect(rowNext({ ...base, wroteAt: now, deal: { ...deal, quote: "DRAFT" } }, now).action?.kind).toBe("reply");
  });
});


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
