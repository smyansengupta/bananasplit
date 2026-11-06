import { toast } from "@/components/ui/toaster";

/**
 * Runs a client-side call to a server action and turns a throw (a dropped
 * connection, a server error) into an error toast. Inside startTransition
 * an uncaught throw goes to the nearest error boundary and replaces the
 * whole page, so every button that calls an action goes through this.
 * Returns the action's result, or undefined when it threw.
 */
export async function runAction<T>(
  call: () => Promise<T>,
  failure = "That didn't go through. Try again.",
): Promise<T | undefined> {
  try {
    return await call();
  } catch {
    toast({ title: failure, tone: "error" });
    return undefined;
  }
}
