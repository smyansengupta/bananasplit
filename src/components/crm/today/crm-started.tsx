"use client";

import {
  CalendarClock,
  Check,
  Copy,
  FileSpreadsheet,
  Handshake,
  Loader2,
  Mail,
  Phone,
  Sparkles,
  Target,
  UserPlus,
  Users,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { bringInAction, runSetupAction, startImportAction } from "@/app/app/[orgSlug]/crm/actions";
import { saveOrgKeyAction } from "@/app/app/[orgSlug]/crm/org-keys-actions";
import { saveMemberSettingsAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import {
  hideCrmStartedAction,
  myLoggingAddressAction,
  restoreCrmStartedAction,
  setCrmStepSkippedAction,
  shareOutOwnersAction,
  turnOnBookingAction,
} from "@/app/app/[orgSlug]/crm/settings-actions";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { useSheetUpload, type DroppedSheet } from "@/components/crm/settings/sheet-drop";
import {
  STARTED_FIELD,
  STARTED_RING,
  STARTED_SOLID,
  StartedBlock,
  StartedChips,
  StartedExtra,
  StartedHide,
  StartedSkip,
  StartedTile,
} from "@/components/overview/started-block";
import { toast } from "@/components/ui/toaster";
import { crmImportHref } from "@/lib/crm/href";
import { orgKeyInfo } from "@/lib/crm/org-keys";
import { crmSettingsHref } from "@/lib/crm/settings-sections";
import { OWNER_MODES, startingKinds, type OwnerMode } from "@/lib/crm/setup-owners";
import {
  bringInChoices,
  crmStartedHref,
  crmStartedProgress,
  type BringInChoice,
  type CrmStartedKey,
  type CrmStartedState,
  type CrmStartedViewer,
} from "@/lib/crm/started";
import { setupKindInfo, setupKindsFor, type SetupKind } from "@/lib/crm/templates";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { BringInCounts } from "@/server/crm/bring-in";

/**
 * "Get your CRM started" (docs/features/crm.md, "Getting started"): Home's
 * block across the top of Today. Every tile does its job right there: chips
 * to pick from, one-click buttons, a field. With no CRM yet, the first tile
 * is the only one, because its answer makes the CRM the others work in; the
 * rest appear once that's done. "Not needed" checks a step off, and Hide
 * checks off the rest, with Undo in the toast.
 */

const STEP_ICON: Record<CrmStartedKey, IconComponent> = {
  kinds: Handshake,
  people: UserPlus,
  owner: Users,
  mailbox: Mail,
  booking: CalendarClock,
  goal: Target,
  ai: Sparkles,
  phone: Phone,
};

type Outcome = { ok: boolean; error?: string };
type Run = <T extends Outcome>(
  step: CrmStartedKey,
  call: () => Promise<T>,
  done?: string | ((result: Extract<T, { ok: true }>) => string),
) => void;

function queuedLine(added: number, queued: number): string {
  if (queued > 0) return `${queued.toLocaleString("en-US")} are coming in the background.`;
  return added === 1 ? "One person brought in." : `${added.toLocaleString("en-US")} brought in.`;
}

export function CrmStarted({
  orgId,
  orgSlug,
  viewer,
  state,
  skipped,
  without,
  counts,
  inbound,
}: {
  orgId: string;
  orgSlug: string;
  viewer: CrmStartedViewer;
  state: CrmStartedState;
  skipped: CrmStartedKey[];
  without: CrmStartedKey[];
  counts: BringInCounts | null;
  inbound: boolean;
}) {
  const router = useRouter();
  const { setOpen } = useCrmOpen();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<CrmStartedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownSkipped, setShownSkipped] = useOptimistic(
    skipped as string[],
    (current: string[], change: { step: string; skip: boolean }) =>
      change.skip ? [...current, change.step] : current.filter((s) => s !== change.step),
  );
  const progress = crmStartedProgress(viewer, state, shownSkipped, without);
  const working = (step: CrmStartedKey) => pending && busy === step;

  const run: Run = (step, call, done) => {
    setError(null);
    setBusy(step);
    start(async () => {
      const result = await runAction(call);
      setBusy(null);
      if (!result) return;
      if (!result.ok) {
        setError(result.error ?? "That didn't work. Try again.");
        return;
      }
      const line =
        typeof done === "function" ? done(result as Extract<typeof result, { ok: true }>) : done;
      if (line) toast({ title: line });
      router.refresh();
    });
  };

  function toggle(step: CrmStartedKey, skip: boolean) {
    setError(null);
    setBusy(step);
    start(async () => {
      setShownSkipped({ step, skip });
      const result = await runAction(() => setCrmStepSkippedAction(orgId, step, skip));
      setBusy(null);
      if (!result) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function hideAll() {
    setError(null);
    start(async () => {
      const result = await runAction(() => hideCrmStartedAction(orgId));
      if (!result) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: "Hidden",
        action: {
          label: "Undo",
          run: async () => {
            const undone = await restoreCrmStartedAction(orgId, result.previous);
            if (!undone.ok) return undone.error;
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  }

  function pickOwner(mode: OwnerMode) {
    run(
      "owner",
      () => shareOutOwnersAction(orgId, mode, new Date(0).toISOString()),
      (r) => (r.shared ? `Shared out ${r.shared.toLocaleString("en-US")} people.` : "Saved."),
    );
  }

  const todo = progress.steps.filter((step) => step.status === "todo");
  const finished = progress.steps.filter((step) => step.status !== "todo");
  // Only an owner or admin can answer the first step; everyone else starts on their own.
  const made = state.kinds || !viewer.admin;

  function skip(step: CrmStartedKey) {
    return <StartedSkip working={working(step)} onClick={() => toggle(step, true)} />;
  }

  return (
    <StartedBlock
      title="Get your CRM started"
      steps={progress.steps.map((step) => ({ ...step, icon: STEP_ICON[step.key] }))}
      error={error}
      finished={
        <StartedChips
          steps={finished.map((step) => ({ ...step, href: crmStartedHref(orgSlug, step.key) }))}
          busy={pending ? busy : null}
          onUndo={(key) => toggle(key as CrmStartedKey, false)}
        />
      }
      foot={
        made ? (
          <>
            {viewer.admin && (
              <>
                <StartedExtra
                  href={crmSettingsHref(orgSlug, "automations")}
                  label="Turn on automations"
                />
                <StartedExtra href={crmImportHref(orgSlug)} label="Import from another CRM" />
              </>
            )}
            <StartedHide disabled={pending} onClick={hideAll} />
          </>
        ) : undefined
      }
    >
      {!made ? (
        <KindsTile
          orgId={orgId}
          personal={viewer.personal}
          hasPartners={(counts?.sponsors ?? 0) > 0}
          working={working("kinds")}
          run={run}
        />
      ) : (
        todo.map((step) => {
          const common = { icon: STEP_ICON[step.key], label: step.label, hint: step.hint };
          switch (step.key) {
            case "kinds":
              return null;
            case "people":
              return (
                <PeopleTile
                  key={step.key}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  choices={counts ? bringInChoices(counts, viewer.personal) : []}
                  working={working("people")}
                  run={run}
                  skip={skip("people")}
                  addOne={() => setOpen({ kind: "new", what: "person" })}
                />
              );
            case "owner":
              return (
                <StartedTile key={step.key} {...common}>
                  {OWNER_MODES.filter((m) => m.id !== "none").map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      title={m.text}
                      disabled={working("owner")}
                      onClick={() => pickOwner(m.id)}
                      className={i === 0 ? STARTED_SOLID : STARTED_RING}
                    >
                      {m.title}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={working("owner")}
                    title="Nobody owns them yet. Today reminds managers to hand them out."
                    onClick={() => toggle("owner", true)}
                    className={STARTED_RING}
                  >
                    Leave them for now
                  </button>
                </StartedTile>
              );
            case "mailbox":
              return (
                <MailTile
                  key={step.key}
                  orgId={orgId}
                  inbound={inbound}
                  working={working("mailbox")}
                  run={run}
                  skip={skip("mailbox")}
                />
              );
            case "booking":
              return (
                <StartedTile key={step.key} {...common}>
                  <button
                    type="button"
                    disabled={working("booking")}
                    onClick={() =>
                      run("booking", () => turnOnBookingAction(orgId), "Your meeting link is on.")
                    }
                    className={STARTED_SOLID}
                  >
                    Turn it on
                  </button>
                  {skip("booking")}
                </StartedTile>
              );
            case "goal":
              return (
                <StartedTile key={step.key} {...common}>
                  <button
                    type="button"
                    onClick={() => setOpen({ kind: "goal", id: null })}
                    className={STARTED_SOLID}
                  >
                    Set a goal
                  </button>
                  {skip("goal")}
                </StartedTile>
              );
            case "ai":
              return (
                <KeyTile
                  key={step.key}
                  orgId={orgId}
                  working={working("ai")}
                  run={run}
                  skip={skip("ai")}
                />
              );
            case "phone":
              return (
                <StartedTile key={step.key} {...common} href={crmStartedHref(orgSlug, "phone")}>
                  {skip("phone")}
                </StartedTile>
              );
          }
        })
      )}
    </StartedBlock>
  );
}

/** The first answer: what you mostly reach out to, filled in already, then one click. */
function KindsTile({
  orgId,
  personal,
  hasPartners,
  working,
  run,
}: {
  orgId: string;
  personal: boolean;
  hasPartners: boolean;
  working: boolean;
  run: Run;
}) {
  const offered = setupKindsFor(personal);
  const [kinds, setKinds] = useState<Set<SetupKind>>(
    () => new Set(startingKinds(personal, [], hasPartners)),
  );
  const flip = (kind: SetupKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  return (
    <StartedTile
      wide
      icon={STEP_ICON.kinds}
      label="Pick what you mostly reach out to"
      hint="It makes your pipelines and lists. You can add more later."
    >
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="What you mostly reach out to"
      >
        {offered.map((kind) => {
          const info = setupKindInfo(kind, personal);
          const on = kinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              title={info.hint}
              onClick={() => flip(kind)}
              className={cn(STARTED_RING, on && "bg-current/18 ring-current/70")}
            >
              {on && <Check className="size-3.5" aria-hidden="true" />}
              {info.label}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 basis-full">
        <button
          type="button"
          disabled={working || kinds.size === 0}
          onClick={() =>
            run("kinds", () => runSetupAction(orgId, [...kinds]), "Your CRM is ready.")
          }
          className={cn(STARTED_SOLID, "h-9 px-4 text-[13px]")}
        >
          {working && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {working ? "Setting up" : "Set up the CRM"}
        </button>
      </div>
    </StartedTile>
  );
}

/** Who's already here, one click each (or all at once), or a spreadsheet dropped on the tile. */
function PeopleTile({
  orgId,
  orgSlug,
  choices,
  working,
  run,
  skip,
  addOne,
}: {
  orgId: string;
  orgSlug: string;
  choices: BringInChoice[];
  working: boolean;
  run: Run;
  skip: React.ReactNode;
  addOne: () => void;
}) {
  const [sheet, setSheet] = useState<DroppedSheet | null>(null);
  const upload = useSheetUpload(orgSlug, setSheet);
  const total = choices.reduce((n, c) => n + c.n, 0);

  const bring = (sources: BringInChoice[]) =>
    run(
      "people",
      async () => {
        let added = 0;
        let queued = 0;
        for (const source of sources) {
          const r = await bringInAction(orgId, source.id);
          if (!r.ok) return r;
          added += r.added + r.linked;
          queued += r.queued;
        }
        return { ok: true as const, added, queued };
      },
      (r) => queuedLine(r.added, r.queued),
    );

  const bringSheet = (dropped: DroppedSheet) =>
    run(
      "people",
      () =>
        startImportAction(orgId, dropped.importId, {
          object: "person",
          mapping: dropped.mapping,
        }),
      (r) =>
        r.log.status === "done"
          ? queuedLine(r.log.created + r.log.updated, 0)
          : queuedLine(0, dropped.total),
    );

  return (
    <StartedTile
      wide
      icon={STEP_ICON.people}
      label="Bring people in"
      hint={
        sheet
          ? `${sheet.fileName}, ${sheet.total.toLocaleString("en-US")} rows. Columns are matched for you.`
          : "Pick who's already here, or drop a spreadsheet on this tile."
      }
      highlighted={upload.over}
      {...upload.zone}
    >
      {sheet ? (
        <>
          <button
            type="button"
            disabled={working}
            onClick={() => bringSheet(sheet)}
            className={STARTED_SOLID}
          >
            Bring in {sheet.total.toLocaleString("en-US")} rows
          </button>
          <button type="button" onClick={() => setSheet(null)} className={STARTED_RING}>
            Remove the file
          </button>
        </>
      ) : (
        <>
          {choices.length > 1 && (
            <button
              type="button"
              disabled={working}
              onClick={() => bring(choices)}
              className={STARTED_SOLID}
            >
              Bring in all {total.toLocaleString("en-US")}
            </button>
          )}
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              disabled={working}
              onClick={() => bring([choice])}
              className={choices.length === 1 ? STARTED_SOLID : STARTED_RING}
            >
              {choice.label} {choice.n.toLocaleString("en-US")}
            </button>
          ))}
          <button
            type="button"
            disabled={upload.busy}
            onClick={upload.pick}
            className={choices.length === 0 ? STARTED_SOLID : STARTED_RING}
          >
            <FileSpreadsheet className="size-3.5" aria-hidden="true" />
            {upload.busy ? "Reading" : "Choose a spreadsheet"}
          </button>
          {choices.length === 0 && (
            <button type="button" onClick={addOne} className={STARTED_RING}>
              Add someone
            </button>
          )}
          {skip}
        </>
      )}
      {upload.input}
    </StartedTile>
  );
}

/** Your signature, right on the tile, and your logging address when this server takes mail in. */
function MailTile({
  orgId,
  inbound,
  working,
  run,
  skip,
}: {
  orgId: string;
  inbound: boolean;
  working: boolean;
  run: Run;
  skip: React.ReactNode;
}) {
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    const result = await runAction(() => myLoggingAddressAction(orgId));
    if (!result) return;
    if (!result.ok || !result.address) {
      toast({ title: "Your address isn't ready yet. Try again.", tone: "error" });
      return;
    }
    await navigator.clipboard.writeText(result.address).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <StartedTile
      icon={STEP_ICON.mailbox}
      label="Set up your mail"
      hint="Add your signature. Gmail and Outlook connect here once they arrive."
    >
      <form
        className="flex w-full flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!signature.trim()) return;
          run("mailbox", () => saveMemberSettingsAction(orgId, { signature }), "Signature saved.");
        }}
      >
        <textarea
          rows={2}
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Your signature"
          aria-label="Your signature"
          className={cn(STARTED_FIELD, "w-full resize-none")}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="submit"
            disabled={working || !signature.trim()}
            className={STARTED_SOLID}
          >
            Save
          </button>
          {inbound && (
            <button
              type="button"
              title="BCC it, or forward mail to it, and the CRM logs that mail."
              onClick={() => void copyAddress()}
              className={STARTED_RING}
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy your logging address"}
            </button>
          )}
          {skip}
        </div>
      </form>
    </StartedTile>
  );
}

/** Paste a Claude key right on the tile; it's tested as it saves. */
function KeyTile({
  orgId,
  working,
  run,
  skip,
}: {
  orgId: string;
  working: boolean;
  run: Run;
  skip: React.ReactNode;
}) {
  const [key, setKey] = useState("");
  const info = orgKeyInfo("anthropic");
  return (
    <StartedTile
      icon={STEP_ICON.ai}
      label="Add your AI key"
      hint="Writes drafts and summaries. Nothing sends by itself."
    >
      <form
        className="flex w-full flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          run(
            "ai",
            () => saveOrgKeyAction(orgId, "anthropic", { apiKey: key.trim() }),
            "Your key works. AI is on.",
          );
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          aria-label="Your Claude API key"
          className={cn(STARTED_FIELD, "w-full")}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="submit" disabled={working || !key.trim()} className={STARTED_SOLID}>
            {working ? "Testing" : "Save key"}
          </button>
          {info && (
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className={STARTED_RING}>
              Get a key
            </a>
          )}
          {skip}
        </div>
      </form>
    </StartedTile>
  );
}
