/**
 * The apps onboarding offers to import from (the Import step) and to connect
 * (Connect tools). Brand colours are fixed, so they live here as data, like
 * src/components/marketing/brands.ts. `mark` is the short mark on the
 * colour tile drawn where there's no logo file.
 *
 * Only the spreadsheet import works today (CSV and Excel into a database,
 * /app/<org>/databases/import). The rest are buttons that note the choice;
 * their importers and connections come later.
 */

export interface Source {
  id: string;
  name: string;
  /** What comes across, in a few words. */
  brings: string;
  color: string;
  ink: string;
  mark: string;
  /** The logo file, public/marketing/logos/<id>.svg (see SOURCES.txt there); the tile when absent. */
  logo?: string;
}

const source = (
  id: string,
  name: string,
  brings: string,
  color: string,
  ink: string,
  mark: string,
): Source => ({ id, name, brings, color, ink, mark, logo: `/marketing/logos/${id}.svg` });

/** Where teams come from, most common first. */
export const IMPORT_SOURCES: readonly Source[] = [
  source("notion", "Notion", "Pages, docs and databases", "#FFFFFF", "#191919", "N"),
  source("jira", "Jira", "Issues, epics and sprints", "#0052CC", "#FFFFFF", "J"),
  source("monday", "monday.com", "Boards and items", "#6161FF", "#FFFFFF", "m"),
  source("asana", "Asana", "Projects and tasks", "#F06A6A", "#FFFFFF", "a"),
  source("trello", "Trello", "Boards, lists and cards", "#0C66E4", "#FFFFFF", "T"),
  source("clickup", "ClickUp", "Spaces, lists and tasks", "#7B68EE", "#FFFFFF", "C"),
  source("linear", "Linear", "Issues and projects", "#5E6AD2", "#FFFFFF", "L"),
  source("airtable", "Airtable", "Bases and tables", "#FCB400", "#1F1F1F", "A"),
];

/** The one import that works now: a spreadsheet, as a database. */
export const SPREADSHEET_SOURCE: Source = {
  id: "spreadsheet",
  name: "CSV or Excel",
  brings: "Any spreadsheet, as a database",
  color: "#217346",
  ink: "#FFFFFF",
  mark: "X",
};
