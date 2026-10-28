"use client";

import { ArrowLeft, Camera, Check, Search, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import { setGuestCheckedIn } from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { avatarTint } from "@/components/user-avatar";
import { doorScan, initials } from "@/lib/rsvp/format";
import { formatCents } from "@/lib/rsvp/pay";
import { cn } from "@/lib/utils";

/**
 * Door mode: the check-in screen a host keeps open at the entrance, made
 * for a phone. Search a name and tap, or scan guests' QR tickets with the
 * camera (where the browser can read QR codes; elsewhere the phone's own
 * camera app opens each ticket's check-in screen). Several hosts can run
 * doors at once: the list refreshes every 15 seconds.
 */

export interface DoorGuest {
  id: string;
  name: string;
  status: "GOING" | "WAITLIST";
  checkedIn: boolean;
  ticketCode: string;
  /** Split the cost: owes (cents), or null when paid or free. */
  owes: number | null;
  /** They said they paid; the host hasn't confirmed it yet. */
  saysPaid: boolean;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

type Flash = { tone: "ok" | "warn" | "bad"; title: string; detail?: string };

const REFRESH_MS = 15_000;

export function DoorMode({
  orgId,
  eventId,
  title,
  when,
  guests,
  backHref,
}: {
  orgId: string;
  eventId: string;
  title: string;
  when: string;
  guests: DoorGuest[];
  backHref: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  // A tap shows at once; the refresh after the save brings the server's list.
  const [list, setOptimistic] = useOptimistic(
    guests,
    (state, change: { id: string; checkedIn: boolean }) =>
      state.map((g) => (g.id === change.id ? { ...g, checkedIn: change.checkedIn } : g)),
  );
  const [flash, setFlash] = useState<Flash | null>(null);
  const [scanning, setScanning] = useState(false);
  const [, start] = useTransition();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const going = list.filter((g) => g.status === "GOING");
  const inCount = going.filter((g) => g.checkedIn).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((g) => (q ? g.name.toLowerCase().includes(q) : showAll || !g.checkedIn))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [list, query, showAll]);

  function say(next: Flash) {
    setFlash(next);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3200);
  }

  function checkIn(g: DoorGuest, value: boolean, method: "QR" | "MANUAL" = "MANUAL") {
    start(async () => {
      setOptimistic({ id: g.id, checkedIn: value });
      const result = await setGuestCheckedIn(orgId, eventId, g.id, value, method);
      if (result.error) {
        say({ tone: "bad", title: "That didn't save", detail: result.error });
        return;
      }
      if (value) {
        say(
          result.already
            ? { tone: "warn", title: `${g.name} was already in` }
            : {
                tone: g.owes !== null ? "warn" : "ok",
                title: `${g.name} is in`,
                detail:
                  g.owes === null
                    ? undefined
                    : g.saysPaid
                      ? `Says they paid ${formatCents(g.owes)}: check it`
                      : `Still owes ${formatCents(g.owes)}`,
              },
        );
      }
      router.refresh();
    });
  }

  function onScan(raw: string) {
    const scan = doorScan(list, raw);
    if (scan.kind === "unknown") {
      say({ tone: "bad", title: "Not a ticket for this event" });
    } else if (scan.kind === "already") {
      say({ tone: "warn", title: `${scan.guest.name} is already in` });
    } else if (scan.kind === "waitlist") {
      // Not checked in: the host decides, from the list.
      say({
        tone: "warn",
        title: `${scan.guest.name} is on the waitlist`,
        detail: "To let them in anyway, close the scanner and tap Check in on their name.",
      });
    } else {
      checkIn(scan.guest, true, "QR");
    }
  }

  return (
    <div className="bg-chrome text-chrome-foreground rounded-shell shadow-e3 mx-auto flex w-full max-w-2xl flex-col gap-5 p-5 pb-24 sm:p-8 sm:pb-24">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={backHref}
            className="group/back text-chrome-foreground/70 hover:text-chrome-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors"
          >
            <span className="border-chrome-foreground/25 group-hover/back:bg-chrome-foreground/10 grid size-8 place-items-center rounded-full border transition-colors">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </span>
            Guest list
          </Link>
          <h1 className="display-title mt-4 text-[clamp(28px,5vw,40px)] break-words">{title}</h1>
          <p className="text-chrome-foreground/70 mt-1.5 text-base">{when}</p>
        </div>
        <div className="flex-none text-right">
          <p className="numeral text-[56px] tabular-nums">
            {inCount}
            <span className="text-chrome-foreground/50 text-[28px]">/{going.length}</span>
          </p>
          <p className="text-chrome-foreground/70 mt-1 text-sm font-medium">checked in</p>
        </div>
      </div>

      <div
        className="bg-chrome-foreground/12 h-2.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`${inCount} of ${going.length} checked in`}
      >
        <div
          className="bg-glow h-full rounded-full shadow-[0_0_12px_var(--glow)] transition-[width] duration-500 ease-(--ease-ink) motion-reduce:transition-none"
          style={{ width: `${going.length ? (inCount / going.length) * 100 : 0}%` }}
        />
      </div>

      <div className="flex gap-2">
        <label className="bg-chrome-foreground/8 focus-within:outline-chrome-foreground flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full px-5 focus-within:outline-2 focus-within:outline-offset-2">
          <Search className="text-chrome-foreground/60 size-5" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a guest"
            aria-label="Find a guest by name"
            className="placeholder:text-chrome-foreground/50 min-w-0 flex-1 bg-transparent text-lg outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => setQuery("")}
              className="hover:bg-chrome-foreground/10 grid size-8 place-items-center rounded-full"
            >
              <X className="text-chrome-foreground/70 size-5" aria-hidden="true" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="bg-chrome-foreground text-chrome focus-visible:outline-chrome-foreground flex h-14 items-center gap-2 rounded-full px-6 text-base font-semibold transition-transform outline-none focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97]"
        >
          <Camera className="size-5" aria-hidden="true" />
          Scan
        </button>
      </div>

      {!query && (
        <div className="flex gap-1.5 text-sm">
          {[
            [false, `Not in yet (${going.length - inCount})`],
            [true, `Everyone (${list.length})`],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={showAll === value}
              onClick={() => setShowAll(value as boolean)}
              className={cn(
                "h-9 rounded-full px-4 font-semibold transition-colors",
                showAll === value
                  ? "bg-chrome-foreground text-chrome"
                  : "bg-chrome-foreground/8 hover:bg-chrome-foreground/14",
              )}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map((g) => {
          const checked = g.checkedIn;
          return (
            <li
              key={g.id}
              className={cn(
                "bg-chrome-foreground/6 rounded-block flex items-center gap-4 p-3 ps-4",
                checked && "opacity-75",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-11 flex-none place-items-center rounded-full text-sm font-bold",
                  avatarTint(g.name),
                )}
              >
                {initials(g.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xl font-semibold">{g.name}</span>
                <span className="text-chrome-foreground/65 block text-sm">
                  {[
                    g.status === "WAITLIST" ? "Waitlist" : null,
                    g.owes === null
                      ? null
                      : g.saysPaid
                        ? `Says they paid ${formatCents(g.owes)}`
                        : `Owes ${formatCents(g.owes)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || (checked ? "Checked in" : "Going")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => checkIn(g, !checked)}
                className={cn(
                  "flex h-14 min-w-32 items-center justify-center gap-1.5 rounded-full px-5 text-lg font-semibold transition-[background-color,transform] active:scale-[0.97]",
                  checked
                    ? "bg-block-goal text-block-goal-foreground"
                    : "bg-chrome-foreground text-chrome",
                )}
                aria-label={checked ? `Undo ${g.name}'s check-in` : `Check in ${g.name}`}
              >
                {checked ? (
                  <>
                    <Check className="size-5" aria-hidden="true" /> In
                  </>
                ) : (
                  "Check in"
                )}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-chrome-foreground/70 py-10 text-center text-lg">
            {query
              ? "Nobody by that name. Add them from the guest list."
              : going.length === 0
                ? "Nobody is going yet."
                : "Everyone's in. 🎉"}
          </li>
        )}
      </ul>

      {flash && (
        <div
          role="status"
          className={cn(
            "rounded-block shadow-e3 fixed inset-x-4 bottom-[calc(var(--shell-bottom,0px)+1rem)] z-50 mx-auto max-w-xl px-6 py-5",
            flash.tone === "ok" && "bg-block-goal text-block-goal-foreground",
            flash.tone === "warn" && "bg-block-answer text-block-answer-foreground",
            flash.tone === "bad" && "bg-block-alert text-block-alert-foreground",
          )}
        >
          <p className="text-xl font-bold">{flash.title}</p>
          {flash.detail && <p className="text-sm opacity-90">{flash.detail}</p>}
        </div>
      )}

      {scanning && <Scanner onClose={() => setScanning(false)} onScan={onScan} />}
    </div>
  );
}

/**
 * The camera, reading QR codes with the browser's BarcodeDetector. The
 * same ticket is ignored for a few seconds after a read, so holding a phone
 * up doesn't check someone in twice.
 */
const NO_DETECTOR =
  "This browser can't read QR codes. Open your phone's camera app and point it at a ticket instead: it opens that guest's check-in screen for you.";

function barcodeDetector(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

function Scanner({ onClose, onScan }: { onClose: () => void; onScan: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Opened from a tap, so this only ever runs in the browser.
  const [problem, setProblem] = useState<string | null>(() =>
    barcodeDetector() ? null : NO_DETECTOR,
  );
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recent = new Map<string, number>();
    const detector = new Detector({ formats: ["qr_code"] });

    async function tick() {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const now = Date.now();
          for (const c of codes) {
            if ((recent.get(c.rawValue) ?? 0) > now) continue;
            recent.set(c.rawValue, now + 4000);
            onScanRef.current(c.rawValue);
          }
        } catch {
          // A frame it couldn't read; try the next one.
        }
      }
      timer = setTimeout(() => void tick(), 250);
    }

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        void tick();
      })
      .catch(() =>
        setProblem("Bananasplit needs the camera to scan tickets. Allow it in your browser."),
      );

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black/90"
      role="dialog"
      aria-label="Scan tickets"
    >
      <div className="flex items-center justify-between p-4 text-white">
        <p className="font-semibold">Point at a guest&apos;s ticket</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold"
        >
          Done
        </button>
      </div>
      {problem ? (
        <p className="mx-auto max-w-sm p-6 text-center text-white/90">{problem}</p>
      ) : (
        <div className="relative flex flex-1 items-center justify-center">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <span
            aria-hidden="true"
            className="absolute size-64 rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          />
        </div>
      )}
    </div>
  );
}
