import { describe, expect, it } from "vitest";

import {
  FLAGGED_NOTE,
  taskAssignedEmail,
  taskBulkAssignedEmail,
  taskDigestEmail,
  taskMentionedEmail,
  taskReminderEmail,
} from "./email-templates";

const url = "http://localhost:3406/app/claude-builders-club/tasks/t_1";

describe("task email templates", () => {
  it("assignment: title, assigner, due date and an absolute link, all escaped", () => {
    const email = taskAssignedEmail({
      orgName: "Claude Builders Club",
      actorName: "Oliver <b>Ward</b>",
      role: "owner",
      task: {
        title: `Book rooms <script>alert("x")</script>`,
        dueLabel: "Fri, Oct 2",
        priority: "High",
      },
      flagged: false,
      url,
    });
    expect(email.subject).toContain("Oliver <b>Ward</b> assigned you");
    expect(email.html).toContain("Oliver &lt;b&gt;Ward&lt;/b&gt;");
    expect(email.html).toContain("Book rooms &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Fri, Oct 2");
    expect(email.html).toContain(`href="${url}"`);
    expect(email.text).toContain(`Open task: ${url}`);
    expect(email.text).toContain("Due: Fri, Oct 2");
    expect(email.html).not.toContain("Flagged:");
  });

  it("assignment above the assigner's level carries the flag note", () => {
    const email = taskAssignedEmail({
      orgName: "CBC",
      actorName: "Alex Green",
      role: "owner",
      task: { title: "Khoury check-in", dueLabel: null },
      flagged: true,
      url,
    });
    expect(email.text).toContain(FLAGGED_NOTE);
    expect(email.text).toContain("Due: No due date");
  });

  it("rejects a non-http link", () => {
    expect(() =>
      taskAssignedEmail({
        orgName: "CBC",
        actorName: "A",
        role: "owner",
        task: { title: "t", dueLabel: null },
        flagged: false,
        url: "javascript:alert(1)",
      }),
    ).toThrow();
  });

  it("bulk assignment lists every title in one message", () => {
    const email = taskBulkAssignedEmail({
      orgName: "CBC",
      actorName: "Oliver Ward",
      items: ["One (due Fri, Oct 2)", "Two & <three>"],
      flagged: false,
      url,
    });
    expect(email.subject).toBe("Oliver Ward assigned you 2 tasks");
    expect(email.html).toContain("Two &amp; &lt;three&gt;");
    expect(email.text).toContain("- One (due Fri, Oct 2)");
  });

  it("mention, reminder and digest render the task and a link", () => {
    const mention = taskMentionedEmail({
      orgName: "CBC",
      actorName: "Oliver Ward",
      where: "comment",
      excerpt: "cc @Alex Green",
      task: { title: "Rooms", dueLabel: "Fri, Oct 2" },
      url,
    });
    expect(mention.text).toContain("mentioned you in a comment");
    const reminder = taskReminderEmail({
      orgName: "CBC",
      when: "tomorrow",
      role: "owner",
      task: { title: "Rooms", dueLabel: "Fri, Oct 2" },
      url,
    });
    expect(reminder.subject).toBe("Due tomorrow: Rooms");
    const digest = taskDigestEmail({
      orgName: "CBC",
      dateLabel: "Thu, Oct 1",
      sections: {
        overdue: [{ title: "Late <one>", dueLabel: "Mon, Sep 28", url }],
        today: [],
        thisWeek: [],
        newlyAssigned: [],
        mentioned: [],
        blocked: [{ title: "Stuck", dueLabel: null, url, note: "waiting on rooms" }],
      },
      url,
    });
    expect(digest.html).toContain("Overdue (1)");
    expect(digest.html).toContain("Late &lt;one&gt;");
    expect(digest.html).not.toContain("Due today");
    expect(digest.text).toContain("- Stuck - waiting on rooms");
  });
});
