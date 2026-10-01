/**
 * Starting points for a new note (Notes › New). Plain HTML the browser reads
 * into the note schema, like an imported document.
 */

export interface NoteTemplate {
  id: string;
  title: string;
  description: string;
  /** lucide icon name. */
  icon: string;
  html: (today: string) => string;
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "meeting",
    title: "Meeting notes",
    description: "Attendees, agenda, decisions, action items.",
    icon: "Users",
    html: (today) => `<h2>Meeting · ${today}</h2>
<p><strong>Attendees:</strong> </p>
<h3>Agenda</h3><ol><li><p></p></li></ol>
<h3>Notes</h3><ul><li><p></p></li></ul>
<h3>Decisions</h3><ul><li><p></p></li></ul>
<h3>Action items</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Owner: task, by date</p></li></ul>`,
  },
  {
    id: "event",
    title: "Event plan",
    description: "Goal, logistics, budget, run of show.",
    icon: "CalendarDays",
    html: () => `<h2>Event plan</h2>
<table><tbody>
<tr><th><p>Date &amp; time</p></th><td><p></p></td></tr>
<tr><th><p>Location</p></th><td><p></p></td></tr>
<tr><th><p>Expected turnout</p></th><td><p></p></td></tr>
<tr><th><p>Budget</p></th><td><p></p></td></tr>
</tbody></table>
<h3>Goal</h3><p></p>
<h3>Run of show</h3><ol><li><p></p></li></ol>
<h3>To do</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Book the room</p></li><li data-type="taskItem" data-checked="false"><p>Order food</p></li><li data-type="taskItem" data-checked="false"><p>Promote on social</p></li></ul>`,
  },
  {
    id: "brief",
    title: "Project brief",
    description: "Problem, plan, owners, milestones.",
    icon: "Target",
    html: () => `<h2>Project brief</h2>
<h3>The problem</h3><p></p>
<h3>What we'll do</h3><p></p>
<h3>Owners</h3><ul><li><p></p></li></ul>
<h3>Milestones</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
<h3>Open questions</h3><ul><li><p></p></li></ul>`,
  },
  {
    id: "weekly",
    title: "Weekly update",
    description: "Done, next, blocked.",
    icon: "ListChecks",
    html: (today) => `<h2>Week of ${today}</h2>
<h3>Done</h3><ul><li><p></p></li></ul>
<h3>Next</h3><ul><li><p></p></li></ul>
<h3>Blocked</h3><ul><li><p></p></li></ul>`,
  },
];
