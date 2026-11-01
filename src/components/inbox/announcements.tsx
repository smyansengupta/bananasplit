"use client";

import { ChartLine, Megaphone } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import { OpenLink } from "@/components/overview/bits";
import { Insight, LinkChips, type ItemRef } from "@/components/overview/connections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { runAction } from "@/lib/run-action";
import { tagVar } from "@/lib/tag-colors";
import {
  deleteAnnouncement,
  draftRecapAnnouncement,
  editAnnouncement,
  markAnnouncementsSeen,
  postAnnouncement,
  restoreAnnouncement,
} from "@/server/announcements/actions";
import { BODY_MAX, seenPercent, TITLE_MAX, type SignupInsight } from "@/server/announcements/rules";

/** One announcement as the Inbox draws it. */
export interface InboxAnnouncement {
  id: string;
  title: string;
  body: string;
  author: UserAvatarUser | null;
  /** "Kristine, Tue". */
  byline: string;
  seenCount: number;
  memberCount: number;
  seenByMe: boolean;
  links: ItemRef[];
  /** The author or an admin: Edit and Remove show. */
  canManage: boolean;
  /** Sign-ups for its event in the day after it went out (owners and admins). */
  insight: SignupInsight | null;
}

/** An event a new post can be about. */
export interface AnnouncementEventOption {
  id: string;
  label: string;
}

const NO_EVENT = "none";
const RUST: CSSProperties = {
  color: tagVar("rust"),
  background: `color-mix(in oklab, ${tagVar("rust")} 14%, transparent)`,
};

/**
 * Announcements at the top of the Inbox, above its tabs: the latest few
 * posts, each with who posted it and when, how many members have seen it and
 * the event it's about; a post opens to its full text. One fact under the
 * list (sign-ups after a post), and the dashed row at the foot posts: an
 * announcement, or this week's recap, drafted on the server when asked for
 * and read over before it goes out. Friday to Sunday, until the recap goes
 * out, the row nudges to post it. ↗ opens every post. Every post shown
 * counts as seen.
 */
export function InboxAnnouncements({
  orgId,
  items,
  events,
  total,
  seeAllHref,
  recapDue,
}: {
  orgId: string;
  items: InboxAnnouncement[];
  events: AnnouncementEventOption[];
  /** Every announcement the organization has (0: only the composer shows). */
  total: number;
  seeAllHref: string;
  /** Friday to Sunday, while this week's recap hasn't gone out: the foot nudges to post it. */
  recapDue: boolean;
}) {
  const [open, setOpen] = useState<InboxAnnouncement | null>(null);
  const marked = useRef(new Set<string>());

  // Shown is seen: mark the ones this member hasn't seen yet, once each.
  useEffect(() => {
    const fresh = items.filter((a) => !a.seenByMe && !marked.current.has(a.id)).map((a) => a.id);
    if (fresh.length === 0) return;
    for (const id of fresh) marked.current.add(id);
    void markAnnouncementsSeen(orgId, fresh).catch(() => {});
  }, [items, orgId]);

  // One fact for the list, from the newest post that has one.
  const withInsight = items.find((a) => a.insight);
  const none = items.length === 0 && total === 0;

  return (
    <section
      aria-labelledby="inbox-announcements"
      className="bg-card ring-foreground/6 edge rounded-card flex flex-col gap-1 p-5 ring-1"
    >
      <div className="flex items-center gap-2">
        <h2 id="inbox-announcements" className="heading flex-1 text-[17px] leading-snug">
          Announcements
        </h2>
        {!none && <OpenLink href={seeAllHref} label="All announcements" />}
      </div>
      {none ? (
        <Composer orgId={orgId} events={events} recapDue={recapDue} empty />
      ) : items.length > 0 ? (
        <ul className="flex flex-col">
          {items.map((a) => (
            <AnnouncementRow key={a.id} item={a} onOpen={() => setOpen(a)} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground py-2 text-sm">Nothing posted in the last two weeks.</p>
      )}
      {withInsight?.insight && (
        <Insight icon={ChartLine} className="mt-1">
          <b>{withInsight.insight.count}</b>{" "}
          {withInsight.insight.rest.replace("this was posted", `“${withInsight.title}” was posted`)}
        </Insight>
      )}
      {!none && <Composer orgId={orgId} events={events} recapDue={recapDue} />}
      <FullText orgId={orgId} item={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function AnnouncementRow({ item, onOpen }: { item: InboxAnnouncement; onOpen: () => void }) {
  // Seen once shown: count this member in while the server catches up.
  const seen = item.seenByMe ? item.seenCount : Math.min(item.seenCount + 1, item.memberCount);
  const pct = seenPercent(seen, item.memberCount);
  return (
    <li className="border-border/70 flex gap-3 border-b py-3.5 last:border-b-0">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-[11px]"
        style={RUST}
      >
        <Megaphone className="size-[17px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="focus-glow -mx-1 rounded-md px-1 text-left outline-none"
        >
          <span className="block font-semibold break-words hover:underline hover:underline-offset-4">
            {item.title}
          </span>
          <span className="text-muted-foreground mt-0.5 block text-[13px]">{item.byline}</span>
        </button>
        <span className="flex items-center gap-2.5 text-[13px]">
          <span
            className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Seen by"
            aria-valuemin={0}
            aria-valuemax={item.memberCount}
            aria-valuenow={seen}
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, background: tagVar("rust") }}
            />
          </span>
          <b className="font-semibold whitespace-nowrap">
            Seen by {seen} of {item.memberCount}
          </b>
        </span>
        <LinkChips items={item.links} />
      </span>
    </li>
  );
}

/** A post's full text, with Edit and Remove for its author and admins. */
function FullText({
  orgId,
  item,
  onClose,
}: {
  orgId: string;
  item: InboxAnnouncement | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const close = () => {
    setEditing(false);
    onClose();
  };

  const save = () =>
    item &&
    start(async () => {
      const result = await runAction(() => editAnnouncement(orgId, item.id, { title, body }));
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      close();
      router.refresh();
    });

  const remove = () =>
    item &&
    start(async () => {
      const result = await runAction(() => deleteAnnouncement(orgId, item.id));
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      close();
      toast({
        title: "Announcement removed",
        action: {
          label: "Undo",
          run: async () => {
            const back = await restoreAnnouncement(orgId, item.id);
            if (!back.ok) return back.error;
            router.refresh();
          },
        },
      });
      router.refresh();
    });

  return (
    <Dialog open={item !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        {item && !editing && (
          <>
            <DialogHeader>
              <DialogTitle>{item.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                {item.author && <UserAvatar user={item.author} size="xs" />}
                {item.byline}
              </DialogDescription>
            </DialogHeader>
            {item.body ? (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{item.body}</p>
            ) : null}
            <LinkChips items={item.links} />
            {item.canManage && (
              <DialogFooter>
                <Button variant="outline" disabled={pending} onClick={remove}>
                  Remove
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    setTitle(item.title);
                    setBody(item.body);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              </DialogFooter>
            )}
          </>
        )}
        {item && editing && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit announcement</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="announcement-edit-title">Title</Label>
              <Input
                id="announcement-edit-title"
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="announcement-edit-body">Message</Label>
              <Textarea
                id="announcement-edit-body"
                value={body}
                maxLength={BODY_MAX}
                rows={6}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dashed row at the foot: Post an announcement opens a small composer
 * (title, message, and an event it's about), and Post this week's recap
 * opens it with the recap in it, written on the server as any member would
 * see it, to read over and edit first. Friday to Sunday, while this week's
 * recap hasn't gone out, the recap is the row's main button. With nothing
 * posted yet it is all the card shows.
 */
function Composer({
  orgId,
  events,
  recapDue,
  empty = false,
}: {
  orgId: string;
  events: AnnouncementEventOption[];
  recapDue: boolean;
  empty?: boolean;
}) {
  const router = useRouter();
  const [writing, setWriting] = useState(false);
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [eventId, setEventId] = useState(NO_EVENT);

  const reset = () => {
    setWriting(false);
    setTitle("");
    setBody("");
    setEventId(NO_EVENT);
  };

  const post = () =>
    start(async () => {
      const result = await runAction(() =>
        postAnnouncement(orgId, {
          title,
          body,
          eventId: eventId === NO_EVENT ? null : eventId,
        }),
      );
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      reset();
      toast({ title: "Posted to everyone" });
      router.refresh();
    });

  // The recap is written only when asked for, so the Inbox never loads it.
  const draftRecap = () => {
    if (drafting) return;
    startDraft(async () => {
      const result = await runAction(
        () => draftRecapAnnouncement(orgId),
        "Couldn't write the recap. Try again.",
      );
      if (!result) return;
      if (!result.ok) {
        toast(result.quiet ? { title: result.error } : { title: result.error, tone: "error" });
        return;
      }
      setTitle(result.title);
      setBody(result.body);
      setEventId(NO_EVENT);
      setWriting(true);
    });
  };

  if (!writing) {
    return (
      <div className="border-border rounded-tile mt-2 flex flex-wrap items-center gap-3 border-[1.5px] border-dashed px-3.5 py-3">
        <span className="text-muted-foreground min-w-48 flex-1 text-[13.5px]">
          {recapDue ? (
            <>
              <b className="text-foreground font-semibold">Ready to post:</b> this week&rsquo;s
              recap
            </>
          ) : empty ? (
            <>
              <b className="text-foreground font-semibold">No announcements yet.</b> Tell everyone
              something.
            </>
          ) : (
            "Tell everyone something."
          )}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={recapDue ? "outline" : "default"}
            onClick={() => setWriting(true)}
          >
            <Megaphone data-icon="inline-start" aria-hidden="true" />
            {empty ? "Post the first announcement" : "Post an announcement"}
          </Button>
          <Button
            size="sm"
            variant={recapDue ? "default" : "outline"}
            onClick={draftRecap}
            disabled={drafting}
            aria-busy={drafting || undefined}
          >
            <ChartLine data-icon="inline-start" aria-hidden="true" />
            {drafting ? "Writing the recap…" : "Post this week’s recap"}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <form
      aria-label="New announcement"
      className="border-border rounded-tile mt-2 grid gap-3 border-[1.5px] border-dashed p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        post();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="announcement-title">Title</Label>
        <Input
          id="announcement-title"
          value={title}
          maxLength={TITLE_MAX}
          placeholder="Fall Social is Friday, bring a friend"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="announcement-body">Message</Label>
        <Textarea
          id="announcement-body"
          value={body}
          maxLength={BODY_MAX}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {events.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="announcement-event">About an event</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger id="announcement-event" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_EVENT}>None</SelectItem>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Post to everyone
        </Button>
      </div>
    </form>
  );
}
