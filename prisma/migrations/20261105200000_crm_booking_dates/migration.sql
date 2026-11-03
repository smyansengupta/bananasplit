-- Booking pages honor one-off dates (docs/features/crm.md, "Gaps closed").
--
-- app.crm_booking_busy(page) returned each host's weekly busy cells only, so
-- a date a host had marked as one they can't make ("One date you can't
-- make" in their availability: all day, or some hours) was still bookable.
-- It now also returns "dates": those date rules from today on (a day of
-- slack for time zones), as {date, start, end} with start and end null for
-- a whole day. Never the rule's label. Same callers, same context rule
-- (the caller's organization, hosts who are still members), service role
-- only. The return type changes, so the function is dropped and made again.

DROP FUNCTION app.crm_booking_busy(text);

CREATE FUNCTION app.crm_booking_busy(p_page text)
RETURNS TABLE ("userId" text, "busy" text[], "dates" jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m."userId",
         COALESCE(a."busy", ARRAY[]::text[]),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('date', r->>'date', 'start', r->'start', 'end', r->'end')
                            ORDER BY r->>'date')
             FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(a."rules"->'rules') = 'array' THEN a."rules"->'rules'
                         ELSE '[]'::jsonb END) r
            WHERE jsonb_typeof(r) = 'object'
              AND r->>'kind' = 'date'
              AND (r->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              AND (r->>'date') >= to_char(current_date - 1, 'YYYY-MM-DD')
         ), '[]'::jsonb)
    FROM public."CrmBookingPage" b
    JOIN public."Membership" m
      ON m."organizationId" = b."organizationId" AND m."userId" = ANY (b."hostIds")
    LEFT JOIN public."UserAvailability" a ON a."userId" = m."userId"
   WHERE app.org_id() IS NOT NULL
     AND b."organizationId" = app.org_id()
     AND b."id" = p_page
$$;
REVOKE ALL ON FUNCTION app.crm_booking_busy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.crm_booking_busy(text) TO app_service;
