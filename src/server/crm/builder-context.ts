import type { TxClient } from "@/server/db/context";

import { customFieldsFor } from "./databases";
import { describeContext } from "./describe";

/** What the workflow builder offers: the organization's pipelines, members, templates, forms, events and custom fields. */
export async function builderContext(db: TxClient, organizationId: string) {
  const base = await describeContext(db, organizationId);
  const person = await customFieldsFor(db, organizationId, "person");
  const company = await customFieldsFor(db, organizationId, "company");
  const deal: { key: string; label: string }[] = [];
  for (const p of base.pipelines) {
    for (const f of await customFieldsFor(db, organizationId, "deal", p.id)) {
      deal.push({ key: `custom.${f.id}`, label: base.pipelines.length > 1 ? `${p.name}: ${f.name}` : f.name });
    }
  }
  return {
    ...base,
    members: base.members.sort((a, b) => a.name.localeCompare(b.name)),
    customFields: {
      person: person.map((f) => ({ key: `custom.${f.id}`, label: f.name })),
      company: company.map((f) => ({ key: `custom.${f.id}`, label: f.name })),
      deal,
    },
  };
}
