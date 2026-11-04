import Link from "next/link";

/**
 * Done on its own, on Today's right under Goals and Coming up: the latest
 * few things the CRM did without anyone clicking (an automation's change, a
 * plan's first email, something it held back), each with when and a short
 * line, how many in the last week, and See all, which opens the full list
 * with its Undo buttons (?open=log).
 */

export interface TodayLogEntry {
  id: string;
  /** "2:14 PM", "Yesterday", "Oct 31". */
  when: string;
  text: string;
  held: boolean;
}

export function TodayLog({
  entries,
  total,
  seeAllHref,
}: {
  entries: readonly TodayLogEntry[];
  total: number;
  seeAllHref: string;
}) {
  return (
    <section className="bg-card ring-foreground/6 space-y-3 rounded-[22px] p-5 ring-1">
      <h2 className="heading flex items-baseline gap-2 text-base">
        Done on its own
        {total > 0 && (
          <span className="text-muted-foreground ms-auto text-sm font-normal tabular-nums">{total}</span>
        )}
      </h2>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing this week. What automations and plans do without you shows here.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 text-sm">
              <span className="text-muted-foreground w-16 shrink-0 tabular-nums">{e.when}</span>
              <span className="line-clamp-2 min-w-0 flex-1">
                {e.held && (
                  <span
                    role="img"
                    aria-label="Held back"
                    className="me-1.5 inline-block size-1.5 rounded-full bg-(--attention) align-middle"
                  />
                )}
                {e.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={seeAllHref}
        scroll={false}
        className="text-muted-foreground hover:text-foreground focus-glow inline-block rounded-md text-sm font-medium outline-none"
      >
        See all
      </Link>
    </section>
  );
}
