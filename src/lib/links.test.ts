import { describe, expect, it } from "vitest";

import { LINK_KINDS, opensAsCard } from "./links";

describe("opensAsCard", () => {
  it("opens CRM people, companies and deals as their card, everything else in the peek", () => {
    const cards = LINK_KINDS.filter(opensAsCard);
    expect(cards).toEqual(["crm-person", "crm-company", "crm-deal"]);
  });
});
