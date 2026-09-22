import { faker } from "@faker-js/faker";
import { generateNKeysBetween } from "fractional-indexing";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";
import {
  applyCbcTemplate,
  CBC_ORG,
  CBC_PEOPLE,
  seedCbcDemoData,
  type CbcPersonKey,
} from "../src/server/bootstrap/cbc-template";
import {
  ConferenceProvider,
  OrgChartSource,
  NoteVisibility,
  PollAvailability,
  PrismaClient,
  Role,
  RSVPStatus,
  SponsorshipStatus,
  TaskPriority,
  TaskStatus,
  TransactionDirection,
  TransactionKind,
  TransactionStatus,
} from "../src/generated/prisma/client";

/**
 * Local, preview and CI data. Never production: production data comes from
 * real sign-ups and the OWNER-only 'Bootstrap CBC workspace' action.
 *
 * - Two fixture orgs (Robotics Club, Debate Society) with tasks, notes,
 *   events, a poll and finance data, as before.
 * - The Claude Builders Club (claude-builders-club): the 8 board members,
 *   the published org chart, sessions, synthetic contacts with attendance,
 *   signups and ballots, tasks, Sunday updates and a budget, all through
 *   src/server/bootstrap/cbc-template.ts.
 *
 * Every seeded user signs in with the password `password123`.
 *
 * Runs as the migration owner (MIGRATE_DATABASE_URL, else DATABASE_URL),
 * which owns the tables, so RLS does not apply; the same-org and
 * member-of-org triggers still do. Re-runnable: the three orgs are deleted
 * and recreated, users are upserted by email.
 */
if (process.env.VERCEL_ENV === "production") {
  console.error(
    "Refusing to seed: VERCEL_ENV=production. The seed never runs against production data.",
  );
  process.exit(1);
}

const ownerUrl = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error("Set MIGRATE_DATABASE_URL (or DATABASE_URL) to the migration owner's URL.");
  process.exit(1);
}
const adapter = new PrismaPg({ connectionString: ownerUrl });
const prisma = new PrismaClient({ adapter });

faker.seed(20260913);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY_MS);

const LABEL_PALETTE = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b"];

async function main() {
  // --- Users (upserted by email so re-runs don't create duplicates) ---
  const userSeeds = [
    { email: "alice@example.edu", name: "Alice Nguyen", timezone: "America/New_York" },
    { email: "bob@example.edu", name: "Bob Martinez", timezone: "America/New_York" },
    { email: "carol@example.edu", name: "Carol Okafor", timezone: "America/Chicago" },
    { email: "dave@example.edu", name: "Dave Chen", timezone: "America/New_York" },
    { email: "eve@example.edu", name: "Eve Petrov", timezone: "America/Los_Angeles" },
    { email: "frank@example.edu", name: "Frank Silva", timezone: "America/New_York" },
    { email: "grace@example.edu", name: "Grace Kim", timezone: "America/Denver" },
  ] as const;

  // Every seeded user can also sign in with this password locally — there's
  // no real Google account behind these fixture emails.
  const SEED_PASSWORD_HASH = await hashPassword("password123");

  async function upsertUser(data: {
    email: string;
    name: string;
    timezone?: string | null;
    major?: string;
    gradYear?: number;
  }) {
    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: {
        name: data.name,
        timezone: data.timezone ?? null,
        major: data.major,
        gradYear: data.gradYear,
      },
      create: {
        email: data.email,
        name: data.name,
        emailVerified: new Date(),
        timezone: data.timezone ?? null,
        major: data.major,
        gradYear: data.gradYear,
      },
    });
    // The password hash lives in UserCredential (readable by app_auth only).
    await prisma.userCredential.upsert({
      where: { userId: user.id },
      update: { passwordHash: SEED_PASSWORD_HASH },
      create: { userId: user.id, passwordHash: SEED_PASSWORD_HASH },
    });
    return user;
  }

  const users: Record<string, Awaited<ReturnType<typeof upsertUser>>> = {};
  for (const u of userSeeds) {
    users[u.email] = await upsertUser(u);
  }
  const [alice, bob, carol, dave, eve, frank, grace] = userSeeds.map((u) => users[u.email]);

  // --- Organizations (wipe and recreate — cascades remove all org-scoped data) ---
  const ORG_SLUGS = ["robotics-club", "debate-society", CBC_ORG.slug];
  await prisma.organization.deleteMany({ where: { slug: { in: ORG_SLUGS } } });

  const orgA = await prisma.organization.create({
    data: { name: "Robotics Club", slug: "robotics-club" },
  });
  const orgB = await prisma.organization.create({
    data: { name: "Debate Society", slug: "debate-society" },
  });

  // --- Memberships ---
  // Dave is the one user who belongs to both orgs (Member in A, Admin in B).
  // Carol and Frank are the one-treasurer-per-org.
  await prisma.membership.createMany({
    data: [
      { userId: alice.id, organizationId: orgA.id, role: Role.OWNER },
      { userId: bob.id, organizationId: orgA.id, role: Role.ADMIN },
      { userId: carol.id, organizationId: orgA.id, role: Role.TREASURER },
      { userId: dave.id, organizationId: orgA.id, role: Role.MEMBER },
      { userId: eve.id, organizationId: orgB.id, role: Role.OWNER },
      { userId: dave.id, organizationId: orgB.id, role: Role.ADMIN },
      { userId: frank.id, organizationId: orgB.id, role: Role.TREASURER },
      { userId: grace.id, organizationId: orgB.id, role: Role.MEMBER },
    ],
  });

  const orgAMembers = [alice, bob, carol, dave];
  const orgBMembers = [eve, dave, frank, grace];

  // --- Projects ---
  const [showcase, clubOps] = await Promise.all([
    prisma.project.create({ data: { organizationId: orgA.id, name: "Fall Showcase Robot" } }),
    prisma.project.create({ data: { organizationId: orgA.id, name: "Club Operations" } }),
  ]);
  const [tournament, recruitment] = await Promise.all([
    prisma.project.create({ data: { organizationId: orgB.id, name: "Regional Tournament" } }),
    prisma.project.create({ data: { organizationId: orgB.id, name: "Recruitment Drive" } }),
  ]);

  // --- Labels ---
  const orgALabelNames = ["Urgent", "Build", "Software", "Outreach"];
  const orgBLabelNames = ["Urgent", "Research", "Logistics", "Fundraising"];
  const orgALabels = await Promise.all(
    orgALabelNames.map((name, i) =>
      prisma.label.create({
        data: { organizationId: orgA.id, name, color: LABEL_PALETTE[i % LABEL_PALETTE.length] },
      }),
    ),
  );
  const orgBLabels = await Promise.all(
    orgBLabelNames.map((name, i) =>
      prisma.label.create({
        data: { organizationId: orgB.id, name, color: LABEL_PALETTE[i % LABEL_PALETTE.length] },
      }),
    ),
  );

  // --- Tasks ---
  async function seedTasks(
    organizationId: string,
    projects: { id: string }[],
    members: { id: string }[],
    labels: { id: string }[],
    topLevelCount: number,
    subtaskCount: number,
  ) {
    const statuses = [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED];
    const priorities = [TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH];

    // Assign each top-level task a status up front so we can generate one
    // fractional rank sequence per kanban column.
    const assignedStatuses = Array.from(
      { length: topLevelCount },
      (_, i) => statuses[i % statuses.length],
    );
    const ranksByStatus: Record<string, string[]> = {};
    for (const status of statuses) {
      const count = assignedStatuses.filter((s) => s === status).length;
      ranksByStatus[status] = generateNKeysBetween(null, null, count);
    }
    const rankCursor: Record<string, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 };

    const created: { id: string }[] = [];
    for (let i = 0; i < topLevelCount; i++) {
      const status = assignedStatuses[i];
      const rank = ranksByStatus[status][rankCursor[status]++];
      const isOverdue =
        status !== TaskStatus.COMPLETED && faker.datatype.boolean({ probability: 0.3 });
      const dueDate = faker.datatype.boolean({ probability: 0.75 })
        ? isOverdue
          ? daysFromNow(-faker.number.int({ min: 1, max: 14 }))
          : daysFromNow(faker.number.int({ min: 1, max: 45 }))
        : null;
      const assignees = faker.helpers.arrayElements(members, { min: 0, max: 2 });
      const taskLabels = faker.helpers.arrayElements(labels, { min: 0, max: 2 });

      const task = await prisma.task.create({
        data: {
          organizationId,
          projectId: faker.helpers.arrayElement(projects).id,
          title: faker.hacker.phrase().replace(/^./, (c) => c.toUpperCase()),
          description: faker.datatype.boolean() ? faker.lorem.sentences(2) : null,
          status,
          priority: faker.helpers.arrayElement(priorities),
          dueDate,
          rank,
          createdById: faker.helpers.arrayElement(members).id,
          ownerId: assignees[0]?.id ?? null,
          completedAt:
            status === TaskStatus.COMPLETED
              ? daysFromNow(-faker.number.int({ min: 1, max: 10 }))
              : null,
          assignees: { create: assignees.map((m) => ({ userId: m.id })) },
          labels: { create: taskLabels.map((l) => ({ labelId: l.id })) },
        },
      });
      created.push(task);
    }

    for (let i = 0; i < subtaskCount; i++) {
      const parent = faker.helpers.arrayElement(created);
      await prisma.task.create({
        data: {
          organizationId,
          projectId: (await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).projectId,
          title: faker.hacker.phrase().replace(/^./, (c) => c.toUpperCase()),
          status: faker.helpers.arrayElement(statuses),
          priority: faker.helpers.arrayElement(priorities),
          rank: generateNKeysBetween(null, null, 1)[0],
          parentTaskId: parent.id,
          createdById: faker.helpers.arrayElement(members).id,
        },
      });
    }
  }

  await seedTasks(orgA.id, [showcase, clubOps], orgAMembers, orgALabels, 14, 3);
  await seedTasks(orgB.id, [tournament, recruitment], orgBMembers, orgBLabels, 6, 2);

  // --- Notes ---
  async function makeNote(
    organizationId: string,
    author: { id: string },
    updatedBy: { id: string },
    title: string,
    visibility: NoteVisibility,
    eventId?: string,
  ) {
    const body = faker.lorem.paragraphs(3, "\n\n");
    return prisma.note.create({
      data: {
        organizationId,
        title,
        contentJson: {
          type: "doc",
          content: body
            .split("\n\n")
            .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
        },
        contentText: body,
        visibility,
        authorId: author.id,
        updatedById: updatedBy.id,
        eventId,
      },
    });
  }

  await makeNote(
    orgA.id,
    alice,
    alice,
    "E-board onboarding checklist",
    NoteVisibility.ORGANIZATION,
  );
  await makeNote(orgA.id, bob, bob, "Showcase robot build log", NoteVisibility.ORGANIZATION);
  await makeNote(orgA.id, carol, carol, "Reimbursement notes to self", NoteVisibility.PRIVATE);
  await makeNote(orgA.id, dave, dave, "Ideas for next semester", NoteVisibility.PRIVATE);
  await makeNote(orgA.id, bob, alice, "Sponsor outreach script", NoteVisibility.ORGANIZATION);
  await makeNote(orgB.id, eve, eve, "Tournament judging rubric", NoteVisibility.ORGANIZATION);
  await makeNote(orgB.id, grace, grace, "Personal debate prep", NoteVisibility.PRIVATE);
  await makeNote(orgB.id, frank, frank, "Recruitment budget thoughts", NoteVisibility.ORGANIZATION);

  // --- Events ---
  async function makeEvent(
    organizationId: string,
    createdBy: { id: string },
    title: string,
    startsAt: Date,
    durationMinutes: number,
    attendees: { id: string }[],
    conferenceProvider: ConferenceProvider = ConferenceProvider.NONE,
    conferenceUrl?: string,
  ) {
    return prisma.event.create({
      data: {
        organizationId,
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + durationMinutes * 60 * 1000),
        location:
          conferenceProvider === ConferenceProvider.NONE ? "Club room, Curry Student Center" : null,
        conferenceProvider,
        conferenceUrl,
        createdById: createdBy.id,
        attendees: {
          create: attendees.map((a) => ({
            userId: a.id,
            rsvp: faker.helpers.arrayElement([
              RSVPStatus.YES,
              RSVPStatus.NO,
              RSVPStatus.MAYBE,
              RSVPStatus.PENDING,
            ]),
          })),
        },
      },
    });
  }

  const weeklySync = await makeEvent(
    orgA.id,
    alice,
    "Weekly e-board sync",
    daysFromNow(3),
    60,
    orgAMembers,
    ConferenceProvider.MEET,
    "https://meet.google.com/abc-defg-hij",
  );
  await makeEvent(orgA.id, bob, "Showcase build night", daysFromNow(7), 120, [bob, dave]);
  await makeEvent(
    orgA.id,
    alice,
    "Past sponsor meeting",
    daysFromNow(-10),
    45,
    [alice, bob],
    ConferenceProvider.ZOOM,
    "https://zoom.us/j/1234567890",
  );
  await makeEvent(orgA.id, carol, "Budget review", daysFromNow(14), 30, [alice, carol]);
  await makeEvent(orgB.id, eve, "Tournament prep", daysFromNow(5), 90, orgBMembers);
  await makeEvent(orgB.id, frank, "Past recruitment info session", daysFromNow(-5), 60, [
    eve,
    grace,
  ]);

  await prisma.note.updateMany({
    where: { organizationId: orgA.id, title: "E-board onboarding checklist" },
    data: { eventId: weeklySync.id },
  });

  // --- Availability poll (open, partial responses) ---
  const poll = await prisma.availabilityPoll.create({
    data: {
      organizationId: orgA.id,
      title: "Next general meeting — when works?",
      description:
        "Pick everything you could make so we can find a time that fits the most people.",
      timezone: "America/New_York",
      durationMinutes: 60,
      closesAt: daysFromNow(5),
      createdById: alice.id,
    },
  });
  const slotStarts = [10, 11, 12].flatMap((dayOffset) =>
    [16, 17, 18].map((hour) => {
      const d = daysFromNow(dayOffset);
      d.setHours(hour, 0, 0, 0);
      return d;
    }),
  );
  const slots = await Promise.all(
    slotStarts.map((startsAt) =>
      prisma.pollSlot.create({
        data: {
          organizationId: orgA.id,
          pollId: poll.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        },
      }),
    ),
  );
  // Alice, Bob, and Carol have responded; Dave has not (partial responses).
  for (const responder of [alice, bob, carol]) {
    const respondedSlots = faker.helpers.arrayElements(slots, { min: 3, max: slots.length });
    for (const slot of respondedSlots) {
      await prisma.pollResponse.create({
        data: {
          organizationId: orgA.id,
          pollId: poll.id,
          slotId: slot.id,
          userId: responder.id,
          availability: faker.helpers.arrayElement([
            PollAvailability.YES,
            PollAvailability.YES,
            PollAvailability.IF_NEEDED,
            PollAvailability.NO,
          ]),
        },
      });
    }
  }

  // --- Finance: Org A (full example) ---
  const orgAPeriod = await prisma.budgetPeriod.create({
    data: {
      organizationId: orgA.id,
      label: "FY 2026–27",
      startsOn: new Date("2026-06-01"),
      endsOn: new Date("2027-05-31"),
      isActive: true,
    },
  });
  const categoryDefs: { name: string; allocatedCents: number }[] = [
    { name: "Food", allocatedCents: 200_000 },
    { name: "Materials", allocatedCents: 300_000 },
    { name: "Travel", allocatedCents: 150_000 },
    { name: "Marketing", allocatedCents: 80_000 },
    { name: "Speaker Fees", allocatedCents: 120_000 },
  ];
  const orgACategories = await Promise.all(
    categoryDefs.map((c, i) =>
      prisma.budgetCategory.create({
        data: { organizationId: orgA.id, budgetPeriodId: orgAPeriod.id, sortOrder: i, ...c },
      }),
    ),
  );

  const expenseStatuses = [
    TransactionStatus.DRAFT,
    TransactionStatus.SUBMITTED,
    TransactionStatus.APPROVED,
    TransactionStatus.REIMBURSED,
    TransactionStatus.REJECTED,
    TransactionStatus.NOT_APPLICABLE,
  ];
  const reimbursementMethods = ["Venmo (manual)", "Check #1042", "SGA reimbursement form"];

  for (let i = 0; i < 24; i++) {
    const status = expenseStatuses[i % expenseStatuses.length];
    const submittedBy = faker.helpers.arrayElement(orgAMembers);
    const approverPool = orgAMembers.filter(
      (m) => m.id !== submittedBy.id && [alice.id, carol.id].includes(m.id),
    );
    const approvedBy =
      status === TransactionStatus.DRAFT || status === TransactionStatus.SUBMITTED
        ? null
        : faker.helpers.arrayElement(approverPool.length ? approverPool : [alice]);
    const reconciled =
      status === TransactionStatus.REIMBURSED || status === TransactionStatus.NOT_APPLICABLE
        ? faker.datatype.boolean({ probability: 0.5 })
        : false;

    await prisma.transaction.create({
      data: {
        organizationId: orgA.id,
        budgetPeriodId: orgAPeriod.id,
        categoryId: faker.helpers.arrayElement(orgACategories).id,
        direction: TransactionDirection.OUT,
        kind: TransactionKind.EXPENSE,
        amountCents: faker.number.int({ min: 1500, max: 45000 }),
        description: faker.commerce.productName() + " for club use",
        counterparty: faker.company.name(),
        occurredAt: daysFromNow(-faker.number.int({ min: 1, max: 90 })),
        paymentMethod: faker.helpers.arrayElement(["Personal card, reimbursed", "Club card"]),
        status,
        submittedById: submittedBy.id,
        approvedById: approvedBy?.id ?? null,
        approvedAt: approvedBy ? daysFromNow(-faker.number.int({ min: 1, max: 60 })) : null,
        reimbursedAt:
          status === TransactionStatus.REIMBURSED
            ? daysFromNow(-faker.number.int({ min: 1, max: 30 }))
            : null,
        reimbursementMethod:
          status === TransactionStatus.REIMBURSED
            ? faker.helpers.arrayElement(reimbursementMethods)
            : null,
        rejectionReason: status === TransactionStatus.REJECTED ? "Missing itemized receipt" : null,
        reconciledAt: reconciled ? daysFromNow(-faker.number.int({ min: 1, max: 20 })) : null,
        reconciledById: reconciled ? carol.id : null,
        statementRef: reconciled ? `STMT-2026-${faker.number.int({ min: 1, max: 12 })}` : null,
      },
    });
  }

  await prisma.transaction.create({
    data: {
      organizationId: orgA.id,
      budgetPeriodId: orgAPeriod.id,
      direction: TransactionDirection.IN,
      kind: TransactionKind.ALLOCATION,
      amountCents: 850_000,
      description: "SGA annual funding award",
      occurredAt: new Date("2026-06-05"),
      status: TransactionStatus.NOT_APPLICABLE,
      submittedById: alice.id,
    },
  });
  await prisma.transaction.create({
    data: {
      organizationId: orgA.id,
      budgetPeriodId: orgAPeriod.id,
      direction: TransactionDirection.IN,
      kind: TransactionKind.ALLOCATION,
      amountCents: 50_000,
      description: "Carryover from prior period",
      occurredAt: new Date("2026-06-05"),
      status: TransactionStatus.NOT_APPLICABLE,
      submittedById: alice.id,
    },
  });
  for (const desc of ["Bake sale proceeds", "Merch table sales", "Alumni donation"]) {
    await prisma.transaction.create({
      data: {
        organizationId: orgA.id,
        budgetPeriodId: orgAPeriod.id,
        direction: TransactionDirection.IN,
        kind: TransactionKind.OTHER_INCOME,
        amountCents: faker.number.int({ min: 5000, max: 40000 }),
        description: desc,
        occurredAt: daysFromNow(-faker.number.int({ min: 5, max: 60 })),
        status: TransactionStatus.NOT_APPLICABLE,
        submittedById: carol.id,
      },
    });
  }

  // --- Sponsorships (three lifecycle stages) ---
  const acme = await prisma.sponsor.create({
    data: {
      organizationId: orgA.id,
      name: "Acme Robotics Supply",
      contactName: "Jordan Lee",
      contactEmail: "jordan@acmerobotics.example",
    },
  });
  const techcorp = await prisma.sponsor.create({
    data: {
      organizationId: orgA.id,
      name: "TechCorp",
      contactName: "Sam Patel",
      contactEmail: "sam@techcorp.example",
    },
  });
  const localEatery = await prisma.sponsor.create({
    data: {
      organizationId: orgA.id,
      name: "Local Eatery",
      contactName: "Robin Ortiz",
      contactEmail: "robin@localeatery.example",
    },
  });

  const receivedTxn = await prisma.transaction.create({
    data: {
      organizationId: orgA.id,
      budgetPeriodId: orgAPeriod.id,
      direction: TransactionDirection.IN,
      kind: TransactionKind.SPONSORSHIP,
      amountCents: 250_000,
      description: "TechCorp sponsorship payment",
      counterparty: "TechCorp",
      occurredAt: daysFromNow(-20),
      status: TransactionStatus.NOT_APPLICABLE,
      submittedById: carol.id,
    },
  });

  await prisma.sponsorship.create({
    data: {
      organizationId: orgA.id,
      sponsorId: acme.id,
      budgetPeriodId: orgAPeriod.id,
      amountCents: 100_000,
      tier: "Silver",
      deliverables: "Logo on robot chassis and Instagram shoutout",
      expectedOn: daysFromNow(30),
      status: SponsorshipStatus.COMMITTED,
      ownerId: bob.id,
    },
  });
  await prisma.sponsorship.create({
    data: {
      organizationId: orgA.id,
      sponsorId: techcorp.id,
      budgetPeriodId: orgAPeriod.id,
      amountCents: 250_000,
      tier: "Gold",
      deliverables: "Logo on banner, booth at showcase, 2 recruiting slots",
      expectedOn: daysFromNow(-20),
      status: SponsorshipStatus.RECEIVED,
      transactionId: receivedTxn.id,
      ownerId: alice.id,
    },
  });
  await prisma.sponsorship.create({
    data: {
      organizationId: orgA.id,
      sponsorId: localEatery.id,
      budgetPeriodId: orgAPeriod.id,
      amountCents: 50_000,
      tier: "Bronze",
      deliverables: "Catering discount for members",
      status: SponsorshipStatus.PROSPECT,
      ownerId: bob.id,
    },
  });

  // --- Finance audit log (fixture rows for the audit trail view) ---
  const auditableTxns = await prisma.transaction.findMany({
    where: {
      organizationId: orgA.id,
      status: {
        in: [TransactionStatus.APPROVED, TransactionStatus.REIMBURSED, TransactionStatus.REJECTED],
      },
    },
    take: 10,
  });
  for (const txn of auditableTxns) {
    await prisma.financeAuditLog.create({
      data: {
        organizationId: orgA.id,
        actorId: txn.approvedById ?? carol.id,
        transactionId: txn.id,
        action: `transaction.${txn.status.toLowerCase()}`,
        diffJson: { status: { to: txn.status } },
      },
    });
  }

  // --- Finance: Org B (lighter, still non-trivial) ---
  const orgBPeriod = await prisma.budgetPeriod.create({
    data: {
      organizationId: orgB.id,
      label: "FY 2026–27",
      startsOn: new Date("2026-06-01"),
      endsOn: new Date("2027-05-31"),
      isActive: true,
    },
  });
  const orgBCategories = await Promise.all(
    categoryDefs.map((c, i) =>
      prisma.budgetCategory.create({
        data: {
          organizationId: orgB.id,
          budgetPeriodId: orgBPeriod.id,
          sortOrder: i,
          ...c,
          allocatedCents: Math.round(c.allocatedCents * 0.4),
        },
      }),
    ),
  );
  await prisma.transaction.create({
    data: {
      organizationId: orgB.id,
      budgetPeriodId: orgBPeriod.id,
      direction: TransactionDirection.IN,
      kind: TransactionKind.ALLOCATION,
      amountCents: 300_000,
      description: "SGA annual funding award",
      occurredAt: new Date("2026-06-05"),
      status: TransactionStatus.NOT_APPLICABLE,
      submittedById: eve.id,
    },
  });
  for (const status of [
    TransactionStatus.SUBMITTED,
    TransactionStatus.APPROVED,
    TransactionStatus.REIMBURSED,
    TransactionStatus.NOT_APPLICABLE,
    TransactionStatus.DRAFT,
    TransactionStatus.REJECTED,
  ]) {
    const submittedBy = faker.helpers.arrayElement(orgBMembers);
    const approvedBy =
      status === TransactionStatus.DRAFT || status === TransactionStatus.SUBMITTED ? null : frank;
    await prisma.transaction.create({
      data: {
        organizationId: orgB.id,
        budgetPeriodId: orgBPeriod.id,
        categoryId: faker.helpers.arrayElement(orgBCategories).id,
        direction: TransactionDirection.OUT,
        kind: TransactionKind.EXPENSE,
        amountCents: faker.number.int({ min: 1000, max: 20000 }),
        description: faker.commerce.productName() + " for tournament",
        counterparty: faker.company.name(),
        occurredAt: daysFromNow(-faker.number.int({ min: 1, max: 60 })),
        status,
        submittedById: submittedBy.id === approvedBy?.id ? eve.id : submittedBy.id,
        approvedById: approvedBy?.id ?? null,
        approvedAt: approvedBy ? daysFromNow(-faker.number.int({ min: 1, max: 40 })) : null,
        reimbursedAt: status === TransactionStatus.REIMBURSED ? daysFromNow(-10) : null,
        reimbursementMethod: status === TransactionStatus.REIMBURSED ? "Check #221" : null,
        rejectionReason: status === TransactionStatus.REJECTED ? "Receipt illegible" : null,
      },
    });
  }

  // --- Claude Builders Club ---
  const cbcUsers = {} as Record<CbcPersonKey, string>;
  for (const person of CBC_PEOPLE) {
    const user = await upsertUser({
      email: person.email,
      name: person.name,
      major: person.major,
      gradYear: person.gradYear,
    });
    cbcUsers[person.key] = user.id;
  }
  const cbc = await prisma.organization.create({
    data: { name: CBC_ORG.name, slug: CBC_ORG.slug, timezone: CBC_ORG.timezone },
  });
  await prisma.membership.createMany({
    data: CBC_PEOPLE.map((p) => ({
      userId: cbcUsers[p.key],
      organizationId: cbc.id,
      role: p.role,
      joinedAt: daysFromNow(-40),
    })),
  });
  // CBC existed before per-org senders, so its mail stays on the platform
  // sender (Phase 1 backfill); the seeded org also publishes its public feed.
  await prisma.orgSettings.update({
    where: { organizationId: cbc.id },
    data: { platformMailFallback: true, publicEventsEnabled: true },
  });
  const template = await applyCbcTemplate(prisma, {
    organizationId: cbc.id,
    actorId: cbcUsers.jackson,
    members: cbcUsers,
    source: OrgChartSource.SEED,
  });
  const demo = await seedCbcDemoData(prisma, {
    organizationId: cbc.id,
    members: cbcUsers,
    intakeProjectId: template.intakeProjectId,
    labelIds: template.labelIds,
  });

  console.log("Seed complete:", {
    users: userSeeds.length + CBC_PEOPLE.length,
    organizations: ORG_SLUGS,
    orgATasks: 17,
    orgBTasks: 8,
    claudeBuildersClub: demo,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
