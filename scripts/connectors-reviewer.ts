/**
 * The directory reviewers' test account (docs/features/ai-connectors.md,
 * "Launch checklist"): a password account, confirmed and onboarded, that
 * owns a populated organization on the Team plan, so every connector tool
 * has something to read and change. Claude's and ChatGPT's reviewers sign
 * in with it at /connect; ChatGPT's needs a password account without MFA,
 * which every Bananasplit password account is.
 *
 *   pnpm tsx --tsconfig tsconfig.scripts.json scripts/connectors-reviewer.ts \
 *     --target-env <VAR> --email <address> [--name "App Reviewer"] [--production]
 *
 * - --target-env names the environment variable holding the database URL
 *   to write to, as the table owner (MIGRATE_DATABASE_URL locally). There is
 *   no default: the script never picks a database by itself, and a URL is
 *   never read from the command line, so it stays out of shell history.
 * - It refuses any database that is neither on this machine nor marked
 *   fixture-only (app.fixture_only = 'on', RUNBOOK "Previews"), unless
 *   --production says that is meant: the reviewers sign in on production.
 * - The password is CONNECTORS_REVIEWER_PASSWORD when set (12 characters or
 *   more). A new account without it gets a random one, printed once. A
 *   re-run without it keeps the password the account has.
 * - The email must be new, or the account an earlier run made (the owner of
 *   the reviewer organization). Any other existing account is refused, so a
 *   real member's password is never replaced.
 * - Re-runnable: the reviewer organization is deleted and made again, with
 *   dates relative to today. Its other members are fictional, at
 *   example.com, with every email notification off and no password.
 *
 * Writes as the table owner, so RLS doesn't apply (the database's own
 * triggers do), in one transaction: it all lands or none of it does.
 */
import "dotenv/config";

import { randomBytes, randomInt } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { generateNKeysBetween } from "fractional-indexing";

import {
  NoteVisibility,
  OrgKind,
  OrgPlan,
  PrismaClient,
  Role,
  RSVPStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
  TransactionDirection,
  TransactionKind,
  TransactionStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { NOTIFICATION_TYPES } from "@/lib/notifications/preferences";
import { addDaysToKey, fromDateKey, localDateKey, zonedInstant } from "@/lib/tasks/dates";

const ORG = { name: "Northwind Robotics Club", slug: "northwind-robotics-review" };
const TZ = "America/New_York";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);
const PASSWORD_MIN = 12;

type Tx = Prisma.TransactionClient;

interface Args {
  targetEnv: string;
  email: string;
  name: string;
  production: boolean;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const targetEnv = value("--target-env");
  const email = value("--email")?.trim().toLowerCase();
  if (!targetEnv || !email) {
    fail(
      'Usage: connectors-reviewer.ts --target-env <VAR> --email <address> [--name "App Reviewer"] [--production]',
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`Not an email address: ${email}`);
  return {
    targetEnv,
    email,
    name: value("--name")?.trim() || "App Reviewer",
    production: argv.includes("--production"),
  };
}

/** Why `url`'s database isn't one this script may write to without --production, or null. */
async function productionReason(prisma: PrismaClient, url: URL): Promise<string | null> {
  if (LOCAL_HOSTS.has(url.hostname)) return null;
  const [row] = await prisma.$queryRaw<{ v: string | null }[]>`
    SELECT current_setting('app.fixture_only', true) AS v`;
  if (row?.v === "on") return null;
  return `${url.hostname} isn't on this machine and its database isn't marked app.fixture_only = 'on'`;
}

/** Every email notification off: the fictional members' addresses don't exist. */
function noEmail(): Prisma.InputJsonValue {
  return {
    v: 2,
    types: Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, false])),
    digest: { enabled: false, hourLocal: 8 },
    reminderLeadDays: 1,
    collaboratorReminders: false,
  };
}

const PEOPLE = [
  { key: "maya", name: "Maya Patel", role: Role.ADMIN, title: "President" },
  { key: "jordan", name: "Jordan Lee", role: Role.TREASURER, title: "Treasurer" },
  { key: "sam", name: "Sam Rivera", role: Role.MEMBER, title: "Build lead" },
  { key: "priya", name: "Priya Shah", role: Role.MEMBER, title: "Software lead" },
  { key: "alex", name: "Alex Kim", role: Role.MEMBER, title: "Outreach" },
] as const;
type PersonKey = (typeof PEOPLE)[number]["key"] | "me";

/** A note body: headings, paragraphs and bullet lists, as the editor stores them. */
type Block = { h: string } | { p: string } | { ul: string[] };

function noteContent(blocks: Block[]): { contentJson: Prisma.InputJsonValue; contentText: string } {
  const text = (t: string) => [{ type: "text", text: t }];
  const paragraph = (t: string) => ({ type: "paragraph", content: text(t) });
  const content = blocks.map((b) =>
    "h" in b
      ? { type: "heading", attrs: { level: 2 }, content: text(b.h) }
      : "p" in b
        ? paragraph(b.p)
        : {
            type: "bulletList",
            content: b.ul.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
          },
  );
  const contentText = blocks
    .map((b) => ("h" in b ? b.h : "p" in b ? b.p : b.ul.join("\n")))
    .join("\n\n");
  return { contentJson: { type: "doc", content }, contentText };
}

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** The reviewer's own Personal space, made as the app makes one (src/server/personal/space.ts). */
async function ensurePersonal(tx: Tx, userId: string, name: string): Promise<string | null> {
  const found = await tx.organization.findFirst({
    where: { personalOwnerId: userId, kind: OrgKind.PERSONAL },
    select: { id: true },
  });
  if (found) return null;
  let slug = "me-";
  for (let i = 0; i < 10; i++) slug += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  const space = await tx.organization.create({
    data: {
      name: `${name.split(/\s+/)[0]}'s space`,
      slug,
      timezone: TZ,
      kind: OrgKind.PERSONAL,
      personalOwnerId: userId,
      plan: OrgPlan.FREE,
    },
    select: { id: true },
  });
  await tx.membership.create({
    data: { organizationId: space.id, userId, role: Role.OWNER },
  });
  return space.id;
}

async function seed(tx: Tx, args: Args, passwordHash: string | null): Promise<void> {
  const now = new Date();
  const today = localDateKey(now, TZ);
  const day = (offset: number) => fromDateKey(addDaysToKey(today, offset));
  const at = (offset: number, hour: number) => zonedInstant(addDaysToKey(today, offset), hour, TZ);

  // ---- People
  const me = await tx.user.upsert({
    where: { email: args.email },
    update: { name: args.name },
    create: {
      email: args.email,
      name: args.name,
      emailVerified: now,
      onboardedAt: now,
      timezone: TZ,
    },
    select: { id: true },
  });
  if (passwordHash) {
    await tx.userCredential.upsert({
      where: { userId: me.id },
      update: { passwordHash },
      create: { userId: me.id, passwordHash },
    });
  }
  const ids: Record<PersonKey, string> = { me: me.id } as Record<PersonKey, string>;
  for (const person of PEOPLE) {
    const email = `northwind-${person.key}@example.com`;
    const user = await tx.user.upsert({
      where: { email },
      update: { name: person.name, emailPreferences: noEmail() },
      create: {
        email,
        name: person.name,
        emailVerified: now,
        onboardedAt: now,
        timezone: TZ,
        emailPreferences: noEmail(),
      },
      select: { id: true },
    });
    ids[person.key] = user.id;
  }

  // ---- Personal: a few things of the reviewer's own, the first time only
  const personalId = await ensurePersonal(tx, me.id, args.name);
  if (personalId) {
    const ranks = generateNKeysBetween(null, null, 2);
    await tx.task.createMany({
      data: [
        { title: "Finish the circuits lab report", dueDate: day(2), rank: ranks[0]! },
        { title: "Renew library books", dueDate: day(5), rank: ranks[1]! },
      ].map((t) => ({ ...t, organizationId: personalId, createdById: me.id, ownerId: me.id })),
    });
    await tx.note.create({
      data: {
        organizationId: personalId,
        title: "Reading list",
        ...noteContent([
          { ul: ["Practical Electronics for Inventors", "The Design of Everyday Things"] },
        ]),
        authorId: me.id,
        updatedById: me.id,
      },
    });
  }

  // ---- The organization: made fresh each run (deleting it cascades). Only
  // the reviewer's own is deleted: if anyone else's held the slug, the
  // create below would fail and roll everything back.
  await tx.organization.deleteMany({
    where: { slug: ORG.slug, memberships: { some: { userId: me.id, role: Role.OWNER } } },
  });
  const org = await tx.organization.create({
    data: { name: ORG.name, slug: ORG.slug, timezone: TZ, plan: OrgPlan.CLUB },
    select: { id: true },
  });
  const orgId = org.id;
  // The owner first: the membership guard lets a new organization's first member be its OWNER.
  await tx.membership.create({
    data: { organizationId: orgId, userId: me.id, role: Role.OWNER, title: "Vice President" },
  });
  await tx.membership.createMany({
    data: PEOPLE.map((p) => ({
      organizationId: orgId,
      userId: ids[p.key],
      role: p.role,
      title: p.title,
    })),
  });

  // ---- Tasks
  const epic = await tx.task.create({
    data: {
      organizationId: orgId,
      type: TaskType.EPIC,
      title: "Spring regional competition",
      rank: "a0",
      createdById: ids.maya,
      ownerId: ids.maya,
    },
    select: { id: true },
  });
  const tasks: {
    title: string;
    owner: PersonKey;
    due?: number;
    status?: TaskStatus;
    priority?: TaskPriority;
    description?: string;
    blockedReason?: string;
    inEpic?: boolean;
  }[] = [
    {
      title: "Order replacement servos",
      owner: "me",
      due: 3,
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      description: "Two servos on the arm stripped their gears at the last build night.",
      inEpic: true,
    },
    { title: "Draft sponsor thank-you letters", owner: "me", due: 6 },
    { title: "Update the parts inventory", owner: "me", due: -1, priority: TaskPriority.LOW },
    { title: "Book the gym for demo day", owner: "me", status: TaskStatus.COMPLETED },
    {
      title: "Wire the new drivetrain",
      owner: "sam",
      due: 4,
      status: TaskStatus.IN_PROGRESS,
      inEpic: true,
    },
    {
      title: "Fix autonomous path drift",
      owner: "priya",
      due: 5,
      status: TaskStatus.BLOCKED,
      blockedReason: "Waiting on the new encoder.",
      inEpic: true,
    },
    { title: "Post the build night photos", owner: "alex", due: 2, priority: TaskPriority.LOW },
    { title: "Reimburse pizza for build night", owner: "jordan", due: 5 },
    {
      title: "Register the team for regionals",
      owner: "maya",
      due: 10,
      priority: TaskPriority.HIGH,
      inEpic: true,
    },
  ];
  const ranks = generateNKeysBetween(null, null, tasks.length);
  const taskIds: string[] = [];
  for (const [i, t] of tasks.entries()) {
    const status = t.status ?? TaskStatus.NOT_STARTED;
    const task = await tx.task.create({
      data: {
        organizationId: orgId,
        title: t.title,
        description: t.description ?? null,
        status,
        priority: t.priority ?? TaskPriority.MEDIUM,
        dueDate: t.due === undefined ? null : day(t.due),
        rank: ranks[i]!,
        parentTaskId: t.inEpic ? epic.id : null,
        createdById: ids.maya,
        ownerId: ids[t.owner],
        blockedReason: t.blockedReason ?? null,
        blockedAt: status === TaskStatus.BLOCKED ? at(-2, 10) : null,
        completedAt: status === TaskStatus.COMPLETED ? at(-1, 15) : null,
      },
      select: { id: true },
    });
    taskIds.push(task.id);
  }
  await tx.taskComment.createMany({
    data: [
      { authorId: ids.sam, body: "The 25 kg servos are back in stock at the usual supplier." },
      { authorId: ids.maya, body: "Get four, so we have spares for regionals." },
    ].map((c) => ({ ...c, organizationId: orgId, taskId: taskIds[0]! })),
  });

  // ---- Events: the reviewer is invited to the upcoming ones and hasn't answered
  const event = async (
    title: string,
    startsAt: Date,
    hours: number,
    location: string,
    rsvps: Partial<Record<PersonKey, RSVPStatus>>,
  ) =>
    (
      await tx.event.create({
        data: {
          organizationId: orgId,
          title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + hours * 60 * 60 * 1000),
          location,
          createdById: ids.maya,
          attendees: {
            create: Object.entries(rsvps).map(([key, rsvp]) => ({
              userId: ids[key as PersonKey],
              rsvp,
            })),
          },
        },
        select: { id: true },
      })
    ).id;
  const { YES, NO, MAYBE, PENDING } = RSVPStatus;
  const kickoff = await event("Season kickoff meeting", at(-6, 19), 1, "Engineering Lab 204", {
    me: YES,
    maya: YES,
    jordan: YES,
    sam: YES,
    priya: NO,
    alex: YES,
  });
  await event("Build night", at(2, 18), 3, "Engineering Lab 204", {
    me: PENDING,
    sam: YES,
    priya: YES,
    alex: MAYBE,
  });
  await event("General meeting", at(7, 19), 1, "Student Center, Room 310", {
    me: PENDING,
    maya: YES,
    jordan: YES,
    sam: MAYBE,
    priya: YES,
    alex: PENDING,
  });
  await event("Spring regional competition", at(24, 8), 9, "Riverside Arena", {
    me: YES,
    maya: YES,
    jordan: MAYBE,
    sam: YES,
    priya: YES,
    alex: PENDING,
  });

  // ---- Notes (one private to Maya: the reviewer can't read it)
  const note = (
    title: string,
    author: PersonKey,
    blocks: Block[],
    extra: { visibility?: NoteVisibility; eventId?: string } = {},
  ) =>
    tx.note.create({
      data: {
        organizationId: orgId,
        title,
        ...noteContent(blocks),
        visibility: extra.visibility ?? NoteVisibility.ORGANIZATION,
        eventId: extra.eventId ?? null,
        authorId: ids[author],
        updatedById: ids[author],
      },
    });
  await note(
    "Season kickoff meeting notes",
    "maya",
    [
      { h: "Decisions" },
      {
        ul: [
          "We enter the spring regional competition.",
          "Build nights move to Tuesdays and Thursdays.",
          "The parts budget is $1,500 for the season.",
        ],
      },
      { h: "Action items" },
      {
        ul: [
          "Order replacement servos for the arm.",
          "Register the team for regionals before the deadline.",
          "Write thank-you letters to last season's sponsors.",
        ],
      },
    ],
    { eventId: kickoff },
  );
  await note("Robot build log", "sam", [
    { p: "Drivetrain: the new gearbox fits; wiring starts this week." },
    { p: "Arm: two servos stripped their gears under load. Replacements are on order." },
    { p: "Autonomous: the robot drifts left on long paths. Priya suspects the old encoder." },
  ]);
  await note("Sponsor outreach plan", "alex", [
    { h: "Who to ask" },
    { ul: ["Local hardware store", "University engineering department", "Alumni network"] },
    { p: "Send letters two weeks before the competition, with photos from build nights." },
  ]);
  await note(
    "Officer transition thoughts",
    "maya",
    [{ p: "Private draft: who might run for president next year." }],
    { visibility: NoteVisibility.PRIVATE },
  );

  // ---- A database the organization made
  const inventory = await tx.databaseDefinition.create({
    data: {
      organizationId: orgId,
      key: "parts-inventory",
      name: "Parts inventory",
      description: "What's on the shelves in Lab 204, and who has it.",
      kind: "CUSTOM",
      memberCanEdit: true,
      createdById: ids.sam,
    },
    select: { id: true },
  });
  const field = async (
    name: string,
    type: "TEXT" | "SELECT" | "NUMBER" | "MEMBER",
    sortOrder: number,
    options: Prisma.InputJsonValue = {},
  ) =>
    (
      await tx.databaseField.create({
        data: {
          organizationId: orgId,
          databaseId: inventory.id,
          name,
          type,
          options,
          isPrimary: sortOrder === 0,
          sortOrder,
        },
        select: { id: true },
      })
    ).id;
  const choice = { inStock: "c_in_stock", low: "c_low", ordered: "c_ordered" };
  const part = await field("Part", "TEXT", 0);
  const status = await field("Status", "SELECT", 1, {
    choices: [
      { id: choice.inStock, label: "In stock", color: "green" },
      { id: choice.low, label: "Low", color: "orange" },
      { id: choice.ordered, label: "Ordered", color: "blue" },
    ],
  });
  const quantity = await field("Quantity", "NUMBER", 2, { decimals: 0 });
  const where = await field("Location", "TEXT", 3);
  const holder = await field("Checked out by", "MEMBER", 4);
  const rows: [string, string, number, string, PersonKey | null][] = [
    ["Servo motor, 25 kg", choice.low, 2, "Bin A3", "sam"],
    ["Drivetrain gearbox", choice.inStock, 4, "Shelf 2", null],
    ["Battery pack, 12 V", choice.inStock, 6, "Charging cabinet", "jordan"],
    ["Rotary encoder", choice.ordered, 0, "", null],
    ["Aluminum extrusion, 1 m", choice.low, 3, "Rack B", null],
    ["Zip ties, pack of 100", choice.inStock, 12, "Bin C1", null],
  ];
  await tx.databaseRecord.createMany({
    data: rows.map(([name, state, count, place, who]) => ({
      organizationId: orgId,
      databaseId: inventory.id,
      values: {
        [part]: name,
        [status]: state,
        [quantity]: count,
        ...(place ? { [where]: place } : {}),
        ...(who ? { [holder]: ids[who] } : {}),
      },
      createdById: ids.sam,
      updatedById: ids.sam,
    })),
  });

  // ---- An open question poll the reviewer hasn't voted in
  const poll = await tx.poll.create({
    data: {
      organizationId: orgId,
      question: "Which night works for the next build session?",
      closesAt: at(5, 23),
      createdById: ids.maya,
    },
    select: { id: true },
  });
  const options: Record<string, string> = {};
  for (const [i, label] of ["Tuesday", "Wednesday", "Thursday"].entries()) {
    const option = await tx.pollOption.create({
      data: { organizationId: orgId, pollId: poll.id, label, sortOrder: i },
      select: { id: true },
    });
    options[label] = option.id;
  }
  await tx.pollVote.createMany({
    data: (
      [
        ["sam", "Wednesday"],
        ["priya", "Wednesday"],
        ["alex", "Thursday"],
      ] as const
    ).map(([who, label]) => ({
      organizationId: orgId,
      pollId: poll.id,
      optionId: options[label]!,
      userId: ids[who],
    })),
  });

  // ---- Finance: a budget, and two of the reviewer's own expense requests
  const period = await tx.budgetPeriod.create({
    data: {
      organizationId: orgId,
      label: "This season",
      startsOn: day(-30),
      endsOn: day(120),
      isActive: true,
    },
    select: { id: true },
  });
  const parts = await tx.budgetCategory.create({
    data: {
      organizationId: orgId,
      budgetPeriodId: period.id,
      name: "Parts",
      allocatedCents: 150000,
    },
    select: { id: true },
  });
  const expense = {
    organizationId: orgId,
    budgetPeriodId: period.id,
    direction: TransactionDirection.OUT,
    kind: TransactionKind.EXPENSE,
    submittedById: me.id,
  };
  await tx.transaction.create({
    data: {
      ...expense,
      categoryId: parts.id,
      amountCents: 4299,
      description: "Servo horns and screws",
      counterparty: "Robot parts supplier",
      occurredAt: at(-2, 12),
      status: TransactionStatus.SUBMITTED,
    },
  });
  await tx.transaction.create({
    data: {
      ...expense,
      amountCents: 2650,
      description: "Pizza for build night",
      counterparty: "Campus pizzeria",
      occurredAt: at(-9, 20),
      status: TransactionStatus.REIMBURSED,
      approvedById: ids.jordan,
      approvedAt: at(-7, 9),
      reimbursedAt: at(-5, 9),
      reimbursementMethod: "Venmo",
    },
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = process.env[args.targetEnv]?.trim();
  if (!raw) fail(`${args.targetEnv} is not set.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${args.targetEnv} is not a database URL.`);
  }
  const target = `${url.hostname}${url.pathname}`;

  const password = process.env.CONNECTORS_REVIEWER_PASSWORD?.trim() || null;
  if (password && password.length < PASSWORD_MIN) {
    fail(`CONNECTORS_REVIEWER_PASSWORD needs at least ${PASSWORD_MIN} characters.`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: raw }) });
  try {
    const reason = await productionReason(prisma, url);
    if (reason && !args.production) {
      fail(`Refusing ${target}: ${reason}. Pass --production if this is meant.`);
    }

    // An existing account must be the one an earlier run made.
    const existing = await prisma.user.findUnique({
      where: { email: args.email },
      select: { id: true, credential: { select: { userId: true } } },
    });
    if (existing) {
      const ours = await prisma.membership.findFirst({
        where: { userId: existing.id, role: Role.OWNER, organization: { slug: ORG.slug } },
        select: { id: true },
      });
      if (!ours) {
        fail(
          `${args.email} already has an account that this script didn't make. Use another address.`,
        );
      }
    }
    // The reviewer organization's slug must be free, or the reviewer's own.
    const holder = await prisma.organization.findUnique({
      where: { slug: ORG.slug },
      select: { memberships: { where: { role: Role.OWNER }, select: { userId: true } } },
    });
    if (holder && !holder.memberships.some((m) => m.userId === existing?.id)) {
      fail(
        `/app/${ORG.slug} is held by an organization ${args.email} doesn't own: a real one, or an earlier run's for another --email. Nothing was changed.`,
      );
    }

    // Only a new account gets a generated password; a re-run keeps the old one.
    const generated =
      !password && !existing?.credential ? randomBytes(15).toString("base64url") : null;
    const chosen = password ?? generated;
    const passwordHash = chosen ? await hashPassword(chosen) : null;

    console.log(`Writing the reviewer account to ${target}${reason ? " (production)" : ""}.`);
    await prisma.$transaction((tx) => seed(tx, args, passwordHash), { timeout: 60_000 });

    console.log(`Done: ${args.email} owns ${ORG.name} (/app/${ORG.slug}).`);
    if (generated) {
      console.log(`Password (shown once; keep it in the password manager): ${generated}`);
    } else if (!password) {
      console.log("The account's password is unchanged.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
