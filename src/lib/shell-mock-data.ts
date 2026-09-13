// Placeholder data for the app shell built in Phase 0.5.
// Phase 1 replaces every export here with real session/org lookups —
// nothing in src/components/shell should import from this file directly
// once that happens; it exists only to make the shell renderable today.

export type MockRole = "OWNER" | "ADMIN" | "TREASURER" | "MEMBER";

export interface MockOrg {
  slug: string;
  name: string;
}

export interface MockUser {
  name: string;
  email: string;
  image: string | null;
}

export const mockCurrentUser: MockUser = {
  name: "Alice Nguyen",
  email: "alice@example.edu",
  image: null,
};

export const mockOrgs: MockOrg[] = [
  { slug: "robotics-club", name: "Robotics Club" },
  { slug: "debate-society", name: "Debate Society" },
];

export function mockRoleFor(_orgSlug: string): MockRole {
  return "OWNER";
}

export function canManageFinance(role: MockRole): boolean {
  return role === "OWNER" || role === "TREASURER";
}
