import { NewCard } from "@/components/crm/cards/new-card";

import type { OverlayProps } from "./crm-overlays";

/** New person, company or deal (?open=new:person|company|deal), from the header's create button. */
export function NewOverlay({ shell, open }: OverlayProps<"new">) {
  return (
    <NewCard
      orgId={shell.org.id}
      what={open.what}
      pipelines={shell.pipelines.map((p) => ({ id: p.id, name: p.name, noun: p.itemNoun }))}
      relationships={(shell.access.settings?.relationshipTypes ?? []).map((t) => ({
        id: t.id,
        label: t.label,
      }))}
    />
  );
}
