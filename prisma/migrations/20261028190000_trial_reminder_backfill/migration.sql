-- "Your free trial is almost up" for trials that started before reminders
-- existed (scheduleTrialReminder, src/server/settings/org-creation.ts, only
-- queues one for a space made from 20261028 on). Every live organization
-- still on its trial gets the same job a new one does: TRIAL_NOTICE_DAYS (3)
-- before the end, or now when less is left. Same kind, key and once flag,
-- so it can't double up with a reminder already queued, and the job itself
-- sends nothing once a plan is picked or the trial is over.

SELECT app.enqueue_job(
         o."id",
         'trial-reminder-email',
         'trial-reminder-email:' || o."id",
         '{}'::jsonb,
         greatest(o."trialEndsAt" - interval '3 days', app.utc_now())::timestamp,
         8,
         true
       )
  FROM "Organization" o
 WHERE o."deletedAt" IS NULL
   AND o."trialEndsAt" > app.utc_now()
   AND ((o."kind" = 'CLUB' AND o."plan" = 'TRIAL')
        OR (o."kind" = 'PERSONAL' AND o."plan" = 'FREE'));
