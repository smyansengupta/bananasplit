/**
 * What changed in each version of Bananasplit, newest first. Shown in the
 * Admin panel under What's new. Add an entry here with every change members
 * would notice; bump package.json's version when you cut a release.
 */
export type ReleaseKind = "New" | "Improved" | "Fixed";

export interface Release {
  /** Semver, e.g. "0.9.0". */
  version: string;
  /** ISO date the release landed (YYYY-MM-DD). */
  date: string;
  title: string;
  summary?: string;
  sections: { kind: ReleaseKind; items: string[] }[];
}

export const RELEASES: readonly Release[] = [
  {
    version: "0.9.0",
    date: "2026-10-23",
    title: "Personal Databases, easier club creation",
    summary: "Your Personal space grows up, and starting a club no longer needs a code.",
    sections: [
      {
        kind: "New",
        items: [
          "Personal gets Databases, so you can keep your own tables and spreadsheets.",
          "Any verified account can create a club by default.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "Personal Files work without club sharing.",
          "Dragging a file into a folder moves it instead of copying it.",
          "Fixes across the Tasks board, centred task windows, storage, page headers, Teams and Find a time.",
        ],
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-20",
    title: "Moonstone polish: epics, notes sheets, a better Overview",
    sections: [
      {
        kind: "New",
        items: [
          "Projects become epics: one hierarchy, Epic > Story > Task.",
          "Page mode in Notes writes on a sheet, with a tidier title area.",
          "RSVPs show event cards with their pictures, the next one featured.",
          "The Overview opens with a stat strip and Up next, and a new Get your club started card.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "Tasks: a Filters chip, a centred New task window, the Board first, clearer edges and a clear-completed button.",
          "The public RSVP page is rebuilt on Moonstone.",
        ],
      },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-19",
    title: "Moonstone redesign",
    summary: "A new look across the whole app, plus the biggest feature round so far.",
    sections: [
      {
        kind: "New",
        items: [
          "Moonstone: a new default theme, sidebar, tool capsule and phone tab bar, with dark by default.",
          "Notes: nested pages, Page and Document modes, comment threads, version history, suggesting, and export to Word, Markdown and PDF.",
          "Tasks: epics, stories and tasks, #tags in titles, a Roadmap, board swimlanes and a List grouped by epic.",
          "Weekly pulse: each club's recap is compiled, scheduled and sent, with an archive and its own Admin panel page.",
          "Plans and storage: four tiers, Personal Free and Plus, a usage meter, an 80% banner, the largest files and Empty trash.",
          "People: a directory you search as you type, with a profile sheet beside it.",
          "Org chart: type the chart beside a live preview, start from members, and export it.",
          "Personal files and notes, with Send to a club.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "Calendar, RSVPs, polls, Reports, Databases, Finance and Settings are restyled on Moonstone, with one chart kit and one table style.",
          "Live collaboration is on whenever a collaboration server is configured.",
          "Big uploads go direct, through one upload gate that shows the numbers.",
        ],
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-16",
    title: "Clubs, RSVPs and shared notes",
    sections: [
      {
        kind: "New",
        items: [
          "Personal space for everyone, and clubs start on a 30-day trial.",
          "Notes can be shared with viewers and editors; tables can be sized, and Excel files imported.",
          "Tasks get a Dashboard layout and a weekly update on the club's chosen day.",
          "Find a time and RSVPs get their own tabs; polls preview as an invitation to fill them out.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "The app says club and invite code throughout, and page titles follow your club's section names.",
          "Production deploys from CI after the test suites pass.",
        ],
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-12",
    title: "A new front door, public RSVPs and club databases",
    sections: [
      {
        kind: "New",
        items: [
          "Redesigned home page, sign-in, join, checkout and onboarding, with real app screenshots and FAQs.",
          "Public RSVP pages for events, with a waitlist that gives a freed spot to the next guest.",
          "Club-made databases, stored in Bananasplit and saved as you type.",
          "Password reset; sessions end when a password changes.",
          "Guest invite links for Find a time polls; due-today and overdue task emails.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "Club codes are eight characters, like RPKA-YWSF.",
          "One button and tab style across the suite, and brand fonts app-wide.",
        ],
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-02",
    title: "AI imports, pins and search",
    sections: [
      {
        kind: "New",
        items: [
          "AI imports: action items from notes into tasks and events, calendar screenshots into events, and past finance records.",
          "A rebuilt ⌘K palette that finds anything.",
          "Sponsorships in cash or credits, and folders from New.",
          "PDF download for notes.",
          "A finance setup guide and more finance widgets.",
        ],
      },
      {
        kind: "Fixed",
        items: [
          "Unmarking a time in an availability poll clears it instead of marking it unavailable.",
          "Signing out a session whose user no longer exists, instead of looping between sign-in and onboarding.",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-30",
    title: "Bananasplit: any club, your own layout",
    summary: "The app is renamed Bananasplit and is no longer tied to one club.",
    sections: [
      {
        kind: "New",
        items: [
          "A customizable Overview and Finance board, with charts, that each member arranges.",
          "Pin anything: notes, files, folders, tasks, events, polls, people, databases and views.",
          "Onboarding flows for clubs, and a getting-started list for new ones.",
          "Notes with files, Word and Google Docs import, previews and folders.",
          "Availability: import a schedule screenshot, review, then add.",
          "A per-club sidebar and a redesigned Settings.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "Tasks look the same across week, board, table, calendar and team.",
          "Empty states give a next step, and anything you delete can be undone.",
          "The app is club-neutral where it was hard-coded to the original club.",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-24",
    title: "The platform: settings, org chart, databases and reports",
    sections: [
      {
        kind: "New",
        items: [
          "Settings: General, Privacy, Integrations, Theme and the audit log, plus the Danger zone with export and delete.",
          "Org chart: an interactive chart, a draft editor, imports and version history.",
          "Databases and Reports, with deep links and CSV export.",
          "Five integrations: Claude, email, Google Calendar, website data and the build hook, with a guided setup.",
          "Per-club themes with contrast checks, and a rebuilt Tasks workspace and calendar.",
          "People directory, profiles and calendar feeds.",
        ],
      },
      {
        kind: "Improved",
        items: [
          "Every table is protected by database rules, and a content security policy is enforced by default.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-13",
    title: "First release",
    summary: "The original portal for the Claude Builders Club.",
    sections: [
      {
        kind: "New",
        items: [
          "Sign-in and clubs with roles.",
          "Task management, notes, calendar and scheduling, and a finance tracker.",
        ],
      },
    ],
  },
];

/** The newest release. */
export function latestRelease(): Release {
  return RELEASES[0]!;
}
