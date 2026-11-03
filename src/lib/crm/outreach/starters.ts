/**
 * The CRM's starter email templates, in one place (docs/features/crm.md,
 * module 5), written with outreach's merge fields (./merge.ts) exactly:
 * Outreach makes the everyday ones the first time someone opens it, and an
 * automation recipe makes the one it names (by category) when it's missing.
 * Pure and client-safe; a test renders each with the real renderer.
 */

export interface StarterTemplate {
  name: string;
  /** welcome, receipt, follow-up, thank-you, invite: what a recipe looks a template up by. */
  category: string;
  subject: string;
  body: string;
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    name: "Quick hello",
    category: "follow-up",
    subject: "Catching up",
    body: "Hi {{first_name|there}},\n\nIt's been {{last_contacted|a while}} since we talked. How are things at {{company|your end}}?\n\n{{my_first_name}}",
  },
  {
    name: "Thanks for coming",
    category: "thank-you",
    subject: "Thanks for coming to {{last_event|our event}}",
    body: "Hi {{first_name|there}},\n\nThank you for coming to {{last_event|our event}}. It was good to see you there.\n\nWe'd love to have you at the next one.\n\n{{my_first_name}}\n{{organization}}",
  },
  {
    name: "Sponsorship ask",
    category: "invite",
    subject: "{{organization}} and {{company|you}}",
    body: "Hi {{first_name|there}},\n\nI'm {{my_first_name}} from {{organization}}. We're planning our next events and would love {{company|your team}} to be part of them.\n\nWould you have 20 minutes to talk this month?\n\n{{my_first_name}}",
  },
  {
    name: "Welcome",
    category: "welcome",
    subject: "Welcome, {{first_name|friend}}",
    body: "Hi {{first_name|there}},\n\nThanks for your interest in {{organization}}. We'd love to tell you more: reply to this email with a good time to talk, or come along to our next event.\n\n{{my_first_name}}\n{{organization}}",
  },
  {
    name: "Thank you and receipt",
    category: "receipt",
    subject: "Thank you for your gift, {{first_name|friend}}",
    body: "Hi {{first_name|there}},\n\nThank you for your generous gift to {{organization}}. This email is your receipt.\n\nWith thanks,\n{{my_first_name}}\n{{organization}}",
  },
];

/** The ones Outreach makes on first open (the recipes make their own when needed). */
export const EVERYDAY_STARTERS = STARTER_TEMPLATES.filter((t) => ["follow-up", "thank-you", "invite"].includes(t.category));

/** The starter of a category, for a recipe. */
export function starterFor(category: string): StarterTemplate | null {
  return STARTER_TEMPLATES.find((t) => t.category === category) ?? null;
}
