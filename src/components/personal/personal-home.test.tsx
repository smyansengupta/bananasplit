import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PersonalHomeData } from "@/server/personal/home";

/**
 * The Personal dashboard as rendered: each section with data, and the empty
 * states that teach what goes there and how to start.
 */

vi.mock("@/app/onboarding/actions", () => ({ joinPendingInvitationAction: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/tasks/actions", () => ({ setTaskStatus: vi.fn() }));

const { PersonalHome } = await import("./personal-home");

// 10:00 on Tuesday, Oct 13 in Chicago.
const NOW = new Date("2026-10-13T15:00:00Z");
const robotics = {
  id: "c1",
  name: "Robotics",
  slug: "robotics",
  kind: "CLUB" as const,
  timeZone: "America/Chicago",
};
const personal = {
  id: "p1",
  name: "Personal",
  slug: "me-abc",
  kind: "PERSONAL" as const,
  timeZone: "America/Chicago",
};

const empty: PersonalHomeData = {
  firstName: "Maya",
  timeZone: "America/Chicago",
  todayKey: "2026-10-13",
  emailVerified: true,
  clubs: [],
  moreClubs: 0,
  pendingInvites: [],
  upcoming: [],
  dueSoon: [],
  dueSoonTotal: 0,
  pollsWaiting: [],
  ownPolls: [],
  rsvps: [],
  hosting: [],
  profileGaps: [],
  finishProfileHref: null,
  yourWeek: { done: 0, bySpace: [] },
  recentFiles: [],
};

function render(data: PersonalHomeData) {
  return renderToStaticMarkup(<PersonalHome data={data} orgSlug="me-abc" now={NOW} />).replace(
    / /g,
    " ",
  );
}

describe("PersonalHome", () => {
  it("greets by name and teaches every empty section", () => {
    const html = render(empty);
    expect(html).toContain("Good morning, Maya");
    expect(html).toContain("Only you can see Personal");
    // No clubs: why to join, a code field right here, and Start a club.
    expect(html).toContain("Joining is always free");
    expect(html).toMatch(/<form[^>]*action="\/onboarding\/join"[^>]*method="get"/);
    expect(html).toContain('name="code"');
    expect(html).toContain('href="/onboarding/organization"');
    expect(html).toContain("Nothing in the next 14 days");
    expect(html).toContain("Nothing due this week");
    expect(html).toContain("No RSVPs yet");
    expect(html).toContain('href="/app/me-abc/meetings"');
    expect(html).toContain("No polls waiting");
    expect(html).toContain('href="/app/me-abc/calendar/find-a-time/new"');
    expect(html).not.toContain("Finish your profile");
    expect(html).not.toContain("invited");
  });

  it("shows invites and Finish your profile at the top", () => {
    const html = render({
      ...empty,
      pendingInvites: [
        {
          id: "i1",
          organizationId: "c9",
          role: "MEMBER",
          expiresAt: new Date("2026-10-20T00:00:00Z"),
          orgName: "Debate Society",
        },
      ],
      profileGaps: ["bio", "availability"],
      finishProfileHref: "/onboarding/profile/bio",
    });
    expect(html).toContain("You&#x27;re invited to a club");
    expect(html).toContain("Debate Society");
    expect(html).toContain(">Join<");
    expect(html).toContain("Finish your profile");
    expect(html).toContain("Add your bio and links and when you can&#x27;t meet.");
    expect(html).toContain('href="/onboarding/profile/bio"');
    expect(html.indexOf("Debate Society")).toBeLessThan(html.indexOf("clubs-heading"));
  });

  it("renders club cards that open the club, with role, next meeting, tasks and unread", () => {
    const html = render({
      ...empty,
      clubs: [
        {
          id: "c1",
          name: "Robotics",
          slug: "robotics",
          logo: null,
          role: "ADMIN",
          title: "Treasurer",
          nextMeeting: {
            id: "m1",
            title: "General meeting",
            startsAt: new Date("2026-10-14T23:00:00Z"),
            endsAt: new Date("2026-10-15T00:00:00Z"),
            allDay: false,
          },
          openTasks: 3,
          unread: 2,
          paused: false,
          timeZone: "America/Chicago",
        },
        {
          id: "c2",
          name: "Chess",
          slug: "chess",
          logo: null,
          role: "MEMBER",
          title: null,
          nextMeeting: null,
          openTasks: 0,
          unread: 0,
          paused: true,
          timeZone: "America/Chicago",
        },
      ],
      moreClubs: 1,
    });
    expect(html).toContain('href="/app/robotics"');
    expect(html).toContain("Treasurer · Admin");
    expect(html).toContain("General meeting");
    expect(html).toContain("Tomorrow, 6:00 PM – 7:00 PM");
    expect(html).toContain("3 open tasks");
    expect(html).toContain("2 unread");
    expect(html).toContain('href="/app/chess"');
    expect(html).toContain("Paused");
    expect(html).toContain("No meeting on the calendar");
    expect(html).toContain("And 1 more");
    expect(html).not.toContain("Joining is always free");
  });

  it("lists upcoming events, due tasks, RSVPs and polls, each labelled by space", () => {
    const html = render({
      ...empty,
      upcoming: [
        {
          id: "e1",
          title: "Build night",
          startsAt: new Date("2026-10-13T23:00:00Z"),
          endsAt: new Date("2026-10-14T01:00:00Z"),
          allDay: false,
          kind: "WORKSHOP",
          location: "Lab 3",
          rsvp: "YES",
          space: robotics,
          href: "/app/robotics/calendar/e1",
        },
      ],
      dueSoon: [
        {
          id: "t1",
          title: "Submit budget",
          status: "NOT_STARTED",
          dueKey: "2026-10-10",
          bucket: "overdue",
          space: robotics,
          href: "/app/robotics/tasks/t1",
        },
        {
          id: "t2",
          title: "Call mom",
          status: "NOT_STARTED",
          dueKey: "2026-10-13",
          bucket: "today",
          space: personal,
          href: "/app/me-abc/tasks/t2",
        },
      ],
      dueSoonTotal: 5,
      rsvps: [
        {
          registrationId: "r1",
          status: "GOING",
          title: "Hack night",
          startsAt: new Date("2026-10-15T23:00:00Z"),
          endsAt: new Date("2026-10-16T02:00:00Z"),
          allDay: false,
          host: "Code Club",
          timeZone: "America/New_York",
          pageHref: "/e/hack2026",
          ticketHref: "/e/hack2026/t/abcdefghjkmn",
        },
      ],
      hosting: [
        {
          id: "h1",
          title: "Birthday",
          startsAt: new Date("2026-10-17T23:00:00Z"),
          endsAt: new Date("2026-10-18T03:00:00Z"),
          allDay: false,
          enabled: true,
          going: 7,
          waitlist: 2,
          capacity: 20,
          manageHref: "/app/me-abc/calendar/h1/rsvp",
          pageHref: "/e/bday1234",
        },
      ],
      pollsWaiting: [
        {
          id: "a1",
          kind: "availability",
          title: "Kickoff time",
          closesAt: null,
          space: robotics,
          href: "/app/robotics/calendar/polls/a1",
        },
      ],
      ownPolls: [
        {
          id: "o1",
          title: "Study group",
          respondents: 4,
          closesAt: null,
          space: personal,
          href: "/app/me-abc/calendar/polls/o1",
        },
      ],
    });
    expect(html).toContain('href="/app/robotics/calendar/e1"');
    expect(html).toContain("Build night");
    expect(html).toContain("Going");
    expect(html).toContain("Lab 3");
    expect(html).toContain("Overdue");
    expect(html).toContain('aria-label="Mark &quot;Submit budget&quot; done"');
    expect(html).toContain('href="/app/me-abc/tasks/t2"');
    expect(html).toContain("And 3 more.");
    expect(html).toContain('href="/e/hack2026/t/abcdefghjkmn"');
    expect(html).toContain("Code Club");
    expect(html).toContain("7 / 20 going");
    expect(html).toContain("2 waitlisted");
    expect(html).toContain('href="/app/robotics/calendar/polls/a1"');
    expect(html).toContain("Mark when you&#x27;re free");
    expect(html).toContain("4 answered");
  });

  it("speaks the Overview's language: stats, Up next, Your week and Recent files", () => {
    const html = render({
      ...empty,
      dueSoon: [
        {
          space: personal,
          id: "t9",
          title: "Renew passport",
          status: "NOT_STARTED",
          dueKey: "2026-10-13",
          bucket: "today",
          href: "/app/me-abc/tasks/t9",
        },
      ],
      dueSoonTotal: 1,
      yourWeek: { done: 5, bySpace: [{ space: robotics, done: 3 }, { space: personal, done: 2 }] },
      recentFiles: [
        {
          id: "f1",
          name: "Resume.pdf",
          contentType: "application/pdf",
          createdAt: new Date("2026-10-13T13:00:00Z"),
          href: "/app/me-abc/notes/files/f1",
        },
      ],
    });
    expect(html).toContain("Due this week");
    expect(html).toContain("1 due today");
    expect(html).toContain('aria-labelledby="up-next-heading"');
    expect(html).toContain("Due today");
    expect(html).toContain("Your week");
    expect(html).toContain("tasks finished in the last 7 days");
    expect(html).toContain("Robotics");
    expect(html).toContain('href="/app/me-abc/notes/files/f1"');
    expect(html).toContain("Resume.pdf");
  });
});
