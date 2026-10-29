import {
  Bell,
  CalendarClock,
  CalendarPlus,
  Check,
  ClipboardList,
  Search,
  FileText,
  FolderOpen,
  History,
  Inbox,
  ListChecks,
  type IconComponent,
  MessageCircleQuestion,
  MessageSquareText,
  ScanLine,
  Receipt,
  ShieldCheck,
  Phone,
  Sparkles,
  Ticket,
  Users,
  Video,
  Bot,
  ChartColumn,
  Gauge,
  HandCoins,
  PiggyBank,
  Wallet,
} from "@/components/icons";

/**
 * The product pages (/product/<slug>), one per main feature on the home
 * page, laid out like Notion's: a hero (label, headline, one line, the two
 * buttons, the feature's illustration), how it works in three steps, six
 * capabilities, then the other main features and the final call to action.
 */

export type ProductSlug = "texting" | "ai" | "docs" | "meetings" | "finance";

export interface ProductPage {
  slug: ProductSlug;
  /** The small label, and the homepage card's label. */
  label: string;
  /** The homepage card's claim. */
  cardTitle: string;
  /** The homepage card's line. */
  cardBody: string;
  /** The page's headline and the line under it. */
  title: string;
  subtitle: string;
  steps: readonly { title: string; body: string }[];
  capabilitiesTitle: string;
  capabilities: readonly { icon: IconComponent; title: string; body: string }[];
}

export const PRODUCT_PAGES: readonly ProductPage[] = [
  {
    slug: "texting",
    label: "Text your workspace",
    cardTitle: "Your workspace, one text away.",
    cardBody: "Text Bananasplit like a teammate from iMessage or Android Messages. No app to open.",
    title: "Your workspace, one text away.",
    subtitle:
      "Text Bananasplit from iMessage or Android Messages and it creates tasks, sends reminders and answers what's due, like a teammate who never forgets.",
    steps: [
      { title: "Text it", body: "Send a message the way you'd text anyone on your team." },
      {
        title: "It's filed",
        body: "Bananasplit makes the task, event or note, with the owner and date.",
      },
      { title: "It follows up", body: "Reminders and answers arrive in the same thread." },
    ],
    capabilitiesTitle: "Everything you'd do in the app, from your messages",
    capabilities: [
      {
        icon: ListChecks,
        title: "Create and assign tasks",
        body: "“Maya books the venue by Friday” becomes a task on Maya's list, due Friday.",
      },
      {
        icon: MessageCircleQuestion,
        title: "Ask what's next",
        body: "Ask what's due, what's late or who's going, and get the answer in seconds.",
      },
      {
        icon: Bell,
        title: "Reminders that text back",
        body: "Due dates and meetings remind you in the thread, so nothing slips.",
      },
      {
        icon: CalendarClock,
        title: "Schedule on the go",
        body: "Book a meeting or move an event without opening a laptop.",
      },
      {
        icon: Phone,
        title: "iMessage and Android",
        body: "Works in the messaging app already on every phone. Nothing to install.",
      },
      {
        icon: ShieldCheck,
        title: "Only your team",
        body: "Texts are tied to each member's verified number and their organization's permissions.",
      },
    ],
  },
  {
    slug: "ai",
    label: "Native AI integration",
    cardTitle: "AI in every corner of your workspace.",
    cardBody:
      "Drafts docs, plans tasks, reads your inbox and writes the update, with Claude or ChatGPT.",
    title: "AI that does the busywork, everywhere.",
    subtitle:
      "Bananasplit's AI drafts docs, breaks plans into tasks, finds to-dos in your inbox and writes the weekly update, using Claude or ChatGPT. Nothing changes until you say yes.",
    steps: [
      { title: "Bring your model", body: "Connect Claude or ChatGPT in one click." },
      { title: "It suggests", body: "AI reads your notes, inbox and plans and drafts the work." },
      {
        title: "You approve",
        body: "Accept, edit or skip each suggestion. Nothing happens on its own.",
      },
    ],
    capabilitiesTitle: "AI built into every part of Bananasplit",
    capabilities: [
      {
        icon: FileText,
        title: "Drafts docs",
        body: "Turn meeting notes into a brief, an agenda or a recap in seconds.",
      },
      {
        icon: ListChecks,
        title: "Plans the work",
        body: "Break a goal into tasks with owners and due dates, ready to accept.",
      },
      {
        icon: Inbox,
        title: "Reads your inbox",
        body: "Finds the to-dos hiding in email and calendar invites and files them.",
      },
      {
        icon: Receipt,
        title: "Files receipts",
        body: "Matches each receipt to a budget line, so finance stays up to date.",
      },
      {
        icon: Sparkles,
        title: "Writes the weekly update",
        body: "A Friday recap of what got done, drafted for you to send.",
      },
      {
        icon: Bot,
        title: "Your model, your choice",
        body: "Use Claude or ChatGPT, or ask them to “add this to Bananasplit”.",
      },
    ],
  },
  {
    slug: "docs",
    label: "Docs and files",
    cardTitle: "Docs that turn into work.",
    cardBody: "Write together live, turn any line into a task, and keep every file in one place.",
    title: "Docs that turn into work.",
    subtitle:
      "Write together in real time, turn any line into a task, and keep every file, version and receipt in one searchable place.",
    steps: [
      {
        title: "Write together",
        body: "Everyone edits the same page live, with comments beside it.",
      },
      {
        title: "Turn it into work",
        body: "Make any line a task with an owner, without leaving the doc.",
      },
      { title: "Keep it forever", body: "Files and versions stay put, even when people move on." },
    ],
    capabilitiesTitle: "More than a doc editor",
    capabilities: [
      {
        icon: Users,
        title: "Live co-editing",
        body: "See teammates' cursors and edits as they type.",
      },
      {
        icon: MessageSquareText,
        title: "Comments and mentions",
        body: "Discuss beside the text and @mention anyone to pull them in.",
      },
      {
        icon: Check,
        title: "Lines become tasks",
        body: "Turn an action item into a task in one step, linked back to the doc.",
      },
      {
        icon: FolderOpen,
        title: "File storage built in",
        body: "Upload contracts, decks and receipts next to the work they belong to.",
      },
      {
        icon: History,
        title: "Version history",
        body: "Go back to any earlier version, and name the ones that matter.",
      },
      {
        icon: Search,
        title: "Find anything",
        body: "Search every doc and file in the workspace with ⌘K.",
      },
    ],
  },
  {
    slug: "meetings",
    label: "Meetings and events",
    cardTitle: "Book the call. Fill the room.",
    cardBody:
      "Create Zoom, Teams or Meet calls from Bananasplit, and run public events with RSVPs.",
    title: "Meetings and events, without the busywork.",
    subtitle:
      "Create Zoom, Teams or Google Meet calls right from Bananasplit, publish public event pages, and let RSVPs, waitlists and check-in run themselves.",
    steps: [
      { title: "Pick a time", body: "Send one link and see when everyone's free." },
      { title: "Book it", body: "Bananasplit creates the call and sends the invites." },
      {
        title: "Fill the room",
        body: "Public pages take RSVPs, run the waitlist and check people in.",
      },
    ],
    capabilitiesTitle: "From the first invite to the last check-in",
    capabilities: [
      {
        icon: Video,
        title: "Zoom, Teams and Meet",
        body: "Create the video call from any meeting, with the link added for you.",
      },
      {
        icon: CalendarPlus,
        title: "Meeting management",
        body: "Agendas, notes and follow-ups attached to every meeting.",
      },
      {
        icon: CalendarClock,
        title: "Find a time",
        body: "One poll link shows the best time. Guests answer without an account.",
      },
      {
        icon: Ticket,
        title: "Public event pages",
        body: "Publish an event in a minute, with a cap and a waitlist.",
      },
      {
        icon: ScanLine,
        title: "RSVPs and check-in",
        body: "Reminders go out on their own, and QR check-in takes seconds at the door.",
      },
      {
        icon: ClipboardList,
        title: "Attendance that counts",
        body: "Every guest lands in your records, so you see who keeps coming back.",
      },
    ],
  },
  {
    slug: "finance",
    label: "Finance",
    cardTitle: "Finance, handled.",
    cardBody: "Budgets, receipts, paybacks and runway, live.",
    title: "Finance, handled.",
    subtitle:
      "Budgets by category, receipts that file themselves, paybacks your team can request, and runway you can see at a glance. Only the owner, admins and treasurers see the books.",
    steps: [
      { title: "Set the budget", body: "Categories and amounts for the term or the year." },
      { title: "Spend and snap", body: "Members photograph receipts and ask to be paid back." },
      { title: "Approve and see it", body: "Approve in a click. Spend and runway update live." },
    ],
    capabilitiesTitle: "Your money, in plain sight",
    capabilities: [
      {
        icon: PiggyBank,
        title: "Budgets by category",
        body: "See what's left in every category, and what's over.",
      },
      {
        icon: Receipt,
        title: "Receipts that file themselves",
        body: "Snap a photo, or text it. It lands on the right transaction.",
      },
      {
        icon: HandCoins,
        title: "Paybacks",
        body: "Members ask to be paid back; finance approves and records it.",
      },
      {
        icon: Gauge,
        title: "Runway",
        body: "Months of money left, from what's coming in and going out.",
      },
      {
        icon: ChartColumn,
        title: "Live reports",
        body: "Spend by month and by category, ready for the board.",
      },
      {
        icon: Wallet,
        title: "Finance stays private",
        body: "Only the owner, admins and treasurers see the books.",
      },
    ],
  },
];

/** The page for `slug`, or undefined. */
export function productPage(slug: string): ProductPage | undefined {
  return PRODUCT_PAGES.find((p) => p.slug === slug);
}
