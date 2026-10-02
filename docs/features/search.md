# Search (⌘K)

The search box in the top bar (⌘K, or Ctrl+K off a Mac) finds anything in the
org and jumps to it, and does a few things without leaving the keyboard.

## What it finds

| Kind | Matched on | Opens |
|---|---|---|
| Pages and settings | Name, the org's own section names, and other words people use ("kanban", "dark mode", "pay me back") | The page |
| Notes | Title and body, by full text: "quart" finds "quarterly" | The note, with the passage that matched |
| Files and folders | Name, the file's text excerpt, its folder | The file, or the folder on Notes |
| Tasks | Title, description, project, label, owner | The task |
| Projects and labels | Name, description | The task board or table, filtered |
| Events | Title, description, location, host | The event |
| Polls | Title or question, description, the answer options | The poll |
| People | Name, this org's title, major, pronouns; email for owners and admins | Their profile |
| Org chart | Role title, who holds it, what it's responsible for | The role on the chart |
| Databases | Name, kind, tag | The database |
| Finance | Description, payee, category, or an amount ("$45.50"); sponsors by name | Owners and treasurers: Transactions on that day, or Sponsorships. Everyone else: their own expenses, on My reimbursements |

Every word has to match somewhere, in any order: "budget spring" finds
"Spring budget review". Case and accents don't matter when ranking. The best
match leads, and so does the group it's in: an exact name beats a name that
starts with the words, which beats a passing mention.

With nothing typed, the box shows recently visited pages, a few things to do
and the sections. Pick a filter with nothing typed to list the latest of that
kind (open tasks by due date, upcoming events, recent notes...).

Each group ends with "Search all … for", which opens the section's own list
(Notes, Files, the Tasks table, People) filtered the same way.

## Keys

| Key | Does |
|---|---|
| ↑ ↓ | Move |
| ↵ | Open |
| ⌘↵ / Ctrl+↵ | Open in a new tab |
| Tab, Shift+Tab | Next or previous filter |
| Backspace (empty box) | Clear the filter |
| Esc | Close |

## Who sees what

Search runs as the member, under the same row-level security as every page,
so it never shows a private note or private task they couldn't open. It also
follows the rules the pages enforce in code:

- **Finance:** owners and treasurers search the ledger and sponsors. Members
  only find expenses they submitted.
- **Emails:** only owners and admins can find a member by email address.
- **Hidden sections** (Settings › Sidebar): members don't get results from a
  section the org turned off. Owners and admins still do, and the section is
  marked "Hidden from members".
- **Settings pages** are listed only for the roles that can open them.

## How it works

- `src/components/command-palette/`: the palette. `catalog.ts` holds the
  pages and actions, matched in the browser so they appear as you type.
  `use-workspace-search.ts` handles the server search: a 140 ms pause, only
  the newest answer is kept, and answers are cached while the palette is open.
- `src/server/search/workspace.ts`: one server action call, one transaction,
  about a dozen capped queries. Notes use the `searchVector` index with every
  word as a prefix, falling back to a substring match for the title and body.
  Everything else uses "every word in one of these fields"
  (`src/server/search/where.ts`). The list pages' search boxes use the same
  helper.
- `src/lib/search/text.ts`: how words are split, scored, highlighted and
  excerpted. The server ranks and the palette highlights with the same code.
