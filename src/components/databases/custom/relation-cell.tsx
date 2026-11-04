"use client";

import { ExternalLink, Loader2, Sparkles, X } from "@/components/icons";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AI_FILL_PENDING,
  aiStoredType,
  readRelation,
  RELATION_KIND_LABELS,
  type FieldDef,
  type RelationKind,
  type RelationRef,
} from "@/lib/databases/fields";
import { relationHref, relationKey, type RelationLabel } from "@/lib/databases/relations";
import { cn } from "@/lib/utils";

/**
 * RELATION and AI cells (src/lib/databases/fields.ts). The grid provides
 * RelationProvider: the organization, and the names of what its loaded rows
 * link to (resolved on the server with the rows, so a cell never asks for
 * its own). A picked link's name joins them, so it shows at once.
 */

/** What a RELATION picker searches (the grid wires it to its Server Action). */
export type RelationSearch = (input: {
  kind: RelationKind;
  databaseId?: string;
  q: string;
}) => Promise<RelationLabel[]>;

/** The databases a relation can name (club-made ones; pipelines for their items). */
export type RelationDatabases = () => Promise<
  { id: string; name: string; kind: "record" | "deal" }[]
>;

interface RelationContextValue {
  orgId: string;
  orgSlug: string;
  labels: Readonly<Record<string, RelationLabel>>;
  remember: (labels: readonly RelationLabel[]) => void;
  search: RelationSearch;
  databases: RelationDatabases;
}

const RelationContext = createContext<RelationContextValue | null>(null);

export function RelationProvider({
  orgId,
  orgSlug,
  labels,
  search,
  databases,
  children,
}: {
  orgId: string;
  orgSlug: string;
  /** Names from the server with the first page (later pages are remembered). */
  labels: Readonly<Record<string, RelationLabel>>;
  search: RelationSearch;
  databases: RelationDatabases;
  children: ReactNode;
}) {
  const [picked, setPicked] = useState<Record<string, RelationLabel>>({});
  const remember = useCallback((more: readonly RelationLabel[]) => {
    if (more.length === 0) return;
    setPicked((p) => {
      const next = { ...p };
      for (const l of more) next[relationKey(l)] = l;
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({ orgId, orgSlug, labels: { ...labels, ...picked }, remember, search, databases }),
    [orgId, orgSlug, labels, picked, remember, search, databases],
  );
  return <RelationContext.Provider value={value}>{children}</RelationContext.Provider>;
}

export function useRelationContext(): RelationContextValue | null {
  return useContext(RelationContext);
}

/** One linked record as a small chip; a link when it can be opened. */
export function RelationChip({
  orgSlug,
  refValue,
  label,
  link = true,
  onRemove,
}: {
  orgSlug: string;
  refValue: RelationRef;
  label: RelationLabel | undefined;
  link?: boolean;
  onRemove?: () => void;
}) {
  const href = label ? relationHref(orgSlug, label) : null;
  const text = label?.label ?? "Not available";
  const chip =
    "bg-muted text-foreground inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";
  const name = <span className={cn("truncate", !label && "text-muted-foreground")}>{text}</span>;
  return (
    <span
      className={cn(chip, onRemove && "pr-1")}
      title={label?.sub ? `${text}, ${label.sub}` : text}
    >
      {link && href ? (
        <Link href={href} className="truncate hover:underline" onClick={(e) => e.stopPropagation()}>
          {text}
        </Link>
      ) : (
        name
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${text}`}
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground hover:bg-background grid size-5 place-items-center rounded-full"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
      <span className="sr-only">{refValue.kind}</span>
    </span>
  );
}

const cellBase =
  "h-10 w-full min-w-0 rounded-field bg-transparent px-2.5 text-sm outline-none transition-[background-color,box-shadow] hover:bg-muted/60 focus:bg-card focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--glow)_60%,transparent)]";

const SEARCH_AFTER_MS = 250;

/** A RELATION cell: its links as chips; editing opens a picker that searches the organization. */
export function RelationCell({
  field,
  value,
  canEdit,
  onSave,
  label,
}: {
  field: FieldDef;
  value: unknown;
  canEdit: boolean;
  onSave: (value: RelationRef[] | null) => void;
  label: string;
}) {
  const ctx = useRelationContext();
  const refs = readRelation(value);
  const target = field.options.target;
  const single = field.options.single === true;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RelationLabel[] | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (q: string) => {
      if (!ctx || !target) return;
      const mine = ++seq.current;
      setSearching(true);
      void ctx
        .search({
          kind: target.kind,
          ...(target.databaseId ? { databaseId: target.databaseId } : {}),
          q,
        })
        .catch(() => [])
        .then((found) => {
          if (mine !== seq.current) return;
          setSearching(false);
          setResults(found);
        });
    },
    [ctx, target],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const orgSlug = ctx?.orgSlug ?? "";
  const labelOf = (r: RelationRef) => ctx?.labels[relationKey(r)];
  const chips = (link: boolean) => (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {refs.map((r) => (
        <RelationChip
          key={relationKey(r)}
          orgSlug={orgSlug}
          refValue={r}
          label={labelOf(r)}
          link={link}
        />
      ))}
    </span>
  );

  if (!canEdit || !ctx) return <div className="flex h-10 items-center px-2.5">{chips(true)}</div>;

  function pick(l: RelationLabel) {
    ctx!.remember([l]);
    const ref = { kind: l.kind, id: l.id };
    if (single) {
      onSave([ref]);
      setOpen(false);
      return;
    }
    if (refs.some((r) => relationKey(r) === relationKey(ref))) return;
    onSave([...refs, ref]);
  }

  function remove(ref: RelationRef) {
    const next = refs.filter((r) => relationKey(r) !== relationKey(ref));
    onSave(next.length ? next : null);
  }

  const linked = new Set(refs.map(relationKey));
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Opening shows the first few to pick from; closing forgets the search.
        if (o) search("");
        else {
          setQuery("");
          setResults(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(cellBase, "flex items-center text-left")}
        >
          {chips(false)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        {refs.length > 0 && (
          <ul
            className="border-border/70 mb-1.5 flex flex-wrap gap-1 border-b px-1 pb-2"
            aria-label="Linked"
          >
            {refs.map((r) => {
              const l = labelOf(r);
              const href = l ? relationHref(orgSlug, l) : null;
              return (
                <li key={relationKey(r)} className="flex max-w-full items-center gap-0.5">
                  <RelationChip
                    orgSlug={orgSlug}
                    refValue={r}
                    label={l}
                    link={false}
                    onRemove={() => remove(r)}
                  />
                  {href && (
                    <Link
                      href={href}
                      aria-label={`Open ${l?.label ?? "record"}`}
                      className="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded-full"
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {target ? (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                const q = e.target.value;
                setQuery(q);
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => search(q.trim()), SEARCH_AFTER_MS);
              }}
              placeholder={`Find in ${RELATION_KIND_LABELS[target.kind].toLowerCase()}`}
              aria-label={`Find in ${RELATION_KIND_LABELS[target.kind].toLowerCase()}`}
              className="border-input bg-card rounded-field focus-visible:border-foreground mb-1.5 h-8 w-full min-w-0 border px-2.5 text-sm outline-none"
            />
            <ul role="listbox" aria-label={field.name} className="max-h-60 overflow-y-auto">
              {results?.map((l) => (
                <li key={relationKey(l)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={linked.has(relationKey(l))}
                    onClick={() => pick(l)}
                    className="hover:bg-muted rounded-field flex w-full flex-col items-start px-2.5 py-1.5 text-left"
                  >
                    <span className="w-full truncate text-sm">{l.label}</span>
                    {l.sub && (
                      <span className="text-muted-foreground w-full truncate text-xs">{l.sub}</span>
                    )}
                  </button>
                </li>
              ))}
              {searching && results === null && (
                <li className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-xs">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Looking
                </li>
              )}
              {results?.length === 0 && (
                <li className="text-muted-foreground px-2 py-1.5 text-xs">Nothing matches.</li>
              )}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            This field doesn&apos;t say what it links to yet.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * An AI field's cell: its value, shown and edited as its output type is
 * (`render` is the grid's own editor for that type), and Fill, off until
 * filling with the organization's own key arrives.
 */
export function AiCell({
  field,
  canEdit,
  render,
}: {
  field: FieldDef;
  canEdit: boolean;
  render: (as: FieldDef) => ReactNode;
}) {
  const as: FieldDef = { ...field, type: aiStoredType(field.options) };
  return (
    <div className="flex items-center gap-0.5">
      <div className="min-w-0 flex-1">{render(as)}</div>
      {canEdit && (
        <span title={AI_FILL_PENDING} className="shrink-0">
          <button
            type="button"
            disabled
            aria-label={`Fill with AI. ${AI_FILL_PENDING}`}
            className="text-muted-foreground grid size-7 place-items-center rounded-full opacity-60"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  );
}
