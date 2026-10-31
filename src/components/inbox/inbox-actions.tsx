"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { markAllNotificationsRead } from "@/app/app/notifications-actions";
import { clearReadUpdates, restoreInboxItems } from "@/app/app/[orgSlug]/inbox/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/** Updates: every unread one read at once. */
export function MarkAllRead() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
    >
      Mark all read
    </Button>
  );
}

/** Updates: the read ones out of the list, with Undo. */
export function ClearRead({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const { keys } = await clearReadUpdates(orgId);
          router.refresh();
          if (keys.length === 0) return;
          toast({
            title: keys.length === 1 ? "1 cleared" : `${keys.length} cleared`,
            action: {
              label: "Undo",
              run: async () => {
                const back = await restoreInboxItems(orgId, keys);
                if (!back.ok) return back.error;
                router.refresh();
              },
            },
          });
        })
      }
    >
      Clear read
    </Button>
  );
}
