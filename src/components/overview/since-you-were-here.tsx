"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { AmbientButton } from "@/components/ambient/ambient-button";
import { MessageCircle } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { markHomeSeen } from "@/server/overview/home-visit-actions";
import { SINCE_GROUP_LABEL, type SinceGroup } from "@/lib/overview/since-text";
import { runAction } from "@/lib/run-action";
import type { SinceYouWereHereData } from "@/server/overview/since-you-were-here";

import { Insight, LinkChips } from "./connections";
import { DismissNewcomer } from "./dismiss-newcomer";
import { Arrive, useUnseen } from "./fresh";

/**
 * Since you were here: what changed since your previous visit to Home,
 * grouped by area, each row with whose change it was and chips to what it
 * touched, and one line on top that says where the activity was. "Mark all
 * as seen" starts it again from now; "Only things for me" keeps the rows
 * that are about you. Data from loadSinceYouWereHere.
 */

const GROUPS: SinceGroup[] = ["assigned", "tasks", "notes", "people", "money"];

export function SinceYouWereHere({ orgId, data }: { orgId: string; data: SinceYouWereHereData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mine, setMine] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const unseen = useUnseen(
    `bs.since:${orgId}`,
    data.rows.map((r) => r.id),
  );

  if (data.sinceLabel === null) {
    return (
      <p className="text-muted-foreground text-sm">
        From your next visit, what changed while you were away shows here.
      </p>
    );
  }
  const left = data.rows.filter((r) => !r.newcomerId || !dismissed.includes(r.newcomerId));
  if (left.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing new since {data.sinceLabel}.</p>;
  }

  const rows = mine ? left.filter((r) => r.forMe) : left;
  const anyForMe = left.some((r) => r.forMe);

  const seen = () =>
    start(async () => {
      const done = await runAction(
        () => markHomeSeen(orgId),
        "Couldn't mark these as seen. Try again.",
      );
      if (done) router.refresh();
    });

  return (
    <div className="space-y-4">
      {data.insight && (
        <Insight>
          {data.insight.map((run, i) =>
            run.bold ? <b key={i}>{run.text}</b> : <Fragment key={i}>{run.text}</Fragment>,
          )}
        </Insight>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here is about you.</p>
      ) : (
        <div className="space-y-1">
          {GROUPS.map((group) => {
            const list = rows.filter((r) => r.group === group);
            if (list.length === 0) return null;
            return (
              <section key={group} aria-label={SINCE_GROUP_LABEL[group]}>
                <h3 className="text-muted-foreground pt-2 text-[12px] font-semibold">
                  {SINCE_GROUP_LABEL[group]}
                </h3>
                <ul className="divide-border divide-y">
                  {list.map((row) => (
                    <Arrive
                      key={row.id}
                      on={unseen.has(row.id)}
                      className="flex items-center gap-3 py-3"
                    >
                      {row.face ? (
                        <UserAvatar user={row.face} size="sm" className="size-7" />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="bg-muted grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                        >
                          {row.count}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <Link
                          href={row.href}
                          className="block text-[14.5px] leading-snug font-medium break-words hover:underline"
                        >
                          {row.title}
                        </Link>
                        {row.sub && (
                          <span className="text-muted-foreground mt-0.5 block text-[13px] break-words">
                            {row.sub}
                          </span>
                        )}
                        {/* Phones: the chips go under the words, not beside them. */}
                        <LinkChips items={row.chips.slice(0, 2)} className="mt-1.5 sm:hidden" />
                      </span>
                      {row.isNew ? (
                        <Badge variant="info">New</Badge>
                      ) : row.group === "people" && row.face && row.chips[0] ? (
                        // Ambient: someone new joined. Say hi on their page, or dismiss it.
                        <span className="flex shrink-0 items-center gap-1">
                          <AmbientButton
                            action={{
                              key: "say-hi",
                              label: "Say hi",
                              icon: MessageCircle,
                              reason: "Joined since you were here",
                              href: row.chips[0].href,
                            }}
                          />
                          {row.newcomerId && (
                            <DismissNewcomer
                              orgId={orgId}
                              personId={row.newcomerId}
                              name={row.chips[0].label}
                              onGone={() => setDismissed((ids) => [...ids, row.newcomerId!])}
                              onBack={() =>
                                setDismissed((ids) => ids.filter((id) => id !== row.newcomerId))
                              }
                            />
                          )}
                        </span>
                      ) : (
                        <LinkChips
                          items={row.chips.slice(0, 2)}
                          className="max-w-[45%] justify-end max-sm:hidden"
                        />
                      )}
                    </Arrive>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={seen} disabled={pending}>
          Mark all as seen
        </Button>
        {anyForMe && (
          <Button
            size="sm"
            variant={mine ? "secondary" : "outline"}
            aria-pressed={mine}
            onClick={() => setMine((v) => !v)}
          >
            Only things for me
          </Button>
        )}
      </div>
    </div>
  );
}
