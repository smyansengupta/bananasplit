import { toast } from "@/components/ui/toaster";

/** Copies the in-app address `href` as a full link, and says how it went. */
export function copyPollLink(
  href: string,
  copied: { title: string; description?: string; duration?: number } = { title: "Link copied" },
): void {
  const done = () => toast({ tone: "success", duration: 3_000, ...copied });
  const failed = () => toast({ title: "Couldn't copy the link", tone: "error" });
  if (!navigator.clipboard) {
    failed();
    return;
  }
  navigator.clipboard.writeText(`${window.location.origin}${href}`).then(done, failed);
}

/**
 * Copies an availability poll's guest link (its public page, where anyone
 * answers with just a name), for sending to people outside the club.
 */
export function copyGuestPollLink(pollId: string): void {
  copyPollLink(`/poll/${pollId}`, {
    title: "Guest link copied",
  });
}
