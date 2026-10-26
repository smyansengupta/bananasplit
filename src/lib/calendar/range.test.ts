import { describe, expect, it } from "vitest";

import { NEW_EVENT_PARAM, newRsvpEventHref } from "./range";

describe("newRsvpEventHref", () => {
  it("opens New meeting as an event, on the Meetings page", () => {
    expect(newRsvpEventHref("club")).toBe("/app/club/meetings?new=event");
  });

  it("uses the shared ?new= parameter", () => {
    expect(NEW_EVENT_PARAM).toBe("new");
    expect(newRsvpEventHref("club")).toContain(`?${NEW_EVENT_PARAM}=`);
  });
});
