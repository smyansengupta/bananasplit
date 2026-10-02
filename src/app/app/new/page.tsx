import { redirect } from "next/navigation";

/**
 * /app/new: "Create organization" from an old link. Every new org goes
 * through the same setup (onboarding Flow B: name, data, labels, finance,
 * teams), whether it is someone's first org or their fifth.
 */
export default function NewOrganizationPage() {
  redirect("/onboarding/organization");
}
