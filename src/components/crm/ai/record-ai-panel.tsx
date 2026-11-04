"use client";

import {
  ClipboardPaste,
  Copy,
  FileText,
  Globe,
  Inbox,
  Loader2,
  Mail,
  NotebookPen,
  RotateCcw,
  Sparkles,
  Upload,
  Zap,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  briefAction,
  draftFollowUpAction,
  enrichAction,
  researchAction,
  summarizeAction,
  transcriptAction,
} from "@/app/app/[orgSlug]/crm/ai-actions";
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
import { chipClass, Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { BriefData } from "@/lib/crm/ai-outputs";
import { crmApprovalsHref } from "@/lib/crm/href";
import { cn } from "@/lib/utils";

import { OpenDraftDialog } from "../outreach/compose";
import { PasteConversation } from "./ai-bar";

type Kind = "person" | "company" | "deal";

function since(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Fail = { ok: false; error: string; code?: string };

function failToast(r: Fail | null) {
  toast({
    title: r?.error ?? "That didn't work. Try again.",
    tone: "error",
  });
}

export function RecordAiPanel({
  orgId,
  orgSlug,
  kind,
  id,
  name,
  email,
  readOnly,
  summary: initial,
  waiting,
  connection,
  sources = [],
}: {
  orgId: string;
  orgSlug: string;
  kind: Kind;
  id: string;
  name: string;
  email: string | null;
  readOnly: boolean;
  summary: { text: string; points: string[]; at: string } | null;
  waiting: number;
  connection: string | null;
  /** Where AI and connector values on this record came from. */
  sources?: { label: string; from: string; url: string | null; at: string; via: string }[];
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string; to: string[]; notes: string[] } | null>(null);
  /** The draft, opened in compose (a person in the CRM with an address). */
  const [composeDraft, setComposeDraft] = useState<{ id: string; note: string | null } | null>(null);
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [brief, setBrief] = useState<(BriefData & { at: string }) | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const summarize = async () => {
    setBusy("summary");
    const r = await summarizeAction(orgId, kind, id).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return failToast(r as Fail | null);
    setSummary({ text: r.text, points: r.points, at: r.at });
  };

  const runDraft = async () => {
    setBusy("draft");
    const r = await draftFollowUpAction(orgId, kind, id, purpose.trim() || undefined).catch(() => null);
    setBusy(null);
    setPurposeOpen(false);
    if (!r || !r.ok) return failToast(r as Fail | null);
    if (r.draftId) setComposeDraft({ id: r.draftId, note: r.notes.join(" ") || null });
    else setDraft({ subject: r.subject, body: r.body, to: r.to, notes: r.notes });
    router.refresh();
  };

  const runBrief = async () => {
    setBusy("brief");
    const r = await briefAction(orgId, kind, id).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return failToast(r as Fail | null);
    setBrief(r);
  };

  const runEnrich = async () => {
    setBusy("enrich");
    const r = await enrichAction(orgId, kind, id).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return failToast(r as Fail | null);
    if (!r.provider) {
      const tried = r.tried.filter((t) => t.result !== "skipped");
      toast({
        title: tried.length ? "No connector found anything new." : "No data connector to try yet.",
        description: tried.length
          ? tried.map((t) => `${t.step}: ${t.result === "error" ? (t.detail ?? "failed") : "nothing"}`).join(". ")
          : "Connect Tavily, Hunter or Prospeo in Integrations and apps (or use a Claude key, which can search the web).",
      });
      return;
    }
    toast({
      title: r.filled.length ? `Filled ${r.filled.length} ${r.filled.length === 1 ? "field" : "fields"} from ${r.provider}.` : `${r.provider} had nothing for the empty fields.`,
      description: r.suggested ? "Some differ from what's there now: they wait in To approve." : undefined,
      tone: "success",
    });
    router.refresh();
  };

  const runResearch = async () => {
    setBusy("research");
    const r = await researchAction(orgId, kind, id).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return failToast(r as Fail | null);
    toast({
      title: r.status === "done" ? "Research done. The brief and any details wait in To approve." : "The research agent stopped. Its run log in CRM settings says why.",
      tone: r.status === "done" ? "success" : "default",
    });
    router.refresh();
  };

  const tool = (key: string, label: string, Icon: typeof Sparkles, onClick: () => void, title?: string) => (
    <Button key={key} size="sm" variant="outline" disabled={busy !== null || readOnly} onClick={onClick} title={title}>
      {busy === key ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
      {label}
    </Button>
  );

  return (
    <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1" aria-labelledby={`ai-${id}`}>
      <div className="flex items-center gap-2">
        <h2 id={`ai-${id}`} className="heading flex-1 text-base">
          Where we stand
        </h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label={summary ? "Summarize again" : "Summarize"}
          title={summary ? "Summarize again" : "Summarize"}
          disabled={busy !== null || readOnly}
          onClick={summarize}
        >
          {busy === "summary" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : summary ? <RotateCcw className="size-4" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
        </Button>
      </div>
      {summary ? (
        <div className="space-y-2">
          <p className="text-[14.5px] leading-relaxed">{summary.text}</p>
          {summary.points.length > 0 && (
            <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-sm">
              {summary.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">Summarized {since(summary.at)}. Check anything important against the timeline.</p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {connection ? (
            <>
              A short summary from the timeline, on {connection}.{" "}
              <button type="button" className="text-foreground font-medium underline-offset-2 hover:underline" disabled={busy !== null || readOnly} onClick={summarize}>
                Summarize
              </button>
            </>
          ) : (
            <>
              Connect your organization&apos;s AI model in{" "}
              <Link href={`/app/${orgSlug}/integrations`} className="text-foreground font-medium underline-offset-2 hover:underline">
                Integrations and apps
              </Link>{" "}
              to summarize, draft and research here.
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {tool("draft", "Draft a follow-up", Mail, () => setPurposeOpen(true))}
        {tool("brief", "Brief me", FileText, runBrief, "Before a meeting: history, open promises, talking points")}
        {tool("notes", "Meeting notes", NotebookPen, () => setNotesOpen(true), "Paste or upload notes or a transcript")}
        {kind === "person" && tool("paste", "Paste a chat", ClipboardPaste, () => setPasteOpen(true))}
        {kind !== "deal" && tool("enrich", "Enrich", Zap, runEnrich, "Fill empty fields from your data connectors")}
        {kind !== "deal" && tool("research", "Research", Globe, runResearch, "Search the web and suggest a brief")}
      </div>
      {sources.length > 0 && (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer select-none">Where {sources.length === 1 ? "one value" : `${sources.length} values`} came from</summary>
          <ul className="mt-2 space-y-1">
            {sources.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">
                  from{" "}
                  {s.url && /^https?:\/\//.test(s.url) ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline-offset-2 hover:underline">
                      {s.from}
                    </a>
                  ) : (
                    s.from
                  )}
                  , {since(s.at)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {waiting > 0 && (
        <Link href={crmApprovalsHref(orgSlug)} className="bg-tint-info text-tint-info-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:opacity-90">
          <Inbox className="size-4" aria-hidden="true" />
          {waiting} {waiting === 1 ? "suggestion waits" : "suggestions wait"} in To approve
        </Link>
      )}

      <Dialog open={purposeOpen} onOpenChange={setPurposeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Draft a follow-up to {name}</DialogTitle>
            <DialogDescription>From the timeline. You read and send it yourself; nothing is sent for you.</DialogDescription>
          </DialogHeader>
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What it's about (optional): thank them for the tour" maxLength={500} aria-label="What it's about" />
          <DialogFooter>
            <Button onClick={runDraft} disabled={busy === "draft"}>
              {busy === "draft" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {busy === "draft" ? "Writing…" : "Draft it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.subject}</DialogTitle>
            <DialogDescription>{draft?.to.length ? `To ${draft.to.join(", ")}. ` : ""}They have no email address in the CRM, so copy it or open it in your own email.</DialogDescription>
          </DialogHeader>
          <pre className="bg-muted/45 max-h-80 overflow-auto rounded-2xl p-4 font-sans text-sm whitespace-pre-wrap">{draft?.body}</pre>
          {draft?.notes.length ? <p className="text-muted-foreground text-xs">{draft.notes.join(" ")}</p> : null}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(`${draft?.subject}\n\n${draft?.body}`).catch(() => undefined);
                toast({ title: "Copied." });
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              Copy
            </Button>
            {email && draft && (
              <Button asChild>
                <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}>
                  <Mail className="size-4" aria-hidden="true" />
                  Open in my email
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {composeDraft && (
        <OpenDraftDialog orgId={orgId} draftId={composeDraft.id} note={composeDraft.note} onClose={() => setComposeDraft(null)} />
      )}

      <Dialog open={brief !== null} onOpenChange={(o) => !o && setBrief(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Brief: {name}</DialogTitle>
            <DialogDescription>From the record, past meetings and notes, open tasks, files and payments.</DialogDescription>
          </DialogHeader>
          {brief && (
            <div className="max-h-[60vh] space-y-4 overflow-auto text-sm">
              <p className="text-[14.5px] leading-relaxed">{brief.brief}</p>
              <BriefList title="Talking points" items={brief.talkingPoints} />
              <BriefList title="Open promises" items={brief.openPromises} />
              <BriefList title="Watch out for" items={brief.watchOuts} />
              {brief.notes.length > 0 && <p className="text-muted-foreground text-xs">{brief.notes.join(" ")}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MeetingNotes orgId={orgId} kind={kind} id={id} name={name} open={notesOpen} onOpenChange={setNotesOpen} onDone={() => router.refresh()} />
      {kind === "person" && <PasteConversation orgId={orgId} open={pasteOpen} onOpenChange={setPasteOpen} person={{ id, name }} />}
    </section>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-0.5 ps-5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

const SOURCES = [
  { value: "pasted", label: "Pasted" },
  { value: "granola", label: "Granola" },
  { value: "zoom", label: "Zoom" },
  { value: "meet", label: "Meet" },
  { value: "teams", label: "Teams" },
] as const;

/** Meeting or call notes, pasted or from a transcript file, into the timeline, tasks and changes (as suggestions). */
function MeetingNotes({
  orgId,
  kind,
  id,
  name,
  open,
  onOpenChange,
  onDone,
}: {
  orgId: string;
  kind: Kind;
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"] | "upload">("pasted");
  const [what, setWhat] = useState<"MEETING" | "CALL">("MEETING");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setBusy(true);
    const r = await transcriptAction(orgId, kind, id, { text, source, title: title || null, meetingDay: day, kind: what }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return failToast(r as Fail | null);
    const promises = r.reading.promises.length + r.reading.nextSteps.length;
    toast({
      title: `Read the ${what === "CALL" ? "call" : "meeting"}. ${r.queued} ${r.queued === 1 ? "suggestion waits" : "suggestions wait"} in To approve.`,
      description: promises ? `${promises} ${promises === 1 ? "promise or next step" : "promises and next steps"} became task suggestions.` : undefined,
      tone: "success",
    });
    setText("");
    setFile(null);
    setTitle("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Meeting notes with {name}</DialogTitle>
          <DialogDescription>
            Paste notes or a transcript, or upload one (.txt, .vtt, .srt, .md). You get a summary, next steps, objections and
            sentiment, and promises become tasks, all waiting in To approve.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="What it was"
              value={what}
              onSelect={(v) => setWhat(v as "MEETING" | "CALL")}
              options={[
                { value: "MEETING", label: "Meeting" },
                { value: "CALL", label: "Call" },
              ]}
            />
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-10 max-w-44" aria-label="When" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the notes are from">
            {SOURCES.map((s) => (
              <button key={s.value} type="button" className={cn(chipClass(source === s.value), "h-8 px-3 text-[13px]")} onClick={() => setSource(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional): Partnership call" maxLength={150} aria-label="Title" />
          {file ? (
            <p className="bg-muted/45 rounded-xl px-3 py-2 text-sm">
              {file}{" "}
              <button
                type="button"
                className="text-muted-foreground ms-1 underline-offset-2 hover:underline"
                onClick={() => {
                  setFile(null);
                  setText("");
                }}
              >
                Remove
              </button>
            </p>
          ) : (
            <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the notes or transcript here." aria-label="Notes or transcript" />
          )}
          <input
            ref={pick}
            type="file"
            accept=".txt,.vtt,.srt,.md,.sbv,text/plain,text/vtt,text/markdown"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 2_000_000) {
                toast({ title: "That file is too big (2 MB at most).", tone: "error" });
                return;
              }
              setText(await f.text());
              setFile(f.name);
              if (source === "pasted") setSource("upload");
            }}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => pick.current?.click()}>
            <Upload className="size-4" aria-hidden="true" />
            Upload a transcript
          </Button>
          <Button onClick={submit} disabled={busy || text.trim().length < 20}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? "Reading…" : "Read it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
