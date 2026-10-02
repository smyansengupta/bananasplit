import { redirect } from "next/navigation";

/** /onboarding/profile starts at A1. */
export default function ProfileSetupIndex() {
  redirect("/onboarding/profile/basics");
}
