import { toast } from "@/components/ui/toaster";

/** Copies the in-app address `href` as a full link, and says how it went. */
export function copyPollLink(href: string): void {
  const done = () => toast({ title: "Link copied", tone: "success", duration: 3_000 });
  const failed = () => toast({ title: "Couldn't copy the link", tone: "error" });
  if (!navigator.clipboard) {
    failed();
    return;
  }
  navigator.clipboard.writeText(`${window.location.origin}${href}`).then(done, failed);
}
