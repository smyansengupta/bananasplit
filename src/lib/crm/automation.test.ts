import { describe, expect, it } from "vitest";

import { mapDescribed, standinDescribe, type DescribeContext } from "./describe";
import {
  attainment,
  computeForecast,
  computeTrend,
  parsePeriodKey,
  periodOf,
  shiftPeriod,
  snapshotChanges,
  type ForecastItem,
  type SnapshotData,
} from "./forecast";
import { parseRef, RECIPES, refsIn, resolveRefs } from "./recipes";
import {
  behaviourKey,
  clampScore,
  featureDefs,
  featuresOf,
  predict,
  scoreRecord,
  topReasons,
  trainLogistic,
  type ScoreRule,
} from "./scoring";
import {
  actionToMergeSyntax,
  conditionHolds,
  conditionsHold,
  describeWorkflow,
  fewestPick,
  historyKey,
  loopAllows,
  MAX_CHAIN_DEPTH,
  readWorkflow,
  renderMessage,
  resolveValue,
  roundRobinPick,
  RUN_CAP_PER_TARGET_PER_HOUR,
  toMergeSyntax,
  triggerMatches,
  underRunCap,
  unknownMergeFields,
  WORKFLOW_MERGE_FIELDS,
  workflowInputSchema,
  type Trigger,
} from "./workflows";

describe("workflow conditions", () => {
  const record = { title: "Director of Events", amount: 1500, status: "ACTIVE", doNotContact: false, tags: ["a", "b"], "custom.f1": "Gold", empty: "" };

  it("compares text without case, numbers as numbers, and arrays by membership", () => {
    expect(conditionHolds({ field: "status", op: "is", value: "active" }, record)).toBe(true);
    expect(conditionHolds({ field: "status", op: "is_not", value: "ACTIVE" }, record)).toBe(false);
    expect(conditionHolds({ field: "title", op: "contains", value: "director" }, record)).toBe(true);
    expect(conditionHolds({ field: "title", op: "not_contains", value: "chair" }, record)).toBe(true);
    expect(conditionHolds({ field: "amount", op: "gt", value: 1000 }, record)).toBe(true);
    expect(conditionHolds({ field: "amount", op: "lte", value: "1,499" }, record)).toBe(false);
    expect(conditionHolds({ field: "amount", op: "is", value: 1500 }, record)).toBe(true);
    expect(conditionHolds({ field: "tags", op: "is", value: "B" }, record)).toBe(true);
    expect(conditionHolds({ field: "custom.f1", op: "any_of", value: "silver, gold" }, record)).toBe(true);
  });

  it("reads empty and missing alike, and booleans as booleans", () => {
    expect(conditionHolds({ field: "empty", op: "empty" }, record)).toBe(true);
    expect(conditionHolds({ field: "nowhere", op: "empty" }, record)).toBe(true);
    expect(conditionHolds({ field: "title", op: "not_empty" }, record)).toBe(true);
    expect(conditionHolds({ field: "doNotContact", op: "is", value: false }, record)).toBe(true);
    expect(conditionHolds({ field: "doNotContact", op: "is", value: true }, record)).toBe(false);
    expect(conditionHolds({ field: "nowhere", op: "gt", value: 1 }, record)).toBe(false);
  });

  it("needs every condition, and none means always", () => {
    expect(conditionsHold([], record)).toBe(true);
    expect(
      conditionsHold(
        [
          { field: "status", op: "is", value: "ACTIVE" },
          { field: "amount", op: "lt", value: 10 },
        ],
        record,
      ),
    ).toBe(false);
  });
});

describe("workflow triggers", () => {
  const created: Trigger = { type: "record.created", params: { object: "person" } };
  const moved: Trigger = { type: "stage.changed", params: { pipelineId: "p1", toStageId: "s2" } };

  it("matches an added record of the right kind only", () => {
    expect(triggerMatches(created, { type: "record.changed", targetKind: "person", fields: ["created"] })).toBe(true);
    expect(triggerMatches(created, { type: "record.changed", targetKind: "company", fields: ["created"] })).toBe(false);
    expect(triggerMatches(created, { type: "record.changed", targetKind: "person", fields: ["title"] })).toBe(false);
  });

  it("watches a field under the name field history records it by", () => {
    const owner: Trigger = { type: "field.changed", params: { object: "deal", field: "owner" } };
    expect(historyKey("deal", "owner")).toBe("ownerId");
    expect(historyKey("deal", "amount")).toBe("amountCents");
    expect(historyKey("person", "custom.abc")).toBe("custom.abc");
    expect(triggerMatches(owner, { type: "record.changed", targetKind: "deal", fields: ["ownerId"] })).toBe(true);
    expect(triggerMatches(owner, { type: "record.changed", targetKind: "deal", fields: ["nextStep"] })).toBe(false);
    // A new record isn't "a field changed".
    expect(triggerMatches(owner, { type: "record.changed", targetKind: "deal", fields: ["created", "ownerId"] })).toBe(false);
  });

  it("matches a stage move by pipeline, stage and kind", () => {
    const ev = { type: "record.changed" as const, targetKind: "deal" as const, fields: ["stageId"] };
    expect(triggerMatches(moved, ev, { pipelineId: "p1", stageId: "s2", stageKind: "OPEN" })).toBe(true);
    expect(triggerMatches(moved, ev, { pipelineId: "p1", stageId: "s3", stageKind: "OPEN" })).toBe(false);
    expect(triggerMatches(moved, ev, { pipelineId: "p9", stageId: "s2", stageKind: "OPEN" })).toBe(false);
    const won: Trigger = { type: "stage.changed", params: { toKind: "WON" } };
    expect(triggerMatches(won, ev, { pipelineId: "p1", stageId: "s5", stageKind: "WON" })).toBe(true);
    expect(triggerMatches(won, ev, { pipelineId: "p1", stageId: "s6", stageKind: "LOST" })).toBe(false);
    expect(triggerMatches(won, { ...ev, fields: ["title"] }, { stageKind: "WON" })).toBe(false);
  });

  it("matches outreach events, a form by its id, and never a scheduled trigger", () => {
    const form: Trigger = { type: "form.submitted", params: { object: "person", formId: "f1" } };
    expect(triggerMatches(form, { type: "form.submitted", targetKind: "person", fields: [] }, { formId: "f1" })).toBe(true);
    expect(triggerMatches(form, { type: "form.submitted", targetKind: "person", fields: [] }, { formId: "f2" })).toBe(false);
    expect(triggerMatches({ type: "email.replied", params: {} }, { type: "email.replied", targetKind: "person", fields: [] })).toBe(true);
    expect(triggerMatches({ type: "deal.stuck", params: {} }, { type: "record.changed", targetKind: "deal", fields: ["stageId"] })).toBe(false);
  });
});

describe("loop protection", () => {
  it("never re-fires a workflow on its own change, and stops a chain", () => {
    expect(loopAllows({ workflowId: "w1", depth: 1 }, "w1")).toBe(false);
    expect(loopAllows({ workflowId: "w1", depth: 1 }, "w2")).toBe(true);
    expect(loopAllows({ workflowId: null, depth: 0 }, "w1")).toBe(true);
    expect(loopAllows({ workflowId: "w2", depth: MAX_CHAIN_DEPTH }, "w1")).toBe(false);
  });

  it("caps runs per record per hour", () => {
    expect(underRunCap(0)).toBe(true);
    expect(underRunCap(RUN_CAP_PER_TARGET_PER_HOUR - 1)).toBe(true);
    expect(underRunCap(RUN_CAP_PER_TARGET_PER_HOUR)).toBe(false);
  });
});

describe("workflow helpers", () => {
  const now = new Date("2026-11-03T15:00:00Z");

  it("turns +3d and today into dates", () => {
    expect(resolveValue("+3d", now)).toBe("2026-11-06");
    expect(resolveValue("-1d", now)).toBe("2026-11-02");
    expect(resolveValue("today", now)).toBe("2026-11-03");
    expect(resolveValue("Gold", now)).toBe("Gold");
    expect(resolveValue(5, now)).toBe(5);
  });

  it("takes turns and picks the least busy", () => {
    expect(roundRobinPick(["a", "b", "c"], 0)).toBe("a");
    expect(roundRobinPick(["a", "b", "c"], 4)).toBe("b");
    expect(roundRobinPick([], 4)).toBeNull();
    expect(fewestPick(["a", "b", "c"], new Map([["a", 3], ["b", 1]]))).toBe("c");
    expect(fewestPick(["a", "b"], new Map([["a", 3], ["b", 1]]))).toBe("b");
  });

  it("fills merge fields the way emails do, {{name}} with an optional fallback", () => {
    expect(renderMessage("Hi {{name}}, about {{title}}", { name: "Ada", title: "Gala" })).toBe("Hi Ada, about Gala");
    expect(renderMessage("{{company}} paid", { company: null })).toBe(" paid");
    expect(renderMessage("For {{owner|the team}}", { owner: null })).toBe("For the team");
    expect(renderMessage("{{days}} days in {{stage}}", { days: 12, stage: "Committed" })).toBe("12 days in Committed");
    // An email-only field isn't a workflow's; a typo renders as nothing (saving refuses it).
    expect(renderMessage("Hi {{first_name|there}}", { name: "Ada" })).toBe("Hi there");
  });

  it("still reads the old {name} style, and leaves other braces alone", () => {
    expect(renderMessage("Hi {name}, about {Title}{x}", { name: "Ada", title: "Gala" })).toBe("Hi Ada, about Gala{x}");
    expect(toMergeSyntax("{name} is in {stage} for {days} days: {link}")).toBe("{{name}} is in {{stage}} for {{days}} days: {{link}}");
    expect(toMergeSyntax("{{name}} and {{owner|the team}}")).toBe("{{name}} and {{owner|the team}}");
    expect(toMergeSyntax(toMergeSyntax("Thank {name}"))).toBe("Thank {{name}}");
    expect(toMergeSyntax("Keep {draft} and {first_name} as written")).toBe("Keep {draft} and {first_name} as written");
    expect(WORKFLOW_MERGE_FIELDS.map((f) => f.key)).toEqual(["name", "title", "company", "stage", "pipeline", "amount", "owner", "days", "link", "workflow"]);
  });

  it("translates a saved workflow's old tokens when it's read, in every text a step has", () => {
    const parsed = readWorkflow({
      trigger: { type: "record.created", params: { object: "person" } },
      conditions: [],
      actions: [
        { type: "task.create", params: { title: "Follow up with {name}", assignTo: "owner" } },
        { type: "notify", params: { to: "owner", message: "{title} sat in {stage} for {days} days" } },
        { type: "slack.post", params: { url: "https://hooks.slack.com/x", message: "{name}: {link}" } },
        { type: "finance.create", params: { direction: "IN", description: "{title}", amountFrom: "item" } },
        { type: "project.start", params: { name: "{title} deliverables", tasks: ["Thank {company}"] } },
      ],
    });
    expect(parsed.actions.map((a) => JSON.stringify(a.params))).toEqual([
      expect.stringContaining('"title":"Follow up with {{name}}"'),
      expect.stringContaining('"message":"{{title}} sat in {{stage}} for {{days}} days"'),
      expect.stringContaining('"message":"{{name}}: {{link}}"'),
      expect.stringContaining('"description":"{{title}}"'),
      expect.stringContaining('"name":"{{title}} deliverables","tasks":["Thank {{company}}"]'),
    ]);
    expect(actionToMergeSyntax({ type: "stage.move", params: { stageId: "s1" } })).toEqual({ type: "stage.move", params: { stageId: "s1" } });
  });

  it("names the fields a workflow's text uses that don't exist", () => {
    expect(
      unknownMergeFields([
        { type: "task.create", params: { title: "Call {{name}} and {{nmae}}", assignTo: "owner" } },
        { type: "notify", params: { to: "owner", message: "{{first_name}} {{nmae}}" } },
      ]),
    ).toEqual(["nmae", "first_name"]);
    expect(unknownMergeFields(RECIPES.flatMap((r) => r.actions))).toEqual([]);
  });

  it("reads stored JSON leniently and describes it", () => {
    const parsed = readWorkflow({
      trigger: { type: "deal.stuck", params: {} },
      conditions: [{ field: "amount", op: "gt", value: 5 }, { bogus: true }],
      actions: [{ type: "notify", params: { to: "owner", message: "Hi" } }, { type: "nope" }],
    });
    expect(parsed.conditions).toHaveLength(1);
    expect(parsed.actions).toHaveLength(1);
    expect(describeWorkflow(parsed)).toBe("When a deal is stuck: notify someone");
    expect(readWorkflow({ trigger: { type: "nope" }, conditions: null, actions: null }).trigger).toBeNull();
  });

  it("refuses an http webhook and an empty Then", () => {
    const base = { name: "x", trigger: { type: "record.created", params: { object: "person" } }, conditions: [] };
    expect(workflowInputSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(workflowInputSchema.safeParse({ ...base, actions: [{ type: "webhook.call", params: { url: "http://x.test" } }] }).success).toBe(false);
    expect(workflowInputSchema.safeParse({ ...base, actions: [{ type: "webhook.call", params: { url: "https://x.example.com/h" } }] }).success).toBe(true);
  });
});

describe("recipes", () => {
  it("parses and resolves references, and is null when one can't be resolved", () => {
    expect(parseRef("@stage:donors:RECEIVED")).toEqual({ kind: "stage", template: "donors", key: "RECEIVED" });
    expect(parseRef("@pipeline:members")).toEqual({ kind: "pipeline", template: "members" });
    expect(parseRef("plain")).toBeNull();
    expect(resolveRefs({ a: ["@pipeline:x"] }, () => null)).toBeNull();
  });

  it("every recipe is a valid workflow once its references are resolved", () => {
    for (const r of RECIPES) {
      const resolved = resolveRefs({ name: r.title, trigger: r.trigger, conditions: r.conditions, actions: r.actions }, (ref) =>
        ref.kind === "pipeline" ? `p_${ref.template}` : ref.kind === "stage" ? `s_${ref.key}` : `t_${ref.category}`,
      );
      expect(resolved, r.id).not.toBeNull();
      const parsed = workflowInputSchema.safeParse(resolved);
      expect(parsed.success, `${r.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues[0])}`).toBe(true);
    }
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    expect(refsIn(RECIPES.find((r) => r.id === "donor-gave")).map((x) => x.kind)).toContain("template");
  });
});

describe("scoring rules", () => {
  const rules: ScoreRule[] = [
    { id: "1", label: "Replied", condition: { activity: "replied", withinDays: 30 }, points: 25 },
    { id: "2", label: "Has a title", condition: { field: "title", op: "not_empty" }, points: 10 },
    { id: "3", label: "Met twice", condition: { activity: "met", withinDays: 60, atLeast: 2 }, points: 30 },
    { id: "4", label: "Do not contact", condition: { field: "doNotContact", op: "is", value: true }, points: -100 },
  ];

  it("adds up what holds, behaviour by its window and count", () => {
    const counts = new Map([
      [behaviourKey("replied", 30), 1],
      [behaviourKey("met", 60), 1],
    ]);
    const r = scoreRecord(rules, { title: "Chair", doNotContact: false }, counts);
    expect(r.score).toBe(35);
    expect(r.hits.map((h) => h.label)).toEqual(["Replied", "Has a title"]);
    expect(scoreRecord(rules, { title: "Chair" }, new Map([[behaviourKey("met", 60), 2]])).score).toBe(40);
  });

  it("stays between 0 and 100", () => {
    expect(scoreRecord(rules, { doNotContact: true, title: "x" }, new Map()).score).toBe(0);
    expect(clampScore(180)).toBe(100);
    expect(clampScore(-3)).toBe(0);
  });
});

describe("the learned model", () => {
  // Won items have a next step and replies; lost ones mostly don't.
  const defs = featureDefs(["form"], [{ id: "p1", name: "P" }]);
  const rows = Array.from({ length: 300 }, (_, i) => {
    const won = i % 3 !== 0;
    const noisy = i % 17 === 0;
    const x = featuresOf(
      {
        amountCents: 10_000 + (i % 7) * 1000,
        hasCompany: i % 2 === 0,
        hasNextStep: noisy ? !won : won,
        people: 1,
        emailsIn: won ? 3 : 0,
        emailsOut: 4,
        meetings: won ? 1 : 0,
        activities: 6,
        ageDays: 30,
        source: i % 4 === 0 ? "form" : null,
        pipelineId: "p1",
      },
      defs,
    );
    return { x, y: (won ? 1 : 0) as 0 | 1 };
  });

  it("learns the pattern, deterministically, and says how often it's right", () => {
    const a = trainLogistic(rows, defs, { now: new Date("2026-11-03T00:00:00Z") });
    const b = trainLogistic(rows, defs, { now: new Date("2026-11-03T00:00:00Z") });
    expect(a).toEqual(b);
    expect(a.n).toBe(300);
    expect(a.won).toBe(200);
    expect(a.accuracy).toBeGreaterThan(0.85);
    const good = featuresOf({ amountCents: 10_000, hasCompany: true, hasNextStep: true, people: 1, emailsIn: 3, emailsOut: 4, meetings: 1, activities: 6, ageDays: 30, source: null, pipelineId: "p1" }, defs);
    const bad = featuresOf({ amountCents: 10_000, hasCompany: true, hasNextStep: false, people: 1, emailsIn: 0, emailsOut: 4, meetings: 0, activities: 6, ageDays: 30, source: null, pipelineId: "p1" }, defs);
    expect(predict(a, good)).toBeGreaterThan(0.8);
    expect(predict(a, bad)).toBeLessThan(0.3);
    const reasons = topReasons(a, bad);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.direction === "down")).toBe(true);
  });
});

describe("forecasts", () => {
  it("names quarters and years, and steps between them", () => {
    expect(periodOf("quarter", "2026-11-03")).toMatchObject({ key: "2026-Q4", label: "Q4 2026", start: "2026-10-01", end: "2026-12-31" });
    expect(periodOf("year", "2026-02-10")).toMatchObject({ key: "2026", start: "2026-01-01", end: "2026-12-31" });
    expect(shiftPeriod(periodOf("quarter", "2026-11-03"), 1).key).toBe("2027-Q1");
    expect(shiftPeriod(periodOf("quarter", "2026-02-03"), -1).key).toBe("2025-Q4");
    expect(parsePeriodKey("2026-Q2")?.end).toBe("2026-06-30");
    expect(parsePeriodKey("Fall 2026")).toBeNull();
  });

  const q4 = periodOf("quarter", "2026-11-03");
  const items: ForecastItem[] = [
    { id: "a", amountCents: 100_000, expectedOn: "2026-11-20", closedOn: null, stageKind: "OPEN", probability: 50, category: "COMMIT", ownerId: "u1" },
    { id: "b", amountCents: 40_000, expectedOn: "2026-12-01", closedOn: null, stageKind: "OPEN", probability: 25, category: "BEST_CASE", ownerId: "u2" },
    { id: "c", amountCents: 10_000, expectedOn: null, closedOn: null, stageKind: "OPEN", probability: 10, category: "PIPELINE", ownerId: "u1" },
    { id: "d", amountCents: 20_000, expectedOn: "2026-10-15", closedOn: "2026-10-16", stageKind: "WON", probability: 100, category: "COMMIT", ownerId: "u1" },
    { id: "e", amountCents: 99_000, expectedOn: "2027-02-01", closedOn: null, stageKind: "OPEN", probability: 90, category: "COMMIT", ownerId: "u1" },
    { id: "f", amountCents: 5_000, expectedOn: "2026-11-01", closedOn: null, stageKind: "OPEN", probability: 90, category: "OMITTED", ownerId: "u1" },
  ];

  it("weighs by stage, rolls up categories with what's won, and counts people too", () => {
    const f = computeForecast(items, q4, true);
    expect(f.won).toEqual({ amount: 20_000, count: 1 });
    expect(f.weighted.amount).toBe(20_000 + 50_000 + 10_000 + 1_000);
    expect(f.commit).toEqual({ amount: 120_000, count: 2 });
    expect(f.bestCase).toEqual({ amount: 160_000, count: 3 });
    expect(f.pipeline).toEqual({ amount: 170_000, count: 4 });
    expect(f.undated).toBe(1);
    // A past period doesn't take undated items.
    expect(computeForecast(items, q4, false).pipeline.count).toBe(3);
  });

  it("has no trend without history, and one from it", () => {
    expect(computeTrend(items, q4, true, []).enough).toBe(false);
    const history = Array.from({ length: 24 }, (_, i) => ({
      createdOn: "2026-01-05",
      closedOn: `2026-0${(i % 6) + 3}-10`,
      won: i % 2 === 0,
      amountCents: 10_000,
    }));
    const t = computeTrend(items, q4, true, history);
    expect(t.enough).toBe(true);
    expect(t.winRate).toBeCloseTo(0.5);
    expect(t.averageWonCents).toBe(10_000);
    expect(t.expected.amount).toBeGreaterThan(20_000);
  });

  it("says what changed between snapshots", () => {
    const base: SnapshotData = {
      kind: "snapshot",
      period: q4.key,
      won: { amount: 0, count: 0 },
      weighted: { amount: 0, count: 0 },
      commit: { amount: 0, count: 0 },
      bestCase: { amount: 0, count: 0 },
      pipeline: { amount: 0, count: 0 },
      trend: null,
      call: null,
      items: [
        { id: "a", c: "PIPELINE", a: 100, s: "" },
        { id: "b", c: "COMMIT", a: 50, s: "" },
      ],
    };
    const later = { ...base, items: [{ id: "a", c: "COMMIT" as const, a: 120, s: "" }, { id: "z", c: "PIPELINE" as const, a: null, s: "" }] };
    const d = snapshotChanges(base, later);
    expect(d.added).toEqual(["z"]);
    expect(d.removed).toEqual(["b"]);
    expect(d.category).toEqual([{ id: "a", from: "PIPELINE", to: "COMMIT" }]);
    expect(d.amount).toEqual([{ id: "a", from: 100, to: 120 }]);
  });

  it("measures goals against an even pace", () => {
    const a = attainment(50, 100, q4, "2026-11-15");
    expect(a.share).toBe(0.5);
    expect(a.pace).toBeGreaterThan(0.45);
    expect(a.pace).toBeLessThan(0.55);
    expect(a.onTrack).toBe(true);
    expect(attainment(10, 100, q4, "2026-12-20").onTrack).toBe(false);
  });
});

describe("describe it in words", () => {
  const ctx: DescribeContext = {
    pipelines: [
      {
        id: "p1",
        name: "Volunteers",
        itemNoun: "volunteer",
        stages: [
          { id: "s1", name: "Interested", kind: "OPEN" },
          { id: "s2", name: "Joined", kind: "WON" },
        ],
      },
    ],
    members: [{ id: "u1", name: "Ada Lovelace" }],
    templates: [{ id: "t1", name: "Welcome" }],
    sequences: [],
    forms: [{ id: "f1", title: "Volunteer form" }],
    events: [],
    relationships: [{ id: "donor", label: "Donor" }],
  };

  it("reads the spec's example without a model", () => {
    const d = standinDescribe(
      "When someone fills in the volunteer form, add them to Volunteers, assign whoever has the fewest, and remind them in two days",
      ctx,
    );
    const { draft } = mapDescribed(d, ctx);
    expect(draft.trigger).toEqual({ type: "form.submitted", params: { object: "person", formId: "f1" } });
    expect(draft.actions.map((a) => a.type)).toEqual(["deal.create", "owner.assign", "task.create"]);
    expect(draft.actions[0]).toEqual({ type: "deal.create", params: { pipelineId: "p1" } });
    expect(draft.actions[2]).toMatchObject({ params: { dueInDays: 2 } });
    expect(workflowInputSchema.safeParse(draft).success).toBe(true);
  });

  it("maps names to the organization's ids and says what it left out", () => {
    const blank = {
      title: null,
      dueInDays: null,
      member: null,
      assignMode: null,
      field: null,
      value: null,
      pipeline: null,
      stage: null,
      template: null,
      sequence: null,
      event: null,
      message: null,
      url: null,
      tasks: null,
      direction: null,
    };
    const { draft, notes } = mapDescribed(
      {
        name: "Thank donors",
        trigger: { type: "stage.changed", object: "deal", pipeline: "volunteers", toStage: "joined", toKind: null, form: null, field: null, days: null, offsetDays: null },
        conditions: [
          { field: "Owner", op: "is", value: "ada lovelace" },
          { field: "Shoe size", op: "is", value: "9" },
        ],
        actions: [
          { ...blank, type: "notify", member: "Ada", message: "{name} joined" },
          { ...blank, type: "sequence.enroll", sequence: "Drip" },
          { ...blank, type: "slack.post", url: "http://nope" },
        ],
        unclear: null,
      },
      ctx,
    );
    expect(draft.trigger).toEqual({ type: "stage.changed", params: { pipelineId: "p1", toStageId: "s2" } });
    expect(draft.conditions).toEqual([{ field: "owner", op: "is", value: "u1" }]);
    // A model's {name} comes back in the merge fields' style.
    expect(draft.actions).toEqual([{ type: "notify", params: { to: "member", userId: "u1", message: "{{name}} joined" } }]);
    expect(notes.length).toBe(3);
  });
});
