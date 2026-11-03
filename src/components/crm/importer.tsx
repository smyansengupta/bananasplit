"use client";

import { Database, FileSpreadsheet, Upload } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { convertDatabaseAction, previewConvertAction, startImportAction } from "@/app/app/[orgSlug]/crm/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/ui/field-select";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { ACTIVITY_TARGET_LABELS, ACTIVITY_TARGETS, IMPORT_SOURCE_LABELS, type ImportSource, type Mapping } from "@/lib/crm/mapping";
import { cn } from "@/lib/utils";

/**
 * The importer (docs/features/crm.md: "Move in from a spreadsheet in
 * minutes"): what the rows are, the file, then each column matched to a
 * field (suggested, and remembered for the next file like it), then Start.
 * Small files finish at once; big ones run in the background. Below it,
 * turning one of your databases into CRM records.
 */

type Obj = "person" | "company" | "deal";

export interface TargetOption {
  value: string;
  label: string;
}

interface Uploaded {
  log: {
    id: string;
    fileName: string;
    source: ImportSource;
    headers: string[];
    total: number;
    mapping: Mapping;
  };
  sample: Record<string, string>[];
}

export interface RecentImport {
  id: string;
  fileName: string;
  status: string;
  total: number;
  done: number;
  created: number;
  updated: number;
  skipped: number;
  activities: number;
  createdAt: string;
}

const OBJECTS: { value: Obj; label: string }[] = [
  { value: "person", label: "People" },
  { value: "company", label: "Companies" },
  { value: "deal", label: "Pipeline items" },
];

export function Importer({
  orgId,
  orgSlug,
  targets,
  pipelines,
  databases,
  recent,
  initialPipeline,
}: {
  orgId: string;
  orgSlug: string;
  targets: Record<Obj, TargetOption[]>;
  pipelines: { id: string; name: string }[];
  databases: { id: string; name: string }[];
  recent: RecentImport[];
  initialPipeline: string | null;
}) {
  const router = useRouter();
  const [object, setObject] = useState<Obj>(initialPipeline ? "deal" : "person");
  const [pipelineId, setPipelineId] = useState<string | null>(initialPipeline ?? pipelines[0]?.id ?? null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async (file: File) => {
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("object", object);
    const res = await fetch(`/app/${orgSlug}/crm/import/upload`, { method: "POST", body }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !data || data.error) {
      toast({ title: data?.error ?? "That file couldn't be read.", tone: "error" });
      return;
    }
    setUploaded(data as Uploaded);
    setMapping((data as Uploaded).log.mapping);
  };

  const options = [
    { value: "", label: "Skip this column" },
    ...targets[object],
    ...ACTIVITY_TARGETS.map((t) => ({ value: t, label: ACTIVITY_TARGET_LABELS[t] })),
  ];

  return (
    <div className="space-y-7">
      <Card className="gap-5 p-6">
        <div className="space-y-2">
          <h2 className="display-title text-[20px]">What's in the file?</h2>
          <div className="flex flex-wrap gap-1.5">
            {OBJECTS.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={Boolean(uploaded)}
                aria-pressed={object === o.value}
                onClick={() => setObject(o.value)}
                className={chipClass(object === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {object === "deal" && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {pipelines.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={pipelineId === p.id}
                  onClick={() => setPipelineId(p.id)}
                  className={cn(chipClass(pipelineId === p.id), "h-8 px-3 text-[13px]")}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {!uploaded ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void send(f);
            }}
            className={cn(
              "border-input flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center",
              drag && "bg-muted",
            )}
          >
            <Upload className="text-muted-foreground size-6" aria-hidden="true" />
            <p className="text-sm">Drop a file here, or choose one.</p>
            <p className="text-muted-foreground text-xs">
              CSV or Excel, a vCard (.vcf), or an export from Notion, Airtable, HubSpot, Salesforce or Pipedrive. Up to 4 MB.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,.vcf,.vcard"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void send(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              {busy ? "Reading…" : "Choose a file"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <b>{uploaded.log.fileName}</b>
              <Badge variant="secondary">{IMPORT_SOURCE_LABELS[uploaded.log.source]}</Badge>
              <span className="text-muted-foreground text-sm">{uploaded.log.total.toLocaleString()} rows</span>
              <button type="button" className="text-muted-foreground ms-auto text-sm hover:underline" onClick={() => setUploaded(null)}>
                Pick another file
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="py-2 pe-3 font-semibold">Column</th>
                    <th className="py-2 pe-3 font-semibold">Goes into</th>
                    <th className="py-2 font-semibold">First rows</th>
                  </tr>
                </thead>
                <tbody>
                  {uploaded.log.headers.map((h) => (
                    <tr key={h} className="border-border border-t">
                      <td className="py-2 pe-3 font-semibold">{h}</td>
                      <td className="py-2 pe-3">
                        <FieldSelect
                          value={mapping[h] ?? ""}
                          onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value || null }))}
                          aria-label={`Where ${h} goes`}
                          className="w-56"
                        >
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </FieldSelect>
                      </td>
                      <td className="text-muted-foreground max-w-80 truncate py-2">
                        {uploaded.sample
                          .map((r) => r[h])
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={remember} onCheckedChange={setRemember} />
              Remember these for the next file like this
            </label>
            <p className="text-muted-foreground text-sm">
              Someone already in the CRM (by email, or a company by domain or name) gets only their empty fields filled. Notes and
              activity land on their timeline.
            </p>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await startImportAction(orgId, uploaded.log.id, {
                  object,
                  mapping,
                  pipelineId: object === "deal" ? pipelineId : null,
                  remember,
                }).catch(() => null);
                setBusy(false);
                if (!r || !r.ok) {
                  toast({ title: r && !r.ok ? r.error : "That didn't start.", tone: "error" });
                  return;
                }
                const l = r.log;
                toast({
                  title:
                    l.status === "done"
                      ? `Done: ${l.created} added, ${l.updated} updated${l.skipped ? `, ${l.skipped} skipped` : ""}.`
                      : `Importing ${l.total.toLocaleString()} rows in the background.`,
                });
                setUploaded(null);
                router.refresh();
              }}
            >
              {busy ? "Starting…" : `Bring in ${uploaded.log.total.toLocaleString()} rows`}
            </Button>
          </div>
        )}
      </Card>

      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="heading flex-1 text-base">Your recent imports</h2>
            <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
              Refresh
            </Button>
          </div>
          <Card className="divide-border divide-y p-0">
            {recent.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <b className="min-w-0 flex-1 truncate">{r.fileName}</b>
                <Badge variant={r.status === "done" ? "success" : r.status === "failed" ? "destructive" : "secondary"}>
                  {r.status === "done" ? "Done" : r.status === "mapping" ? "Not started" : r.status === "failed" ? "Failed" : `${r.done} of ${r.total}`}
                </Badge>
                <span className="text-muted-foreground">
                  {r.created} added, {r.updated} updated{r.skipped ? `, ${r.skipped} skipped` : ""}
                  {r.activities ? `, ${r.activities} notes` : ""}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {databases.length > 0 && <ConvertDatabase orgId={orgId} databases={databases} targets={targets} />}
    </div>
  );
}

function ConvertDatabase({
  orgId,
  databases,
  targets,
}: {
  orgId: string;
  databases: { id: string; name: string }[];
  targets: Record<Obj, TargetOption[]>;
}) {
  const router = useRouter();
  const [databaseId, setDatabaseId] = useState<string>("");
  const [object, setObject] = useState<"person" | "company">("person");
  const [preview, setPreview] = useState<{ fields: { id: string; name: string }[]; mapping: Mapping; rows: number; linked: number } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const load = async (id: string, obj: "person" | "company") => {
    if (!id) return setPreview(null);
    const r = await previewConvertAction(orgId, id, obj).catch(() => null);
    if (!r || !r.ok) {
      toast({ title: r && !r.ok ? r.error : "That didn't load.", tone: "error" });
      return;
    }
    setPreview(r.preview);
    setMapping(r.preview.mapping);
  };
  return (
    <Card className="gap-4 p-6">
      <h2 className="display-title flex items-center gap-2 text-[20px]">
        <Database className="size-5" aria-hidden="true" />
        Turn a database into CRM records
      </h2>
      <p className="text-muted-foreground text-sm">
        An old sponsor sheet, form answers or an alumni list: each row becomes a person or a company, and the database keeps a link
        column to the record each row made.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <FieldSelect
          value={databaseId}
          onChange={(e) => {
            setDatabaseId(e.target.value);
            void load(e.target.value, object);
          }}
          aria-label="Database"
          className="w-64"
        >
          <option value="">Pick a database</option>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </FieldSelect>
        {(["person", "company"] as const).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={object === o}
            onClick={() => {
              setObject(o);
              void load(databaseId, o);
            }}
            className={cn(chipClass(object === o), "h-9")}
          >
            {o === "person" ? "People" : "Companies"}
          </button>
        ))}
      </div>
      {preview && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {preview.rows} rows{preview.linked ? `, ${preview.linked} already turned into records` : ""}.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {preview.fields.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate font-semibold">{f.name}</span>
                <FieldSelect value={mapping[f.name] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.name]: e.target.value || null }))} aria-label={`Where ${f.name} goes`} className="min-w-0 flex-1">
                  <option value="">Skip</option>
                  {targets[object].map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </FieldSelect>
              </label>
            ))}
          </div>
          <Button
            disabled={busy || preview.rows === preview.linked}
            onClick={async () => {
              setBusy(true);
              const r = await convertDatabaseAction(orgId, databaseId, { object, mapping }).catch(() => null);
              setBusy(false);
              if (!r || !r.ok) {
                toast({ title: r && !r.ok ? r.error : "That didn't work.", tone: "error" });
                return;
              }
              const x = r.result;
              toast({ title: `${x.created} added, ${x.updated} matched${x.left ? `. ${x.left} rows left: press again.` : "."}` });
              void load(databaseId, object);
              router.refresh();
            }}
          >
            {busy ? "Turning them into records…" : "Turn them into records"}
          </Button>
        </div>
      )}
    </Card>
  );
}
