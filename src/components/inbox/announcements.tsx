"use client";

import { ChartLine, Megaphone } from "@/components/icons";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";

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
import { Segmented } from "@/components/ui/segmented";
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
  editAnnouncement,
  markAnnouncementsSeen,
  postAnnouncement,
  restoreAnnouncement,
} from "@/server/announcements/actions";
import {
  BODY_MAX,
  seenPercent,
  TITLE_MAX,
  type AnnouncementsView,
  type SignupInsight,
} from "@/server/announcements/rules";

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

/** This week's recap, ready to post (title and text as loadRecapWeek writes them). */
export interface RecapDraft {
  title: string;
  text: string;
}

/** The This week view, drawn by the page: the recap's seven days and the recap itself. */
export interface WeekRecap {
  /** "Oct 25 to Oct 31", beside the title; null when the recap didn't load. */
  range: string | null;
  body: ReactNode;
}

/**
 * Announcements at the top of the Inbox, above its tabs, in two views
 * switched in its header (the page's ?news= param):
 *
 * - Announcements: the latest few posts, each with who posted it and when,
 *   how many members have seen it and the event it's about; a post opens to
 *   its full text. One fact under the list (sign-ups after a post), and the
 *   dashed row at the foot posts: this week's recap when it's ready (Friday
 *   to Sunday, until it goes out), else anything. ↗ opens every post. Every
 *   post shown counts as seen.
 * - This week: the viewer's own recap of the last seven days, with Copy and
 *   Post as an announcement at its foot. ↗ opens Pulse.
 */
export function InboxAnnouncements({
  orgId,
  items,
  events,
  total,
  seeAllHref,
  recap,
  view,
  viewHrefs,
  week,
  pulseHref,
}: {
  orgId: string;
  items: InboxAnnouncement[];
  events: AnnouncementEventOption[];
  /** Every announcement the organization has (0: only the composer shows). */
  total: number;
  seeAllHref: string;
  recap: RecapDraft | null;
  view: AnnouncementsView;
  /** Where each view's switch goes (the Inbox with its tab kept). */
  viewHrefs: Record<AnnouncementsView, string>;
  /** The This week view's content, when it's the one open. */
  week: WeekRecap | null;
  pulseHref: string;
}) {
  const [open, setOpen] = useState<InboxAnnouncement | null>(null);
  const marked = useRef(new Set<string>());
  const onPosts = view === "posts";

  // Shown is seen: mark the ones this member hasn't seen yet, once each.
  useEffect(() => {
    if (!onPosts) return;
    const fresh = items.filter((a) => !a.seenByMe && !marked.current.has(a.id)).map((a) => a.id);
    if (fresh.length === 0) return;
    for (const id of fresh) marked.current.add(id);
    void markAnnouncementsSeen(orgId, fresh).catch(() => {});
  }, [items, onPosts, orgId]);

  // One fact for the list, from the newest post that has one.
  const withInsight = items.find((a) => a.insight);
  const none = items.length === 0 && total === 0;

  return (
    <section
      aria-labelledby="inbox-announcements"
      className="bg-card ring-foreground/6 edge rounded-card flex flex-col gap-1 p-5 ring-1"
    >
      {/* On a phone the switch drops to its own line under the title. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <h2 id="inbox-announcements" className="heading text-[17px] leading-snug">
          Announcements
        </h2>
        {!onPosts && week?.range && (
          <span className="text-muted-foreground text-[13px] whitespace-nowrap">{week.range}</span>
        )}
        <span className="flex-1" />
        <Segmented
          label="Show"
          value={view}
          options={[
            { value: "posts", label: "Announcements", href: viewHrefs.posts },
            { value: "week", label: "This week", href: viewHrefs.week },
          ]}
          className="order-last sm:order-none"
        />
        {onPosts ? (
          !none && <OpenLink href={seeAllHref} label="All announcements" />
        ) : (
          <OpenLink href={pulseHref} label="Pulse" />
        )}
      </div>
      {!onPosts ? (
        <div className="pt-3">{week?.body}</div>
      ) : none ? (
        <Composer orgId={orgId} events={events} recap={recap} empty />
      ) : items.length > 0 ? (
        <ul className="flex flex-col">
          {items.map((a) => (
            <AnnouncementRow key={a.id} item={a} onOpen={() => setOpen(a)} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground py-2 text-sm">Nothing posted in the last two weeks.</p>
      )}
      {onPosts && withInsight?.insight && (
        <Insight icon={ChartLine} className="mt-1">
          <b>{withInsight.insight.count}</b>{" "}
          {withInsight.insight.rest.replace("this was posted", `“${withInsight.title}” was posted`)}
        </Insight>
      )}
      {onPosts && !none && <Composer orgId={orgId} events={events} recap={recap} />}
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
 * The dashed row at the foot: a button that opens a small composer (title,
 * message, and an event it's about). At the end of the week, while this
 * week's recap hasn't gone out, the row offers it, and Review and post opens
 * the composer with the recap in it to read over first. With nothing posted
 * yet it is all the Announcements view shows.
 */
function Composer({
  orgId,
  events,
  recap,
  empty = false,
}: {
  orgId: string;
  events: AnnouncementEventOption[];
  recap: RecapDraft | null;
  empty?: boolean;
}) {
  const router = useRouter();
  const [writing, setWriting] = useState(false);
  const [pending, start] = useTransition();
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

  if (!writing) {
    return (
      <div className="border-border rounded-tile mt-2 flex items-center gap-3 border-[1.5px] border-dashed px-3.5 py-3">
        <span className="text-muted-foreground flex-1 text-[13.5px]">
          {recap ? (
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
        {recap ? (
          <Button
            size="sm"
            onClick={() => {
              setTitle(recap.title);
              setBody(recap.text);
              setWriting(true);
            }}
          >
            Review and post
          </Button>
        ) : (
          <Button size="sm" onClick={() => setWriting(true)}>
            <Megaphone data-icon="inline-start" aria-hidden="true" />
            {empty ? "Post the first announcement" : "Post an announcement"}
          </Button>
        )}
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
