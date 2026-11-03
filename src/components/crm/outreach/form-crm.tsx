"use client";

import { Copy } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveFormDestinationAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { CRM_TARGETS, type CrmDestination, type CrmTargetKey } from "@/lib/crm/outreach/form-map";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A form's Settings: send each response to the CRM, as a person (found by
 * email, or added) and optionally an item in a pipeline, with each question
 * matched to a field, and a new person's owner by the organization's
 * routing.
 */
export function FormCrmEditor({
  orgId,
  formId,
  initial,
  suggested,
  questions,
  pipelines,
  types,
}: {
  orgId: string;
  formId: string;
  initial: CrmDestination | null;
  suggested: Record<string, CrmTargetKey>;
  questions: { id: string; title: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  types: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [object, setObject] = useState<"off" | "person" | "deal">(initial?.object ?? "off");
  const [pipelineId, setPipelineId] = useState<string | null>(initial?.pipelineId ?? pipelines[0]?.id ?? null);
  const [stageId, setStageId] = useState<string | null>(initial?.stageId ?? null);
  const [map, setMap] = useState<Record<string, CrmTargetKey>>(initial?.map ?? suggested);
  const [route, setRoute] = useState(initial?.route ?? false);
  const [relationship, setRelationship] = useState<string | null>(initial?.relationship ?? null);
  const [pending, setPending] = useState(false);
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const save = async () => {
    setPending(true);
    const r = await runAction(() =>
      saveFormDestinationAction(orgId, formId, object === "off" ? null : { object, pipelineId: object === "deal" ? pipelineId : null, stageId: object === "deal" ? stageId : null, map, route, relationship }),
    );
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: object === "off" ? "Responses stay in the form" : "Responses go to the CRM", tone: "success" });
    router.refresh();
  };
  return (
    <section className="bg-card edge rounded-card max-w-2xl space-y-4 p-5">
      <div>
        <h2 className="heading text-base">Send to the CRM</h2>
        <p className="text-muted-foreground text-sm">Each response finds the person by email, or adds them, and goes on their timeline.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Send to the CRM">
        {(
          [
            ["off", "No"],
            ["person", "As a person"],
            ["deal", "As a person and an item"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} type="button" className={cn(chipClass(object === v), "h-8 px-3")} onClick={() => setObject(v)}>
            {l}
          </button>
        ))}
      </div>
      {object === "deal" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pipeline">
            {pipelines.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cn(chipClass(pipelineId === p.id), "h-8 px-3")}
                onClick={() => {
                  setPipelineId(p.id);
                  setStageId(null);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          {pipeline && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage">
              {pipeline.stages.map((s, i) => (
                <button key={s.id} type="button" className={cn(chipClass((stageId ?? pipeline.stages[0]?.id) === s.id), "h-8 px-3")} onClick={() => setStageId(i === 0 ? null : s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {object !== "off" && (
        <>
          <div className="grid gap-2">
            <span className="text-muted-foreground text-sm">Which answer is which</span>
            {questions.map((q) => (
              <div key={q.id} className="grid grid-cols-[minmax(0,1fr)_12rem] items-center gap-2 text-sm">
                <span className="truncate">{q.title || "Untitled question"}</span>
                <FieldSelect
                  value={map[q.id] ?? ""}
                  onChange={(e) => {
                    const next = { ...map };
                    if (e.target.value) next[q.id] = e.target.value as CrmTargetKey;
                    else delete next[q.id];
                    setMap(next);
                  }}
                >
                  <option value="">On the timeline</option>
                  {CRM_TARGETS.filter((t) => t.key !== "note" && (object === "deal" || (t.key !== "itemTitle" && t.key !== "amount"))).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </FieldSelect>
              </div>
            ))}
          </div>
          {types.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Relationship">
              <button type="button" className={cn(chipClass(!relationship), "h-8 px-3")} onClick={() => setRelationship(null)}>
                No tag
              </button>
              {types.map((t) => (
                <button key={t.value} type="button" className={cn(chipClass(relationship === t.value), "h-8 px-3")} onClick={() => setRelationship(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="f-crm-route">Give new people an owner</Label>
              <p className="text-muted-foreground mt-0.5 text-[12px]">By your CRM's routing: in turn, or by rules. They're told, and it's in their Inbox.</p>
            </div>
            <Switch id="f-crm-route" checked={route} onCheckedChange={setRoute} />
          </div>
        </>
      )}
      <Button disabled={pending} onClick={save}>
        Save
      </Button>
    </section>
  );
}

/** The form on your own website: a button that opens it, no frame needed. */
export function FormEmbed({ link, title }: { link: string; title: string }) {
  const safe = title.replace(/[<>&"]/g, "");
  const snippet = `<a href="${link}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#1f1f1f;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none" onclick="window.open(this.href,'bananasplit-form','width=560,height=760');return false;">${safe}</a>`;
  return (
    <section className="bg-card edge rounded-card max-w-2xl space-y-3 p-5">
      <div>
        <h2 className="heading text-base">Put it on your website</h2>
        <p className="text-muted-foreground text-sm">Paste this where the button should go. It opens the form in a small window; forms can't sit inside another site's frame, for your visitors' safety.</p>
      </div>
      <pre className="bg-muted overflow-x-auto rounded-xl p-3 text-xs whitespace-pre-wrap">{snippet}</pre>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(snippet).catch(() => undefined);
          toast({ title: "Copied" });
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
        Copy the code
      </Button>
    </section>
  );
}
