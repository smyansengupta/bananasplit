-- Sponsorships are Deals (docs/features/crm.md, "Deals, not sponsorships").
--
-- Bananasplit is for organizations, and professional CRMs call these deals
-- moving through a pipeline. Tables, models and stored keys keep their names
-- (Sponsor, Sponsorship, TransactionKind SPONSORSHIP, the "sponsors" pipeline
-- template, the "sponsorships" plan feature); only what people read changes,
-- plus one stored value: the "sponsor" relationship type folds into
-- "partner", which the same setup answer already made.
--
-- Data only: no table, column, policy, grant or function changes, so
-- app.security_manifest() is untouched.

-- 1. The ready-made pipeline and its database read "Deals" (names nobody
--    changed only; a pipeline someone renamed keeps its name).
UPDATE "DatabaseDefinition" d
   SET "name" = 'Deals'
  FROM "CrmPipeline" p
 WHERE p."databaseId" = d."id"
   AND p."template" = 'sponsors'
   AND d."name" = 'Sponsorships';

UPDATE "CrmPipeline"
   SET "name" = CASE WHEN "name" = 'Sponsorships' THEN 'Deals' ELSE "name" END,
       "itemNoun" = CASE WHEN "itemNoun" = 'sponsorship' THEN 'deal' ELSE "itemNoun" END,
       "itemNounPlural" = CASE WHEN "itemNounPlural" = 'sponsorships' THEN 'deals' ELSE "itemNounPlural" END
 WHERE "template" = 'sponsors'
   AND ("name" = 'Sponsorships' OR "itemNoun" = 'sponsorship' OR "itemNounPlural" = 'sponsorships');

-- 2. People tagged "sponsor" are partners.
UPDATE "CrmPerson" SET "relationship" = 'partner' WHERE "relationship" = 'sponsor';

-- 3. The relationship types: "sponsor" becomes "partner", or goes when
--    "partner" is already there (it keeps its place either way).
UPDATE "CrmSettings" s
   SET "relationshipTypes" = COALESCE((
         SELECT jsonb_agg(
                  CASE WHEN t->>'id' = 'sponsor'
                       THEN jsonb_build_object('id', 'partner', 'label', 'Partner',
                                               'color', COALESCE(t->>'color', 'orange'))
                       ELSE t END
                  ORDER BY i)
           FROM jsonb_array_elements(s."relationshipTypes") WITH ORDINALITY AS e(t, i)
          WHERE NOT (t->>'id' = 'sponsor'
                     AND EXISTS (SELECT 1 FROM jsonb_array_elements(s."relationshipTypes") x
                                  WHERE x->>'id' = 'partner'))
       ), '[]'::jsonb)
 WHERE jsonb_typeof(s."relationshipTypes") = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(s."relationshipTypes") x WHERE x->>'id' = 'sponsor');

-- 4. Saved views and workflow conditions that picked "sponsor" pick "partner".
UPDATE "CrmView" v
   SET "filters" = (
         SELECT jsonb_agg(
                  CASE WHEN f->>'col' = 'relationship' AND f->>'value' = 'sponsor'
                       THEN jsonb_set(f, '{value}', '"partner"') ELSE f END
                  ORDER BY i)
           FROM jsonb_array_elements(v."filters") WITH ORDINALITY AS e(f, i))
 WHERE jsonb_typeof(v."filters") = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(v."filters") x
                WHERE x->>'col' = 'relationship' AND x->>'value' = 'sponsor');

UPDATE "CrmWorkflow" w
   SET "conditions" = (
         SELECT jsonb_agg(
                  CASE WHEN c->>'field' = 'relationship' AND c->>'value' = 'sponsor'
                       THEN jsonb_set(c, '{value}', '"partner"') ELSE c END
                  ORDER BY i)
           FROM jsonb_array_elements(w."conditions") WITH ORDINALITY AS e(c, i))
 WHERE jsonb_typeof(w."conditions") = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(w."conditions") x
                WHERE x->>'field' = 'relationship' AND x->>'value' = 'sponsor');

UPDATE "CrmScoreRule"
   SET "condition" = jsonb_set("condition", '{value}', '"partner"')
 WHERE jsonb_typeof("condition") = 'object'
   AND "condition"->>'field' = 'relationship'
   AND "condition"->>'value' = 'sponsor';

-- 5. The starter email "Sponsorship ask" is "Partnership ask" (unchanged ones only).
UPDATE "CrmTemplate" SET "name" = 'Partnership ask' WHERE "name" = 'Sponsorship ask';

-- 6. A workflow made from the "new-sponsor" recipe takes the recipe's new title.
UPDATE "CrmWorkflow" SET "name" = 'A partner commits to a deal'
 WHERE "recipe" = 'new-sponsor' AND "name" = 'A new sponsor commits';
