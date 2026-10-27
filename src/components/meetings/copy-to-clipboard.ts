import { toast } from "@/components/ui/toaster";

/**
 * Puts `text` on the clipboard and says so (`done` is the toast's line).
 * A browser that refuses is told, not left wondering. Browser-only: import it
 * from a client component.
 */
export async function copyToClipboard(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: done, tone: "success", duration: 3000 });
  } catch {
    toast({ title: "Couldn't copy. Your browser blocked the clipboard.", tone: "error" });
  }
}
