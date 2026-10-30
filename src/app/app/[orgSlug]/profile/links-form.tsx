"use client";

import { Link2, Loader2, Plus, X } from "@/components/icons";
import { useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LINK_KIND_META,
  LINK_KINDS,
  MAX_LINKS,
  normalizeLinkUrl,
  type LinkKind,
  type ProfileLink,
} from "@/lib/profile/links";

import { SettingsCard } from "../settings/settings-card";
import { saveProfileLinks } from "./actions";

interface Row {
  key: number;
  kind: LinkKind;
  url: string;
}

/** The next kind to suggest: the first network not used yet. */
function suggestKind(rows: Row[]): LinkKind {
  return LINK_KINDS.find((k) => k !== "other" && !rows.some((r) => r.kind === k)) ?? "other";
}

/** LinkedIn, GitHub, a website and so on: up to 8, validated as you type and on save. */
export function LinksForm({ initial }: { initial: ProfileLink[] }) {
  // Stable row keys (the same on the server and in the browser).
  const nextKey = useRef(initial.length + 1);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((link, i) => ({ key: i + 1, kind: link.kind, url: link.url })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setSaved(false);
    setErrors({});
  }

  function add() {
    const key = nextKey.current++;
    setRows((rs) => [...rs, { key, kind: suggestKind(rs), url: "" }]);
    setSaved(false);
  }

  function remove(key: number) {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setSaved(false);
    setErrors({});
  }

  function localError(row: Row): string | null {
    if (!row.url.trim()) return "Enter a URL, or remove this link.";
    const result = normalizeLinkUrl(row.kind, row.url);
    return result.ok ? null : result.error;
  }

  // Saves itself a moment after the last change, once every row is a valid
  // link (an empty new row waits quietly until it's filled in or removed).
  const lastSaved = useRef(JSON.stringify(initial.map((l) => ({ kind: l.kind, url: l.url }))));
  useEffect(() => {
    const links = rows.map((r) => ({ kind: r.kind, url: r.url }));
    const json = JSON.stringify(links);
    if (json === lastSaved.current) return;
    if (rows.some((r) => localError(r))) return;
    const timer = setTimeout(() => save(false), 900);
    return () => clearTimeout(timer);
    // save and localError read only the current rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save(true);
  }

  function save(showErrors: boolean) {
    if (showErrors) setTouched(Object.fromEntries(rows.map((r) => [r.key, true])));
    if (rows.some((r) => localError(r))) return;
    const links = rows.map((r) => ({ kind: r.kind, url: r.url }));
    startTransition(async () => {
      const result = await saveProfileLinks({ links });
      if (result.ok) {
        // Show the normalized URLs (https:// added, and so on).
        const normalized = rows.map((r) => {
          const n = normalizeLinkUrl(r.kind, r.url);
          return n.ok ? { ...r, url: n.url } : r;
        });
        lastSaved.current = JSON.stringify(normalized.map((r) => ({ kind: r.kind, url: r.url })));
        setRows(normalized);
        setSaved(true);
      } else {
        setErrors(result.fieldErrors);
      }
    });
  }

  const statusLine =
    errors.links || errors.form ? (
      <span className="text-destructive">{errors.links ?? errors.form}</span>
    ) : pending ? (
      <span className="text-muted-foreground inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Saving
      </span>
    ) : saved ? (
      <span className="text-success">Saved</span>
    ) : rows.length >= MAX_LINKS ? (
      <span className="text-muted-foreground">You can add up to {MAX_LINKS} links.</span>
    ) : null;

  return (
    <form onSubmit={submit} noValidate>
      <SettingsCard
        title="Links"
        description={`Up to ${MAX_LINKS}.`}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={rows.length >= MAX_LINKS}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add link
          </Button>
        }
        status={statusLine && <p aria-live="polite">{statusLine}</p>}
      >
        {rows.length === 0 ? (
          <EmptyState size="compact" icon={Link2} title="No links" className="py-0" />
        ) : (
          <ul className="space-y-3">
            {rows.map((row, index) => {
              const serverError = errors[`links.${index}.url`] ?? errors[`links.${index}.kind`];
              const error = serverError ?? (touched[row.key] ? localError(row) : null);
              const errorId = `link-${row.key}-error`;
              return (
                <li key={row.key} className="space-y-1.5">
                  <div className="flex gap-2">
                    <Select
                      value={row.kind}
                      onValueChange={(kind) => update(row.key, { kind: kind as LinkKind })}
                    >
                      <SelectTrigger
                        className="w-32 shrink-0"
                        aria-label={`Link ${index + 1} type`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINK_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {LINK_KIND_META[kind].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={row.url}
                      onChange={(e) => update(row.key, { url: e.target.value })}
                      onBlur={() => setTouched((t) => ({ ...t, [row.key]: true }))}
                      placeholder={LINK_KIND_META[row.kind].example}
                      inputMode="url"
                      autoComplete="url"
                      spellCheck={false}
                      maxLength={300}
                      aria-label={`${LINK_KIND_META[row.kind].label} URL`}
                      aria-invalid={Boolean(error) || undefined}
                      aria-describedby={error ? errorId : undefined}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => remove(row.key)}
                      aria-label={`Remove ${LINK_KIND_META[row.kind].label} link`}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {error && (
                    <p id={errorId} className="text-destructive text-sm">
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>
    </form>
  );
}
