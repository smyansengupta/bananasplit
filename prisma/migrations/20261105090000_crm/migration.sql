-- CRM add-on (docs/features/crm.md): people, companies and pipelines an
-- organization reaches out to, their timeline, outreach (templates,
-- sequences, campaigns, booking pages), automation, goals and forecasts,
-- the review queue, quotes, calls and texts, the public API and AI usage.
-- People, companies and each pipeline are also databases (DatabaseKind
-- CRM_*); a new field type RELATION links any database to them, and AI
-- fills a field per row. Forms can send responses to the CRM.

-- CreateEnum
CREATE TYPE "CrmRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ALUMNI');

-- CreateEnum
CREATE TYPE "CrmStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmForecastCategory" AS ENUM ('PIPELINE', 'BEST_CASE', 'COMMIT', 'OMITTED');

-- CreateEnum
CREATE TYPE "CrmActivityKind" AS ENUM ('EMAIL', 'MEETING', 'CALL', 'TEXT', 'NOTE', 'TASK', 'FORM_RESPONSE', 'RSVP', 'CHECK_IN', 'PAYMENT', 'STAGE_CHANGE', 'FIELD_CHANGE', 'SEQUENCE_STEP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CrmDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CrmEmailStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'SENT', 'FAILED', 'BOUNCED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "CrmMailbox" AS ENUM ('ORG_SENDER', 'GMAIL', 'OUTLOOK', 'IMAP', 'BCC', 'REPLY');

-- CreateEnum
CREATE TYPE "CrmShareMode" AS ENUM ('NONE', 'METADATA', 'FULL');

-- CreateEnum
CREATE TYPE "CrmSequenceStatus" AS ENUM ('DRAFT', 'ON', 'OFF');

-- CreateEnum
CREATE TYPE "CrmStepKind" AS ENUM ('EMAIL', 'TASK', 'CALL', 'TEXT', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "CrmEnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REPLIED', 'BOOKED', 'FINISHED', 'STOPPED', 'BOUNCED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "CrmCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DONE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmTargetStatus" AS ENUM ('TODO', 'CONTACTED', 'REPLIED', 'BOOKED', 'CONVERTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CrmWorkflowStatus" AS ENUM ('DRAFT', 'ON', 'OFF');

-- CreateEnum
CREATE TYPE "CrmRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CrmSuggestionKind" AS ENUM ('CREATE_PERSON', 'CREATE_COMPANY', 'UPDATE_FIELD', 'MOVE_STAGE', 'LOG_ACTIVITY', 'DRAFT_EMAIL', 'CREATE_TASK', 'MERGE');

-- CreateEnum
CREATE TYPE "CrmSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CrmSuggestionSource" AS ENUM ('AI', 'AUTOMATION', 'CONNECTOR', 'EMAIL', 'IMPORT', 'DEDUPE', 'SIGNAL');

-- CreateEnum
CREATE TYPE "CrmQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'PAID');

-- CreateEnum
CREATE TYPE "CrmCallStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'LOGGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DatabaseFieldType" ADD VALUE 'RELATION';
ALTER TYPE "DatabaseFieldType" ADD VALUE 'AI';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DatabaseKind" ADD VALUE 'CRM_PEOPLE';
ALTER TYPE "DatabaseKind" ADD VALUE 'CRM_COMPANIES';
ALTER TYPE "DatabaseKind" ADD VALUE 'CRM_PIPELINE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationProvider" ADD VALUE 'TAVILY';
ALTER TYPE "IntegrationProvider" ADD VALUE 'HUNTER';
ALTER TYPE "IntegrationProvider" ADD VALUE 'PROSPEO';
ALTER TYPE "IntegrationProvider" ADD VALUE 'TELNYX';
ALTER TYPE "IntegrationProvider" ADD VALUE 'TWILIO';
ALTER TYPE "IntegrationProvider" ADD VALUE 'DEEPGRAM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CRM_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_FOLLOW_UP';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_REPLY';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_HANDOVER';

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "crmDestination" JSONB;

-- CreateTable
CREATE TABLE "CrmSettings" (
    "organizationId" TEXT NOT NULL,
    "memberAccess" TEXT NOT NULL DEFAULT 'ALL',
    "managerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationshipTypes" JSONB NOT NULL DEFAULT '[]',
    "setupKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "setupDoneAt" TIMESTAMP(3),
    "aiMonthlyCapCents" INTEGER,
    "enrichmentOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailySendCap" INTEGER NOT NULL DEFAULT 150,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "CrmMemberSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bccToken" TEXT NOT NULL,
    "shareMode" "CrmShareMode" NOT NULL DEFAULT 'FULL',
    "neverLog" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMemberSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCompany" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "description" TEXT,
    "status" "CrmRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "ownerRoleKey" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "strength" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "enrichment" JSONB NOT NULL DEFAULT '{}',
    "sponsorId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "companyId" TEXT,
    "linkedinUrl" TEXT,
    "website" TEXT,
    "location" TEXT,
    "avatarUrl" TEXT,
    "relationship" TEXT,
    "status" "CrmRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "ownerRoleKey" TEXT,
    "source" TEXT,
    "sourceDetail" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "keepInTouchDays" INTEGER,
    "strength" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "unsubscribedAt" TIMESTAMP(3),
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "consent" JSONB NOT NULL DEFAULT '{}',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "enrichment" JSONB NOT NULL DEFAULT '{}',
    "contactId" TEXT,
    "userId" TEXT,
    "selfUpdateTokenHash" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPersonEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPersonEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "companyId" TEXT,
    "companyName" TEXT,
    "title" TEXT,
    "startedOn" TIMESTAMP(3),
    "endedOn" TIMESTAMP(3),
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPipeline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemNoun" TEXT NOT NULL DEFAULT 'item',
    "itemNounPlural" TEXT NOT NULL DEFAULT 'items',
    "template" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "hasAmount" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "wonLabel" TEXT NOT NULL DEFAULT 'Won',
    "lostLabel" TEXT NOT NULL DEFAULT 'Lost',
    "ownerId" TEXT,
    "ownerRoleKey" TEXT,
    "databaseId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmStageKind" NOT NULL DEFAULT 'OPEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "probability" INTEGER,
    "stuckAfterDays" INTEGER,
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDeal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expectedOn" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "forecastCategory" "CrmForecastCategory" NOT NULL DEFAULT 'PIPELINE',
    "ownerId" TEXT,
    "ownerRoleKey" TEXT,
    "companyId" TEXT,
    "primaryPersonId" TEXT,
    "nextStep" TEXT,
    "nextStepAt" TIMESTAMP(3),
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "sponsorshipId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDealPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmDealPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "CrmActivityKind" NOT NULL,
    "direction" "CrmDirection",
    "subject" TEXT,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "sourceKind" TEXT,
    "sourceId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "privateToId" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivityTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmActivityTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmailThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subject" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmEmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmailMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "activityId" TEXT,
    "direction" "CrmDirection" NOT NULL,
    "status" "CrmEmailStatus" NOT NULL,
    "mailbox" "CrmMailbox" NOT NULL,
    "mailboxUserId" TEXT,
    "messageIdHeader" TEXT,
    "inReplyTo" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "providerMessageId" TEXT,
    "trackingToken" TEXT,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstOpenedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "error" TEXT,
    "templateId" TEXT,
    "enrollmentId" TEXT,
    "campaignId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmEmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "category" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CrmSequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnBooking" BOOLEAN NOT NULL DEFAULT true,
    "sendWindow" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSequenceStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "CrmStepKind" NOT NULL DEFAULT 'EMAIL',
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "taskTitle" TEXT,

    CONSTRAINT "CrmSequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "enrolledById" TEXT,
    "status" "CrmEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextStep" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrmEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "objectKind" TEXT NOT NULL,
    "pipelineId" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '[]',
    "sort" JSONB NOT NULL DEFAULT '[]',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "layout" TEXT NOT NULL DEFAULT 'table',
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "goalCount" INTEGER,
    "dueOn" TIMESTAMP(3),
    "viewId" TEXT,
    "templateId" TEXT,
    "sequenceId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "eventId" TEXT,
    "status" "CrmCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCampaignTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "status" "CrmTargetStatus" NOT NULL DEFAULT 'TODO',
    "contactedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCampaignTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWorkflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CrmWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger" JSONB NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "recipe" TEXT,
    "described" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWorkflowRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "CrmRunStatus" NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "triggerRef" JSONB NOT NULL DEFAULT '{}',
    "log" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrmWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmFieldHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "batchId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmFieldHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "pipelineId" TEXT,
    "ownerId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "target" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmForecastSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmScoreRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "objectKind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmScoreRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmQuote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT,
    "companyId" TEXT,
    "personId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CrmQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "validUntil" TIMESTAMP(3),
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "publicTokenHash" TEXT,
    "acceptedName" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmQuoteLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrmQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBookingPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "bufferMin" INTEGER NOT NULL DEFAULT 0,
    "hostIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "questions" JSONB NOT NULL DEFAULT '[]',
    "pipelineId" TEXT,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 4,
    "maxDaysAhead" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmBookingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "CrmSuggestionKind" NOT NULL,
    "status" "CrmSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "source" "CrmSuggestionSource" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "targetKind" TEXT,
    "targetId" TEXT,
    "citation" JSONB NOT NULL DEFAULT '{}',
    "assigneeId" TEXT,
    "proposedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDeliverable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "taskId" TEXT,
    "proof" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmGuestLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmGuestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "direction" "CrmDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "CrmCallStatus" NOT NULL DEFAULT 'LOGGED',
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerCallId" TEXT,
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSec" INTEGER,
    "outcome" TEXT,
    "notes" TEXT,
    "recordingConsent" BOOLEAN NOT NULL DEFAULT false,
    "recordingKey" TEXT,
    "transcript" TEXT,
    "summary" TEXT,
    "activityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTextMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "direction" "CrmDirection" NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityId" TEXT,

    CONSTRAINT "CrmTextMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWebhook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signingSecret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWebhookDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "CrmWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "paidBy" TEXT NOT NULL DEFAULT 'ORG_KEY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmMemberSettings_bccToken_key" ON "CrmMemberSettings"("bccToken");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMemberSettings_organizationId_userId_key" ON "CrmMemberSettings"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_sponsorId_key" ON "CrmCompany"("sponsorId");

-- CreateIndex
CREATE INDEX "CrmCompany_organizationId_deletedAt_name_idx" ON "CrmCompany"("organizationId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "CrmCompany_organizationId_domain_idx" ON "CrmCompany"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "CrmCompany_organizationId_ownerId_idx" ON "CrmCompany"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "CrmCompany_custom_gin" ON "CrmCompany" USING GIN ("custom" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_organizationId_id_key" ON "CrmCompany"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPerson_selfUpdateTokenHash_key" ON "CrmPerson"("selfUpdateTokenHash");

-- CreateIndex
CREATE INDEX "CrmPerson_organizationId_deletedAt_name_idx" ON "CrmPerson"("organizationId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "CrmPerson_organizationId_companyId_idx" ON "CrmPerson"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "CrmPerson_organizationId_ownerId_idx" ON "CrmPerson"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "CrmPerson_organizationId_nextFollowUpAt_idx" ON "CrmPerson"("organizationId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "CrmPerson_organizationId_contactId_idx" ON "CrmPerson"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "CrmPerson_organizationId_userId_idx" ON "CrmPerson"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "CrmPerson_custom_gin" ON "CrmPerson" USING GIN ("custom" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "CrmPerson_name_trgm" ON "CrmPerson" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "CrmPerson_organizationId_id_key" ON "CrmPerson"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmPersonEmail_organizationId_personId_idx" ON "CrmPersonEmail"("organizationId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPersonEmail_organizationId_email_key" ON "CrmPersonEmail"("organizationId", "email");

-- CreateIndex
CREATE INDEX "CrmJob_organizationId_personId_idx" ON "CrmJob"("organizationId", "personId");

-- CreateIndex
CREATE INDEX "CrmJob_organizationId_companyId_idx" ON "CrmJob"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPipeline_databaseId_key" ON "CrmPipeline"("databaseId");

-- CreateIndex
CREATE INDEX "CrmPipeline_organizationId_archivedAt_sortOrder_idx" ON "CrmPipeline"("organizationId", "archivedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPipeline_organizationId_id_key" ON "CrmPipeline"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmStage_organizationId_pipelineId_sortOrder_idx" ON "CrmStage"("organizationId", "pipelineId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CrmStage_organizationId_id_key" ON "CrmStage"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDeal_sponsorshipId_key" ON "CrmDeal"("sponsorshipId");

-- CreateIndex
CREATE INDEX "CrmDeal_organizationId_pipelineId_deletedAt_stageId_rank_idx" ON "CrmDeal"("organizationId", "pipelineId", "deletedAt", "stageId", "rank");

-- CreateIndex
CREATE INDEX "CrmDeal_organizationId_ownerId_idx" ON "CrmDeal"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "CrmDeal_organizationId_companyId_idx" ON "CrmDeal"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "CrmDeal_organizationId_expectedOn_idx" ON "CrmDeal"("organizationId", "expectedOn");

-- CreateIndex
CREATE INDEX "CrmDeal_custom_gin" ON "CrmDeal" USING GIN ("custom" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "CrmDeal_organizationId_id_key" ON "CrmDeal"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmDealPerson_organizationId_personId_idx" ON "CrmDealPerson"("organizationId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDealPerson_dealId_personId_key" ON "CrmDealPerson"("dealId", "personId");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_occurredAt_idx" ON "CrmActivity"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmActivity_organizationId_id_key" ON "CrmActivity"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmActivity_organizationId_sourceKind_sourceId_key" ON "CrmActivity"("organizationId", "sourceKind", "sourceId");

-- CreateIndex
CREATE INDEX "CrmActivityTarget_organizationId_targetKind_targetId_occurr_idx" ON "CrmActivityTarget"("organizationId", "targetKind", "targetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmActivityTarget_activityId_targetKind_targetId_key" ON "CrmActivityTarget"("activityId", "targetKind", "targetId");

-- CreateIndex
CREATE INDEX "CrmEmailThread_organizationId_lastMessageAt_idx" ON "CrmEmailThread"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEmailThread_organizationId_id_key" ON "CrmEmailThread"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEmailMessage_trackingToken_key" ON "CrmEmailMessage"("trackingToken");

-- CreateIndex
CREATE INDEX "CrmEmailMessage_organizationId_threadId_idx" ON "CrmEmailMessage"("organizationId", "threadId");

-- CreateIndex
CREATE INDEX "CrmEmailMessage_organizationId_status_scheduledFor_idx" ON "CrmEmailMessage"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "CrmEmailMessage_organizationId_mailboxUserId_sentAt_idx" ON "CrmEmailMessage"("organizationId", "mailboxUserId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEmailMessage_organizationId_messageIdHeader_key" ON "CrmEmailMessage"("organizationId", "messageIdHeader");

-- CreateIndex
CREATE INDEX "CrmTemplate_organizationId_archivedAt_idx" ON "CrmTemplate"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTemplate_organizationId_id_key" ON "CrmTemplate"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSequence_organizationId_id_key" ON "CrmSequence"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmSequenceStep_organizationId_sequenceId_sortOrder_idx" ON "CrmSequenceStep"("organizationId", "sequenceId", "sortOrder");

-- CreateIndex
CREATE INDEX "CrmEnrollment_organizationId_status_nextRunAt_idx" ON "CrmEnrollment"("organizationId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "CrmEnrollment_organizationId_personId_idx" ON "CrmEnrollment"("organizationId", "personId");

-- CreateIndex
CREATE INDEX "CrmEnrollment_sequenceId_personId_idx" ON "CrmEnrollment"("sequenceId", "personId");

-- CreateIndex
CREATE INDEX "CrmView_organizationId_objectKind_idx" ON "CrmView"("organizationId", "objectKind");

-- CreateIndex
CREATE UNIQUE INDEX "CrmView_organizationId_id_key" ON "CrmView"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmCampaign_organizationId_status_idx" ON "CrmCampaign"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCampaign_organizationId_id_key" ON "CrmCampaign"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmCampaignTarget_organizationId_assigneeId_status_idx" ON "CrmCampaignTarget"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCampaignTarget_campaignId_personId_key" ON "CrmCampaignTarget"("campaignId", "personId");

-- CreateIndex
CREATE INDEX "CrmWorkflow_organizationId_status_idx" ON "CrmWorkflow"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmWorkflow_organizationId_id_key" ON "CrmWorkflow"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmWorkflowRun_organizationId_workflowId_startedAt_idx" ON "CrmWorkflowRun"("organizationId", "workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "CrmFieldHistory_organizationId_targetKind_targetId_changedA_idx" ON "CrmFieldHistory"("organizationId", "targetKind", "targetId", "changedAt");

-- CreateIndex
CREATE INDEX "CrmFieldHistory_organizationId_batchId_idx" ON "CrmFieldHistory"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "CrmGoal_organizationId_periodEnd_idx" ON "CrmGoal"("organizationId", "periodEnd");

-- CreateIndex
CREATE INDEX "CrmForecastSnapshot_organizationId_pipelineId_takenAt_idx" ON "CrmForecastSnapshot"("organizationId", "pipelineId", "takenAt");

-- CreateIndex
CREATE INDEX "CrmScoreRule_organizationId_objectKind_idx" ON "CrmScoreRule"("organizationId", "objectKind");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuote_publicTokenHash_key" ON "CrmQuote"("publicTokenHash");

-- CreateIndex
CREATE INDEX "CrmQuote_organizationId_dealId_idx" ON "CrmQuote"("organizationId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuote_organizationId_id_key" ON "CrmQuote"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuote_organizationId_number_key" ON "CrmQuote"("organizationId", "number");

-- CreateIndex
CREATE INDEX "CrmQuoteLine_organizationId_quoteId_idx" ON "CrmQuoteLine"("organizationId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmBookingPage_slug_key" ON "CrmBookingPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CrmBookingPage_organizationId_id_key" ON "CrmBookingPage"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmSuggestion_organizationId_status_createdAt_idx" ON "CrmSuggestion"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CrmSuggestion_organizationId_targetKind_targetId_idx" ON "CrmSuggestion"("organizationId", "targetKind", "targetId");

-- CreateIndex
CREATE INDEX "CrmDeliverable_organizationId_dealId_idx" ON "CrmDeliverable"("organizationId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmGuestLink_tokenHash_key" ON "CrmGuestLink"("tokenHash");

-- CreateIndex
CREATE INDEX "CrmGuestLink_organizationId_dealId_idx" ON "CrmGuestLink"("organizationId", "dealId");

-- CreateIndex
CREATE INDEX "CrmCall_organizationId_personId_startedAt_idx" ON "CrmCall"("organizationId", "personId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCall_organizationId_providerCallId_key" ON "CrmCall"("organizationId", "providerCallId");

-- CreateIndex
CREATE INDEX "CrmTextMessage_organizationId_personId_sentAt_idx" ON "CrmTextMessage"("organizationId", "personId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTextMessage_organizationId_providerMessageId_key" ON "CrmTextMessage"("organizationId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmApiKey_keyHash_key" ON "CrmApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "CrmApiKey_organizationId_idx" ON "CrmApiKey"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmWebhook_organizationId_id_key" ON "CrmWebhook"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CrmWebhookDelivery_organizationId_webhookId_createdAt_idx" ON "CrmWebhookDelivery"("organizationId", "webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_organizationId_createdAt_idx" ON "AiUsage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrmSettings" ADD CONSTRAINT "CrmSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMemberSettings" ADD CONSTRAINT "CrmMemberSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPersonEmail" ADD CONSTRAINT "CrmPersonEmail_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmJob" ADD CONSTRAINT "CrmJob_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmJob" ADD CONSTRAINT "CrmJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPipeline" ADD CONSTRAINT "CrmPipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDealPerson" ADD CONSTRAINT "CrmDealPerson_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDealPerson" ADD CONSTRAINT "CrmDealPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivityTarget" ADD CONSTRAINT "CrmActivityTarget_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CrmActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmailThread" ADD CONSTRAINT "CrmEmailThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmailMessage" ADD CONSTRAINT "CrmEmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CrmEmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTemplate" ADD CONSTRAINT "CrmTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSequence" ADD CONSTRAINT "CrmSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSequenceStep" ADD CONSTRAINT "CrmSequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CrmSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "CrmSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmView" ADD CONSTRAINT "CrmView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaign" ADD CONSTRAINT "CrmCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaignTarget" ADD CONSTRAINT "CrmCampaignTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaignTarget" ADD CONSTRAINT "CrmCampaignTarget_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmWorkflow" ADD CONSTRAINT "CrmWorkflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmWorkflowRun" ADD CONSTRAINT "CrmWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "CrmWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFieldHistory" ADD CONSTRAINT "CrmFieldHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmGoal" ADD CONSTRAINT "CrmGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmForecastSnapshot" ADD CONSTRAINT "CrmForecastSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmScoreRule" ADD CONSTRAINT "CrmScoreRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuoteLine" ADD CONSTRAINT "CrmQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBookingPage" ADD CONSTRAINT "CrmBookingPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSuggestion" ADD CONSTRAINT "CrmSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeliverable" ADD CONSTRAINT "CrmDeliverable_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmGuestLink" ADD CONSTRAINT "CrmGuestLink_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCall" ADD CONSTRAINT "CrmCall_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTextMessage" ADD CONSTRAINT "CrmTextMessage_personId_fkey" FOREIGN KEY ("personId") REFERENCES "CrmPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmApiKey" ADD CONSTRAINT "CrmApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmWebhook" ADD CONSTRAINT "CrmWebhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmWebhookDelivery" ADD CONSTRAINT "CrmWebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "CrmWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: helpers, RLS, grants and the manifest.
--
-- Who sees what (docs/features/crm.md, "Admin, security, mobile"):
--   CrmSettings.memberAccess ALL (the default): every member sees every
--   person, company, item, activity and email. OWN: a member sees the
--   records they own or made and the activity and mail they took part in;
--   owners, admins and CRM managers (CrmSettings.managerIds) see it all.
--   Members add and edit records, log activity and run outreach (the CRM is
--   shared work, like Tasks). Nothing core is deleted by a member: people,
--   companies and items go to the trash (deletedAt). Pipelines, stages,
--   workflows, score rules, goals and CRM settings are owners', admins' and
--   CRM managers'. API keys and webhooks are owners' and admins' alone. A
--   member's own settings and AI usage are theirs. Jobs, public pages and
--   webhooks write as app_service inside one organization's context.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.is_crm_manager() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce((SELECT (SELECT app.user_id()) = ANY (s."managerIds")
                     FROM "CrmSettings" s
                    WHERE s."organizationId" = (SELECT app.member_org_id())), false)
$$;

CREATE OR REPLACE FUNCTION app.crm_sees_all() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce((SELECT s."memberAccess" = 'ALL'
                     FROM "CrmSettings" s
                    WHERE s."organizationId" = (SELECT app.member_org_id())), true)
      OR (SELECT app.is_org_admin())
      OR (SELECT app.is_crm_manager())
$$;

REVOKE ALL ON FUNCTION app.is_crm_manager(), app.crm_sees_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_crm_manager(), app.crm_sees_all() TO app_user, app_service;

-- ---- CrmPerson -------------------------------------------------------------
ALTER TABLE "CrmPerson" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmPerson" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmPerson" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmPerson" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_service_select ON "CrmPerson" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmPerson" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmPerson" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmPerson" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmPerson" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmPerson" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmPerson" TO app_service;

-- ---- CrmCompany ------------------------------------------------------------
ALTER TABLE "CrmCompany" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmCompany" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmCompany" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmCompany" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_service_select ON "CrmCompany" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmCompany" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmCompany" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmCompany" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmCompany" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmCompany" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmCompany" TO app_service;

-- ---- CrmDeal ---------------------------------------------------------------
ALTER TABLE "CrmDeal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmDeal" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmDeal" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmDeal" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "ownerId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_service_select ON "CrmDeal" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmDeal" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmDeal" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmDeal" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmDeal" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmDeal" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmDeal" TO app_service;

-- ---- CrmPersonEmail --------------------------------------------------------
ALTER TABLE "CrmPersonEmail" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmPersonEmail" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmPersonEmail" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmPersonEmail" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmPersonEmail" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmPersonEmail" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmPersonEmail" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmPersonEmail" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmPersonEmail" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmPersonEmail" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmPersonEmail" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmPersonEmail" TO app_service;

-- ---- CrmJob ----------------------------------------------------------------
ALTER TABLE "CrmJob" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmJob" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmJob" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmJob" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmJob" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmJob" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmJob" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmJob" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmJob" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmJob" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmJob" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmJob" TO app_service;

-- ---- CrmDealPerson ---------------------------------------------------------
ALTER TABLE "CrmDealPerson" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmDealPerson" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmDealPerson" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmDealPerson" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmDealPerson" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmDealPerson" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmDealPerson" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmDealPerson" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmDealPerson" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmDealPerson" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmDealPerson" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmDealPerson" TO app_service;

-- ---- CrmActivityTarget -----------------------------------------------------
ALTER TABLE "CrmActivityTarget" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmActivityTarget" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmActivityTarget" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmActivityTarget" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmActivityTarget" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmActivityTarget" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmActivityTarget" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmActivityTarget" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmActivityTarget" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmActivityTarget" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmActivityTarget" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmActivityTarget" TO app_service;

-- ---- CrmEmailThread --------------------------------------------------------
ALTER TABLE "CrmEmailThread" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmEmailThread" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmEmailThread" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmEmailThread" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmEmailThread" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmEmailThread" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmEmailThread" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmEmailThread" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmEmailThread" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmEmailThread" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmEmailThread" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmEmailThread" TO app_service;

-- ---- CrmCampaign -----------------------------------------------------------
ALTER TABLE "CrmCampaign" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmCampaign" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmCampaign" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmCampaign" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmCampaign" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmCampaign" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmCampaign" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmCampaign" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmCampaign" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmCampaign" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmCampaign" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmCampaign" TO app_service;

-- ---- CrmCampaignTarget -----------------------------------------------------
ALTER TABLE "CrmCampaignTarget" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmCampaignTarget" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmCampaignTarget" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmCampaignTarget" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmCampaignTarget" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmCampaignTarget" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmCampaignTarget" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmCampaignTarget" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmCampaignTarget" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmCampaignTarget" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmCampaignTarget" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmCampaignTarget" TO app_service;

-- ---- CrmEnrollment ---------------------------------------------------------
ALTER TABLE "CrmEnrollment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmEnrollment" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmEnrollment" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmEnrollment" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmEnrollment" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmEnrollment" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmEnrollment" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmEnrollment" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmEnrollment" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmEnrollment" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmEnrollment" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmEnrollment" TO app_service;

-- ---- CrmDeliverable --------------------------------------------------------
ALTER TABLE "CrmDeliverable" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmDeliverable" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmDeliverable" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmDeliverable" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmDeliverable" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmDeliverable" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmDeliverable" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmDeliverable" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmDeliverable" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmDeliverable" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmDeliverable" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmDeliverable" TO app_service;

-- ---- CrmQuote --------------------------------------------------------------
ALTER TABLE "CrmQuote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmQuote" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmQuote" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmQuote" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmQuote" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmQuote" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmQuote" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmQuote" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmQuote" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmQuote" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmQuote" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmQuote" TO app_service;

-- ---- CrmQuoteLine ----------------------------------------------------------
ALTER TABLE "CrmQuoteLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmQuoteLine" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmQuoteLine" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmQuoteLine" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmQuoteLine" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmQuoteLine" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmQuoteLine" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmQuoteLine" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmQuoteLine" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmQuoteLine" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmQuoteLine" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmQuoteLine" TO app_service;

-- ---- CrmBookingPage --------------------------------------------------------
ALTER TABLE "CrmBookingPage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmBookingPage" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmBookingPage" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmBookingPage" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmBookingPage" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmBookingPage" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmBookingPage" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmBookingPage" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmBookingPage" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmBookingPage" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmBookingPage" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmBookingPage" TO app_service;

-- ---- CrmGuestLink ----------------------------------------------------------
ALTER TABLE "CrmGuestLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmGuestLink" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmGuestLink" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmGuestLink" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmGuestLink" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmGuestLink" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmGuestLink" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmGuestLink" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmGuestLink" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmGuestLink" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmGuestLink" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmGuestLink" TO app_service;

-- ---- CrmSequence -----------------------------------------------------------
ALTER TABLE "CrmSequence" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmSequence" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmSequence" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmSequence" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmSequence" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmSequence" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmSequence" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmSequence" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmSequence" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmSequence" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSequence" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSequence" TO app_service;

-- ---- CrmSequenceStep -------------------------------------------------------
ALTER TABLE "CrmSequenceStep" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmSequenceStep" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmSequenceStep" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmSequenceStep" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "CrmSequenceStep" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmSequenceStep" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmSequenceStep" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmSequenceStep" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmSequenceStep" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmSequenceStep" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSequenceStep" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSequenceStep" TO app_service;

-- ---- CrmCall ---------------------------------------------------------------
ALTER TABLE "CrmCall" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmCall" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "userId" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmCall" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmCall" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmCall" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmCall" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmCall" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmCall" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmCall" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmCall" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmCall" TO app_service;

-- ---- CrmTextMessage --------------------------------------------------------
ALTER TABLE "CrmTextMessage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmTextMessage" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "userId" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmTextMessage" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmTextMessage" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmTextMessage" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmTextMessage" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmTextMessage" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmTextMessage" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmTextMessage" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmTextMessage" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmTextMessage" TO app_service;

-- ---- CrmActivity -----------------------------------------------------------
ALTER TABLE "CrmActivity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmActivity" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("privateToId" IS NULL OR "privateToId" = (SELECT app.user_id())) AND ((SELECT app.crm_sees_all()) OR "actorId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmActivity" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmActivity" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "CrmActivity" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmActivity" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmActivity" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmActivity" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmActivity" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmActivity" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmActivity" TO app_service;

-- ---- CrmEmailMessage -------------------------------------------------------
ALTER TABLE "CrmEmailMessage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmEmailMessage" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.crm_sees_all()) OR "mailboxUserId" = (SELECT app.user_id()) OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmEmailMessage" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmEmailMessage" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmEmailMessage" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmEmailMessage" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmEmailMessage" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmEmailMessage" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmEmailMessage" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmEmailMessage" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmEmailMessage" TO app_service;

-- ---- CrmView ---------------------------------------------------------------
ALTER TABLE "CrmView" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmView" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("shared" OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmView" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmView" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_user_delete ON "CrmView" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "CrmView" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmView" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmView" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmView" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmView" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmView" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmView" TO app_service;

-- ---- CrmTemplate -----------------------------------------------------------
ALTER TABLE "CrmTemplate" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmTemplate" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("shared" OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "CrmTemplate" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmTemplate" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_user_delete ON "CrmTemplate" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "CrmTemplate" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmTemplate" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmTemplate" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmTemplate" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmTemplate" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmTemplate" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmTemplate" TO app_service;

-- ---- CrmSuggestion ---------------------------------------------------------
ALTER TABLE "CrmSuggestion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmSuggestion" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmSuggestion" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "CrmSuggestion" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmSuggestion" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmSuggestion" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmSuggestion" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmSuggestion" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmSuggestion" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmSuggestion" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSuggestion" TO app_service;

-- ---- CrmFieldHistory -------------------------------------------------------
ALTER TABLE "CrmFieldHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmFieldHistory" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmFieldHistory" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "changedById" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "CrmFieldHistory" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmFieldHistory" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmFieldHistory" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmFieldHistory" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmFieldHistory" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "CrmFieldHistory" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmFieldHistory" TO app_service;

-- ---- CrmForecastSnapshot ---------------------------------------------------
ALTER TABLE "CrmForecastSnapshot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmForecastSnapshot" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmForecastSnapshot" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "CrmForecastSnapshot" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmForecastSnapshot" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmForecastSnapshot" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmForecastSnapshot" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmForecastSnapshot" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "CrmForecastSnapshot" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmForecastSnapshot" TO app_service;

-- ---- CrmSettings -----------------------------------------------------------
ALTER TABLE "CrmSettings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmSettings" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmSettings" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "CrmSettings" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmSettings" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmSettings" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmSettings" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmSettings" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmSettings" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmSettings" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmSettings" TO app_service;

-- ---- CrmPipeline -----------------------------------------------------------
ALTER TABLE "CrmPipeline" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmPipeline" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmPipeline" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_update ON "CrmPipeline" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_delete ON "CrmPipeline" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmPipeline" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmPipeline" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmPipeline" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmPipeline" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmPipeline" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmPipeline" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmPipeline" TO app_service;

-- ---- CrmStage --------------------------------------------------------------
ALTER TABLE "CrmStage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmStage" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmStage" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_update ON "CrmStage" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_delete ON "CrmStage" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmStage" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmStage" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmStage" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmStage" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmStage" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmStage" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmStage" TO app_service;

-- ---- CrmWorkflow -----------------------------------------------------------
ALTER TABLE "CrmWorkflow" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmWorkflow" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmWorkflow" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_update ON "CrmWorkflow" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_delete ON "CrmWorkflow" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmWorkflow" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmWorkflow" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmWorkflow" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmWorkflow" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmWorkflow" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmWorkflow" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmWorkflow" TO app_service;

-- ---- CrmScoreRule ----------------------------------------------------------
ALTER TABLE "CrmScoreRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmScoreRule" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmScoreRule" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_update ON "CrmScoreRule" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_delete ON "CrmScoreRule" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmScoreRule" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmScoreRule" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmScoreRule" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmScoreRule" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmScoreRule" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmScoreRule" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmScoreRule" TO app_service;

-- ---- CrmGoal ---------------------------------------------------------------
ALTER TABLE "CrmGoal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmGoal" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmGoal" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_update ON "CrmGoal" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_user_delete ON "CrmGoal" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmGoal" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmGoal" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmGoal" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmGoal" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmGoal" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmGoal" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmGoal" TO app_service;

-- ---- CrmWorkflowRun --------------------------------------------------------
ALTER TABLE "CrmWorkflowRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmWorkflowRun" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "CrmWorkflowRun" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
CREATE POLICY app_service_select ON "CrmWorkflowRun" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmWorkflowRun" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmWorkflowRun" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmWorkflowRun" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmWorkflowRun" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "CrmWorkflowRun" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmWorkflowRun" TO app_service;

-- ---- CrmMemberSettings -----------------------------------------------------
ALTER TABLE "CrmMemberSettings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmMemberSettings" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_insert ON "CrmMemberSettings" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "CrmMemberSettings" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "CrmMemberSettings" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmMemberSettings" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmMemberSettings" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmMemberSettings" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmMemberSettings" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmMemberSettings" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmMemberSettings" TO app_service;

-- ---- CrmApiKey -------------------------------------------------------------
ALTER TABLE "CrmApiKey" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmApiKey" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_insert ON "CrmApiKey" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "CrmApiKey" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "CrmApiKey" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmApiKey" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmApiKey" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmApiKey" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmApiKey" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE ON "CrmApiKey" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmApiKey" TO app_service;

-- ---- CrmWebhook ------------------------------------------------------------
ALTER TABLE "CrmWebhook" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmWebhook" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_insert ON "CrmWebhook" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "CrmWebhook" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "CrmWebhook" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "CrmWebhook" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmWebhook" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmWebhook" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmWebhook" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmWebhook" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmWebhook" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmWebhook" TO app_service;

-- ---- CrmWebhookDelivery ----------------------------------------------------
ALTER TABLE "CrmWebhookDelivery" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "CrmWebhookDelivery" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "CrmWebhookDelivery" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "CrmWebhookDelivery" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "CrmWebhookDelivery" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "CrmWebhookDelivery" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "CrmWebhookDelivery" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT ON "CrmWebhookDelivery" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CrmWebhookDelivery" TO app_service;

-- ---- AiUsage ---------------------------------------------------------------
ALTER TABLE "AiUsage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "AiUsage" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND ((SELECT app.is_org_admin()) OR "userId" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "AiUsage" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "AiUsage" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "AiUsage" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "AiUsage" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "AiUsage" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "AiUsage" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "AiUsage" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiUsage" TO app_service;

-- ---- app.security_manifest ------------------------------------------
-- The tenant-only-write allowlist gains the CRM's member writes (unchanged
-- otherwise from 20261102140000_saved_reports). If another migration after
-- this one redefines the manifest, it must keep these entries.
CREATE OR REPLACE FUNCTION app.security_manifest()
RETURNS TABLE (check_name text, object_name text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp SET jit = off
AS $$
  WITH RECURSIVE rt AS (
    SELECT r.rolname, r.oid FROM pg_roles r
     WHERE r.rolname IN ('app_user', 'app_service', 'app_auth')
  ),
  nsp AS (
    SELECT n.oid, n.nspname FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname !~ '^pg_(toast_)?temp_'
  ),
  -- Schemas a runtime role can look names up in.
  reach_nsp AS (
    SELECT nsp.oid FROM nsp
     WHERE EXISTS (SELECT 1 FROM rt WHERE has_schema_privilege(rt.oid, nsp.oid, 'USAGE'))
  ),
  -- Every object a runtime role can get to, by name or through a reachable
  -- object (see the migration header).
  reached (classid, objid) AS (
    SELECT 'pg_class'::regclass::oid, c.oid FROM pg_class c
     WHERE c.relnamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_proc'::regclass::oid, p.oid FROM pg_proc p
     WHERE p.pronamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_type'::regclass::oid, t.oid FROM pg_type t
     WHERE t.typnamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_operator'::regclass::oid, o.oid FROM pg_operator o
     WHERE o.oprnamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_cast'::regclass::oid, k.oid FROM pg_cast k
    UNION
    SELECT x.classid, x.objid
      FROM reached r
     CROSS JOIN LATERAL (
       -- what it depends on
       SELECT d.refclassid, d.refobjid FROM pg_depend d
        WHERE d.classid = r.classid AND d.objid = r.objid
          AND d.refclassid <> 'pg_namespace'::regclass
       UNION ALL
       -- its parts
       SELECT d.classid, d.objid FROM pg_depend d
        WHERE d.refclassid = r.classid AND d.refobjid = r.objid
          AND d.deptype IN ('a', 'i')
     ) x (classid, objid)
  ),
  ext AS (
    SELECT d.objid, d.classid FROM pg_depend d WHERE d.deptype = 'e'
  ),
  -- Every relation, for the checks that stay global.
  rel_all AS (
    SELECT c.oid, c.relkind, c.relrowsecurity, c.reloptions,
           format('%I.%I', n.nspname, c.relname) AS fq
      FROM pg_class c JOIN nsp n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations')
       AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_class'::regclass AND ext.objid = c.oid)
  ),
  -- The reachable ones, for the object checks.
  rel AS (
    SELECT rel_all.* FROM rel_all
     WHERE EXISTS (SELECT 1 FROM reached
                    WHERE reached.classid = 'pg_class'::regclass AND reached.objid = rel_all.oid)
  ),
  readable AS (
    SELECT rel.oid, rt.rolname FROM rel, rt
     WHERE has_any_column_privilege(rt.oid, rel.oid, 'SELECT')
        OR has_any_column_privilege(rt.oid, rel.oid, 'INSERT')
        OR has_any_column_privilege(rt.oid, rel.oid, 'UPDATE')
        OR has_table_privilege(rt.oid, rel.oid, 'DELETE')
  ),
  cmd AS (SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS cmd),
  granted AS (
    SELECT rel.oid, rel.fq, rt.rolname, cmd.cmd FROM rel, rt, cmd
     WHERE rel.relkind IN ('r', 'p')
       AND CASE WHEN cmd.cmd = 'DELETE' THEN has_table_privilege(rt.oid, rel.oid, 'DELETE')
                ELSE has_any_column_privilege(rt.oid, rel.oid, cmd.cmd) END
  ),
  fn_all AS (
    SELECT p.oid, p.prosecdef, p.proconfig, p.proowner,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS fq,
           EXISTS (SELECT 1 FROM reached
                    WHERE reached.classid = 'pg_proc'::regclass AND reached.objid = p.oid) AS reachable,
           EXISTS (SELECT 1 FROM pg_event_trigger e WHERE e.evtfoid = p.oid) AS fires_on_ddl
      FROM pg_proc p JOIN nsp n ON n.oid = p.pronamespace
     WHERE NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_proc'::regclass AND ext.objid = p.oid)
  ),
  fn AS (
    SELECT * FROM fn_all WHERE fn_all.reachable
  )
  SELECT 'rls_disabled', fq FROM rel WHERE relkind IN ('r', 'p') AND NOT relrowsecurity
  UNION ALL
  SELECT 'view_not_invoker', rel.fq FROM rel
   WHERE rel.relkind = 'v'
     AND EXISTS (SELECT 1 FROM readable WHERE readable.oid = rel.oid)
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(rel.reloptions, ARRAY[]::text[])) o
                      WHERE lower(o) IN ('security_invoker=true', 'security_invoker=on',
                                         'security_invoker=1', 'security_invoker=yes'))
  UNION ALL
  SELECT 'matview_or_foreign_granted', rel.fq FROM rel
   WHERE rel.relkind IN ('m', 'f') AND EXISTS (SELECT 1 FROM readable WHERE readable.oid = rel.oid)
  UNION ALL
  SELECT 'policy_gap', g.fq || ':' || g.rolname || ':' || g.cmd FROM granted g
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policy pol
      WHERE pol.polrelid = g.oid
        AND (pol.polroles = '{0}' OR (SELECT r.oid FROM pg_roles r WHERE r.rolname = g.rolname) = ANY (pol.polroles))
        AND (pol.polcmd = '*' OR pol.polcmd = CASE g.cmd WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a'
                                                         WHEN 'UPDATE' THEN 'w' ELSE 'd' END))
  UNION ALL
  SELECT 'permissive_policy', p.schemaname || '.' || p.tablename || ':' || p.policyname FROM pg_policies p
   WHERE p.schemaname IN (SELECT nspname FROM nsp)
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   JOIN reached ON reached.classid = 'pg_class'::regclass AND reached.objid = c.oid
                  WHERE n.nspname = p.schemaname AND c.relname = p.tablename)
     AND (((p.roles && ARRAY['app_user', 'app_service']::name[])
           AND (p.qual = 'true' OR p.with_check = 'true' OR p.cmd = 'ALL'))
       OR (p.cmd = 'ALL' AND NOT (p.roles <@ ARRAY['app_auth']::name[])))
  UNION ALL
  SELECT 'dangerous_privilege', rel_all.fq || ':' || rt.rolname || ':' || pr.priv
    FROM rel_all, rt, (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) pr(priv)
   WHERE CASE pr.priv WHEN 'REFERENCES' THEN has_any_column_privilege(rt.oid, rel_all.oid, 'REFERENCES')
                      ELSE has_table_privilege(rt.oid, rel_all.oid, pr.priv) END
  UNION ALL
  SELECT 'public_execute', fn.fq FROM fn WHERE has_function_privilege('public', fn.oid, 'EXECUTE')
  UNION ALL
  SELECT 'definer_search_path', fn_all.fq FROM fn_all
   WHERE (fn_all.reachable OR fn_all.fires_on_ddl)
     AND fn_all.prosecdef
     AND NOT coalesce(fn_all.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false)
  UNION ALL
  SELECT 'temp_privilege', rt.rolname::text FROM rt
   WHERE has_database_privilege(rt.oid, current_database(), 'TEMPORARY')
  UNION ALL
  SELECT 'schema_create', nsp.nspname || ':' || rt.rolname FROM nsp, rt
   WHERE has_schema_privilege(rt.oid, nsp.oid, 'CREATE')
  UNION ALL
  SELECT 'role_attribute', r.rolname::text FROM pg_roles r JOIN rt ON rt.oid = r.oid
   WHERE r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
  UNION ALL
  SELECT 'role_membership', rt.rolname || ' in ' || g.rolname FROM pg_auth_members m
    JOIN rt ON rt.oid = m.member JOIN pg_roles g ON g.oid = m.roleid
  UNION ALL
  SELECT 'owns_objects', rt.rolname::text FROM rt
   WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = rt.oid)
      OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner = rt.oid)
      OR EXISTS (SELECT 1 FROM pg_type t WHERE t.typowner = rt.oid)
      OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = rt.oid)

  UNION ALL
  -- Tenant-only writes (B9, unchanged). A policy that lets app_user INSERT,
  -- UPDATE or DELETE with nothing but an organizationId test is a tenant
  -- check, not a permission check: every member of the org may do it, and
  -- the app layer is the only thing standing in the way. That is right for
  -- the tables below, where members legitimately write; anywhere else it is
  -- a missing role predicate, and this reports it until the table is
  -- reviewed and added here in a migration. Label shipped without one:
  -- label management has always been admin-only in the app, and any member
  -- could delete every label in the org straight through the database.
  SELECT 'tenant_only_write', p.tablename || ':' || p.cmd FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.roles && ARRAY['app_user']::name[]
     AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE')
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%is_org_admin%'
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%is_org_owner%'
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%is_finance%'
     AND (p.tablename || ':' || p.cmd) <> ALL (ARRAY[
       -- Tasks are the shared work surface: any member files, edits and
       -- closes one (the edit-authorization matrix is the app's, and the
       -- self-assign carve-out depends on it). INSERT pins createdById.
       'Task:INSERT', 'Task:UPDATE', 'Task:DELETE',
       -- Collaborators and labels on a task move with the task itself.
       'TaskAssignee:INSERT', 'TaskAssignee:UPDATE', 'TaskAssignee:DELETE',
       'TaskLabel:INSERT', 'TaskLabel:UPDATE', 'TaskLabel:DELETE',
       -- Mentions are a side effect of writing a description or a comment;
       -- INSERT pins mentionedById to the actor.
       'TaskMention:INSERT', 'TaskMention:UPDATE', 'TaskMention:DELETE',
       -- Append-only, actor pinned; there is no UPDATE or DELETE policy.
       'TaskActivity:INSERT',
       -- Author pinned on INSERT; UPDATE and DELETE are author-or-admin.
       'TaskComment:INSERT', 'Note:INSERT',
       -- Each member writes their own Sunday update (userId pinned); DELETE
       -- is admin-gated.
       'WeeklyUpdate:INSERT', 'WeeklyUpdate:UPDATE',
       -- A project's lead is cleared by the member who leaves the org
       -- (untieDepartingMember runs as them), and members keep a project's
       -- status, dates and lead current, so the UPDATE cannot be
       -- admin-only. Deleting projects is; creating them is too unless the
       -- org lets members (OrgSettings.memberCanCreateProjects).
       'Project:UPDATE',
       -- Anyone may open an availability poll (createdById pinned) and it
       -- carries its own slots; answering is pinned to the responder.
       'AvailabilityPoll:INSERT', 'AvailabilityPoll:UPDATE', 'AvailabilityPoll:DELETE',
       'PollSlot:INSERT', 'PollSlot:UPDATE', 'PollSlot:DELETE',
       'PollResponse:INSERT', 'PollResponse:UPDATE', 'PollResponse:DELETE',
       -- Creating an event invites other members, so attendee rows are
       -- written for people other than the actor.
       'EventAttendee:INSERT', 'EventAttendee:UPDATE', 'EventAttendee:DELETE',
       -- A notification is addressed to another member (the WITH CHECK
       -- requires the recipient to be one); marking one read is own-row.
       'Notification:INSERT', 'Notification:UPDATE',
       -- Own row, and a column-level grant that excludes email.
       'User:UPDATE',
       -- Own row only: a user's availability (onboarding). Nobody else reads
       -- or writes it; co-members see busy hours through
       -- app.member_busy_hours, which checks the org and its setting.
       'UserAvailability:INSERT', 'UserAvailability:UPDATE',
       'Pin:INSERT', 'Pin:UPDATE', 'Pin:DELETE',
       'RecentVisit:INSERT', 'RecentVisit:UPDATE', 'RecentVisit:DELETE',
       'MemberPrefs:INSERT', 'MemberPrefs:UPDATE', 'OrgFile:INSERT',
       'NoteFolder:INSERT',
       -- Question polls: any member asks one (createdById pinned) and votes
       -- as themselves while it is open (userId pinned, and the option must
       -- belong to the same poll). Closing, reopening and deleting a poll,
       -- and removing an option, are creator-or-admin.
       'Poll:INSERT', 'PollVote:INSERT', 'PollVote:DELETE',
       -- Club-made databases: a member adds and edits rows only where
       -- app.can_edit_database lets them (owners and admins, or members of a
       -- database that allows it), a role check the manifest can't read in
       -- the policy text. INSERT pins createdById; deleting for good is
       -- admin-only.
       'DatabaseRecord:INSERT', 'DatabaseRecord:UPDATE',
       -- Note sharing: a note's author (or an owner/admin, on a club note)
       -- shares it, which app.can_share_note decides, a role check the
       -- manifest can't read in the policy text. INSERT pins createdById
       -- and requires the person to be a member; anyone may also take
       -- themselves off a note shared with them (DELETE).
       'NoteShare:INSERT', 'NoteShare:UPDATE', 'NoteShare:DELETE',
       -- Note comments: whoever can see the note comments as themselves
       -- (app.can_view_note, authorId pinned); the author edits the body and
       -- whoever may edit the note resolves (app.can_edit_note, with
       -- app.note_comment_guard deciding the columns); the author or
       -- whoever may share the note deletes (app.can_share_note). Role
       -- checks the manifest can't read in the policy text.
       'NoteComment:INSERT', 'NoteComment:UPDATE', 'NoteComment:DELETE',
       -- Note versions: whoever may edit the note saves one as themselves
       -- and renames one (name is app_user's only UPDATE column); whoever
       -- may share the note deletes. app.can_edit_note and
       -- app.can_share_note are the role checks.
       'NoteVersion:INSERT', 'NoteVersion:UPDATE', 'NoteVersion:DELETE',
       -- The org chart: every member edits it (orgchart.write is every
       -- role). A new version pins createdById to the actor; a position is
       -- deleted only from a DRAFT. History is never deleted (no version
       -- DELETE), and the org's pointer moves only through
       -- app.set_active_org_chart.
       'OrgChartVersion:INSERT', 'OrgChartVersion:UPDATE',
       'OrgChartPosition:INSERT', 'OrgChartPosition:UPDATE', 'OrgChartPosition:DELETE',
       -- Each member hides and un-hides cards on their own Overview;
       -- the policies pin userId to the actor, which is a stronger test
       -- than a role check, not a weaker one.
       'UpNextDismissal:INSERT', 'UpNextDismissal:DELETE',
       -- AI connectors: a user's own grants (userId pinned on every
       -- command, no org involved). The connector path records and renews
       -- its grant as the user; Disconnect revokes it.
       'ConnectorGrant:INSERT', 'ConnectorGrant:UPDATE', 'ConnectorGrant:DELETE',
       -- Links between things in a space: any member links two things they
       -- can see (createdById pinned on INSERT; the app checks both ends
       -- resolve for them) and any member removes a link. A link carries
       -- no titles, so it reveals nothing the viewer can't already open.
       'ItemLink:INSERT', 'ItemLink:DELETE',
       -- The Inbox: each member snoozes and finishes their own items
       -- (userId pinned to the actor on every command, a stronger test
       -- than a role check).
       'InboxItemState:INSERT', 'InboxItemState:UPDATE', 'InboxItemState:DELETE',
       -- Who's online: each member marks only themselves as here (userId
       -- pinned to the actor on INSERT and UPDATE); nobody deletes.
       'MemberPresence:INSERT', 'MemberPresence:UPDATE',
       -- Announcements: any member posts one (authorId pinned to the actor);
       -- editing and removing are author-or-admin.
       'Announcement:INSERT',
       -- Each member marks only their own sightings (userId pinned).
       'AnnouncementSeen:INSERT',
       -- Decisions: any member raises one (createdById pinned); taking,
       -- deciding and dropping are owner, raiser or admin
       -- (app.decision_guard).
       'Decision:INSERT',
       -- Saved reports: any member makes one (createdById pinned); editing
       -- and archiving are maker-or-admin. Snapshots are taken as yourself
       -- (takenById pinned) of a report you can see.
       'Report:INSERT', 'ReportSnapshot:INSERT',
       -- CRM (20261105090000_crm): members add and edit people, companies
       -- and items, log activity and run outreach, as with Tasks; the
       -- policies pin createdById, changedById or userId where a row is
       -- one member's. Everything structural is admin or CRM manager.
       'CrmPerson:INSERT',
       'CrmPerson:UPDATE',
       'CrmCompany:INSERT',
       'CrmCompany:UPDATE',
       'CrmDeal:INSERT',
       'CrmDeal:UPDATE',
       'CrmPersonEmail:INSERT',
       'CrmPersonEmail:UPDATE',
       'CrmPersonEmail:DELETE',
       'CrmJob:INSERT',
       'CrmJob:UPDATE',
       'CrmJob:DELETE',
       'CrmDealPerson:INSERT',
       'CrmDealPerson:UPDATE',
       'CrmDealPerson:DELETE',
       'CrmActivityTarget:INSERT',
       'CrmActivityTarget:UPDATE',
       'CrmActivityTarget:DELETE',
       'CrmEmailThread:INSERT',
       'CrmEmailThread:UPDATE',
       'CrmEmailThread:DELETE',
       'CrmCampaign:INSERT',
       'CrmCampaign:UPDATE',
       'CrmCampaign:DELETE',
       'CrmCampaignTarget:INSERT',
       'CrmCampaignTarget:UPDATE',
       'CrmCampaignTarget:DELETE',
       'CrmEnrollment:INSERT',
       'CrmEnrollment:UPDATE',
       'CrmEnrollment:DELETE',
       'CrmDeliverable:INSERT',
       'CrmDeliverable:UPDATE',
       'CrmDeliverable:DELETE',
       'CrmQuote:INSERT',
       'CrmQuote:UPDATE',
       'CrmQuote:DELETE',
       'CrmQuoteLine:INSERT',
       'CrmQuoteLine:UPDATE',
       'CrmQuoteLine:DELETE',
       'CrmBookingPage:INSERT',
       'CrmBookingPage:UPDATE',
       'CrmBookingPage:DELETE',
       'CrmGuestLink:INSERT',
       'CrmGuestLink:UPDATE',
       'CrmGuestLink:DELETE',
       'CrmSequence:INSERT',
       'CrmSequence:UPDATE',
       'CrmSequence:DELETE',
       'CrmSequenceStep:INSERT',
       'CrmSequenceStep:UPDATE',
       'CrmSequenceStep:DELETE',
       'CrmCall:INSERT',
       'CrmCall:UPDATE',
       'CrmTextMessage:INSERT',
       'CrmTextMessage:UPDATE',
       'CrmActivity:INSERT',
       'CrmEmailMessage:INSERT',
       'CrmEmailMessage:UPDATE',
       'CrmView:INSERT',
       'CrmTemplate:INSERT',
       'CrmSuggestion:INSERT',
       'CrmSuggestion:UPDATE',
       'CrmFieldHistory:INSERT',
       'CrmForecastSnapshot:INSERT',
       'CrmMemberSettings:INSERT',
       'CrmMemberSettings:UPDATE',
       'AiUsage:INSERT'
     ])
$$;
