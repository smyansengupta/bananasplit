"use client";

import { Archive, FileText, Pencil, Plus } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { archiveTemplateAction, previewAction, saveTemplateAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { CrmPicker } from "@/components/crm/crm-picker";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { exampleValues, renderMerge } from "@/lib/crm/outreach/merge";
import { runAction } from "@/lib/run-action";

import { MergeMenu } from "./compose";

/**
 * Email templates: the organization's shared ones and your own, each with
 * merge fields, and a preview with example values or for a real person.
 */

export interface TemplateRow {
  id: string;
  name: string;
  category: string | null;
  subject: string | null;
  body: string;
  shared: boolean;
  mine: boolean;
  uses: number;
}

export function TemplatesView({ orgId, templates, canEditAll }: { orgId: string; templates: TemplateRow[]; canEditAll: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const archive = async (t: TemplateRow) => {
    const r = await runAction(() => archiveTemplateAction(orgId, t.id));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `Archived ${t.name}` });
    router.refresh();
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="create" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" />
          New template
        </Button>
      </div>
      {templates.length === 0 ? (
        <EmptyState icon={FileText} title="No templates yet" description="Write one message once, then send it to anyone with their own name and history in it." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id} className="bg-card ring-foreground/6 rounded-card flex flex-col gap-2 p-4 ring-1">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="heading truncate text-[15px]">{t.name}</p>
                  <p className="text-muted-foreground truncate text-sm">{t.subject || "No subject"}</p>
                </div>
                {!t.shared && <Badge variant="secondary">Just you</Badge>}
                {t.category && <Badge variant="outline">{t.category}</Badge>}
              </div>
              <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">{t.body}</p>
              <div className="mt-auto flex items-center gap-1 pt-1">
                <span className="text-muted-foreground flex-1 text-xs">{t.uses ? `Sent ${t.uses} times` : "Not sent yet"}</span>
                {(t.mine || canEditAll) && (
                  <>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} title="Edit" onClick={() => setEditing(t)}>
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Archive ${t.name}`} title="Archive" onClick={() => archive(t)}>
                      <Archive className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TemplateDialog
          orgId={orgId}
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  orgId,
  template,
  onClose,
  onSaved,
}: {
  orgId: string;
  template: TemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "Hi {{first_name|there}},\n\n\n\n{{my_first_name}}");
  const [shared, setShared] = useState(template?.shared ?? true);
  const [cursor, setCursor] = useState<number | null>(null);
  const [person, setPerson] = useState<{ id: string; label: string } | null>(null);
  const [real, setReal] = useState<{ subject: string; body: string; missing: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const example = useMemo(() => {
    const v = exampleValues();
    return { subject: renderMerge(subject, v), body: renderMerge(body, v) };
  }, [subject, body]);
  const unknown = [...new Set([...example.subject.unknown, ...example.body.unknown])];

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const at = cursor ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(at));
    setCursor(at + token.length);
  };

  const previewReal = async (id: string) => {
    const r = await runAction(() => previewAction(orgId, { subject, body }, [id]));
    if (!r || !r.ok) return;
    const row = r.rows[0];
    if (row) setReal({ subject: row.subject, body: row.body, missing: row.missing });
  };

  const save = async () => {
    setPending(true);
    const r = await runAction(() => saveTemplateAction(orgId, template?.id ?? null, { name, subject, body, shared }));
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Saved", tone: "success" });
    onSaved();
  };

  const shown = real ?? { subject: example.subject.text, body: example.body.text, missing: [] };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>Fields in double braces fill in for each person. Add a fallback after a bar: {"{{first_name|there}}"}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Subject</span>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
            </label>
            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center">
                <span className="text-muted-foreground flex-1">Message</span>
                <MergeMenu onPick={insert} />
              </div>
              <Textarea value={body} rows={11} onChange={(e) => setBody(e.target.value)} onSelect={(e) => setCursor(e.currentTarget.selectionStart)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="tpl-shared">Share with the organization</Label>
              <Switch id="tpl-shared" checked={shared} onCheckedChange={setShared} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground flex-1 text-sm">{real ? "For" : "With example values"}</span>
              <CrmPicker
                orgId={orgId}
                kind="person"
                value={person?.id ?? null}
                display={person?.label}
                placeholder="Preview for someone"
                onPick={(hit) => {
                  setPerson(hit ? { id: hit.id, label: hit.label } : null);
                  if (hit) previewReal(hit.id);
                  else setReal(null);
                }}
              />
            </div>
            <div className="bg-muted/50 min-h-48 space-y-2 rounded-2xl p-4">
              <p className="text-sm font-semibold">{shown.subject || "(no subject)"}</p>
              <p className="text-[15px] whitespace-pre-wrap">{shown.body}</p>
            </div>
            {unknown.length > 0 && <p className="text-tint-danger-foreground text-sm">There&apos;s no field called {unknown.map((u) => `{{${u}}}`).join(", ")}.</p>}
            {real && real.missing.length > 0 && <p className="text-muted-foreground text-sm">Empty for them: {real.missing.join(", ")}.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !name.trim() || !body.trim() || unknown.length > 0} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
