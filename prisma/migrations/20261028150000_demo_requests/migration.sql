-- Demo requests (/demo, "Get a 15-minute walkthrough"): every request is
-- saved here, then emailed to the inbox, so none is lost when mail fails.

-- CreateTable
CREATE TABLE "DemoRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "teamSize" TEXT NOT NULL,
    "message" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoRequest_createdAt_idx" ON "DemoRequest"("createdAt");

-- ---------------------------------------------------------------------------
-- Hand-written: RLS and grants. Platform data, like PasswordResetToken, but
-- write-only: app_auth inserts a request (the /demo action, no tenant
-- context) and cannot read, change or delete any. No tenant role can touch
-- it. The owner role reads it (Supabase's table editor).
-- ---------------------------------------------------------------------------

ALTER TABLE "DemoRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_auth_insert ON "DemoRequest" FOR INSERT TO app_auth WITH CHECK (true);
GRANT INSERT ON "DemoRequest" TO app_auth;
