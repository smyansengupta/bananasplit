import { AskCard } from "@/components/crm/lazy-parts";

import type { OverlayProps } from "./crm-overlays";

/** Ask (?open=ask): the card does its own asking, on the organization's own AI key. */
export function AskOverlay({ shell, orgSlug }: OverlayProps<"ask">) {
  return <AskCard orgId={shell.org.id} orgSlug={orgSlug} />;
}
