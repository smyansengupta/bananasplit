import type { ChoiceColor, FieldType } from "./fields";

/**
 * Starting points for a club-made database: the fields a club usually
 * wants, ready to rename or remove. The first field names the rows. Pure
 * and client-safe (the New database dialog lists them; the server builds
 * from them).
 */

export interface TemplateField {
  name: string;
  type: FieldType;
  choices?: { label: string; color: ChoiceColor }[];
  decimals?: number;
}

export interface DatabaseTemplate {
  id: string;
  name: string;
  /** The suggested database name. */
  defaultName: string;
  description: string;
  icon: string;
  fields: TemplateField[];
  /** Empty rows it starts with (a spreadsheet's grid to type into). */
  rows?: number;
  /** Offered in a Personal space too (the rest are for running a club). */
  personal?: boolean;
}

export const DATABASE_TEMPLATES: readonly DatabaseTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    defaultName: "Untitled database",
    description: "A name column and a notes column. Add whatever fields you need.",
    icon: "Table2",
    fields: [
      { name: "Name", type: "TEXT" },
      { name: "Notes", type: "LONG_TEXT" },
    ],
    personal: true,
  },
  {
    id: "spreadsheet",
    name: "Spreadsheet",
    defaultName: "Untitled spreadsheet",
    description:
      "A blank grid, columns A to F and 20 rows, to type straight into. Rename a column or change its type any time.",
    icon: "Sheet",
    fields: ["A", "B", "C", "D", "E", "F"].map((name) => ({ name, type: "TEXT" as const })),
    rows: 20,
    personal: true,
  },
  {
    id: "roster",
    name: "Member roster",
    defaultName: "Member roster",
    description: "Everyone in the organization with their year, role and dues.",
    icon: "Users",
    fields: [
      { name: "Name", type: "TEXT" },
      { name: "Email", type: "EMAIL" },
      { name: "Phone", type: "PHONE" },
      {
        name: "Year",
        type: "SELECT",
        choices: [
          { label: "First year", color: "green" },
          { label: "Second year", color: "teal" },
          { label: "Third year", color: "blue" },
          { label: "Fourth year", color: "purple" },
          { label: "Grad", color: "brown" },
        ],
      },
      { name: "Major", type: "TEXT" },
      { name: "Dues paid", type: "CHECKBOX" },
      { name: "Joined", type: "DATE" },
    ],
  },
  {
    id: "equipment",
    name: "Equipment",
    defaultName: "Equipment",
    description: "What the organization owns, where it is and who has it.",
    icon: "Package",
    fields: [
      { name: "Item", type: "TEXT" },
      {
        name: "Status",
        type: "SELECT",
        choices: [
          { label: "Available", color: "green" },
          { label: "Checked out", color: "yellow" },
          { label: "Broken", color: "red" },
        ],
      },
      { name: "Checked out by", type: "MEMBER" },
      { name: "Due back", type: "DATE" },
      { name: "Quantity", type: "NUMBER", decimals: 0 },
      { name: "Location", type: "TEXT" },
      { name: "Value", type: "CURRENCY" },
    ],
  },
  {
    id: "merch",
    name: "Merch orders",
    defaultName: "Merch orders",
    description: "Who ordered what, the size, and whether they paid and picked up.",
    icon: "Shirt",
    fields: [
      { name: "Name", type: "TEXT" },
      { name: "Email", type: "EMAIL" },
      {
        name: "Item",
        type: "SELECT",
        choices: [
          { label: "T-shirt", color: "yellow" },
          { label: "Hoodie", color: "blue" },
          { label: "Sticker pack", color: "pink" },
        ],
      },
      {
        name: "Size",
        type: "SELECT",
        choices: ["XS", "S", "M", "L", "XL", "XXL"].map((label) => ({
          label,
          color: "gray" as const,
        })),
      },
      { name: "Quantity", type: "NUMBER", decimals: 0 },
      { name: "Paid", type: "CHECKBOX" },
      { name: "Picked up", type: "CHECKBOX" },
    ],
  },
  {
    id: "contacts",
    name: "Sponsors and contacts",
    defaultName: "Contacts",
    description: "Companies, speakers and partners, with who's talking to them.",
    icon: "Handshake",
    fields: [
      { name: "Name", type: "TEXT" },
      { name: "Organization", type: "TEXT" },
      { name: "Email", type: "EMAIL" },
      { name: "Phone", type: "PHONE" },
      {
        name: "Stage",
        type: "SELECT",
        choices: [
          { label: "To contact", color: "gray" },
          { label: "Reached out", color: "blue" },
          { label: "In talks", color: "yellow" },
          { label: "Confirmed", color: "green" },
          { label: "Declined", color: "red" },
        ],
      },
      { name: "Owner", type: "MEMBER" },
      { name: "Website", type: "URL" },
      { name: "Notes", type: "LONG_TEXT" },
    ],
  },
  {
    id: "ideas",
    name: "Event ideas",
    defaultName: "Event ideas",
    description: "A backlog of ideas with a rough cost and a vote.",
    icon: "Lightbulb",
    fields: [
      { name: "Idea", type: "TEXT" },
      {
        name: "Type",
        type: "MULTI_SELECT",
        choices: [
          { label: "Workshop", color: "blue" },
          { label: "Social", color: "pink" },
          { label: "Speaker", color: "purple" },
          { label: "Fundraiser", color: "green" },
        ],
      },
      { name: "Estimated cost", type: "CURRENCY" },
      { name: "Suggested by", type: "MEMBER" },
      { name: "Votes", type: "NUMBER", decimals: 0 },
      { name: "Details", type: "LONG_TEXT" },
    ],
  },
];

export function findTemplate(id: string): DatabaseTemplate | undefined {
  return DATABASE_TEMPLATES.find((t) => t.id === id);
}
