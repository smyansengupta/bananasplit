"use client";

import { ImageUp, Loader2, X } from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { searchCrmAction, type PickerHit } from "@/app/app/[orgSlug]/crm/actions";
import {
  likelyExistingAction,
  newCompanyAction,
  newDealAction,
  newPersonAction,
  readSignatureAction,
} from "@/app/app/[orgSlug]/crm/people-actions";
import { AMBIENT_BUTTON, AmbientWhy } from "@/components/ambient/ambient-button";
import { IMAGE_ACCEPT, sendImage, shrinkImage } from "@/components/crm/ai/image";
import { CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { CrmPicker } from "@/components/crm/crm-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { hrefWithOpen, type CrmNewKind } from "@/lib/crm/overlay";
import { parseSignature, type ContactFill } from "@/lib/crm/people-view";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * New person, company or deal as a card (NewRecord.dc.html): a Person,
 * Company and Deal switch; for a person, paste an email signature or drop
 * a card photo and the organization's own AI fills the fields in (read
 * without AI when it isn't connected); a line under the name when they're
 * already here, with Open; Relationship and Owner as chips. Create opens
 * the new card in its place; Create and open another keeps this one blank
 * for the next.
 */

export interface NewCardWith {
  company: { id: string; label: string } | null;
  people: { id: string; label: string }[];
}

type Company = { id: string | null; label: string } | null;
type Snapshot = { name: string; email: string; phone: string; title: string; website: string; company: Company };
type Match = { id: string; name: string; sub: string | null; reason: string | null } | null;

const TITLES: Record<CrmNewKind, string> = {
  person: "New person",
  company: "New company",
  deal: "New deal",
};
const WHERE: Record<CrmNewKind, string> = {
  person: "People",
  company: "People, under Companies",
  deal: "Deals",
};

const CHIP =
  "focus-glow inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors";
function chip(on: boolean) {
  return cn(
    CHIP,
    on
      ? "bg-foreground text-background"
      : "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_22%,transparent)] hover:bg-muted",
  );
}

export function NewCard({
  orgId,
  what,
  start,
  viewerId,
  owners,
  pipelines,
  relationships,
}: {
  orgId: string;
  what: CrmNewKind;
  start: NewCardWith;
  viewerId: string;
  /** Other members, for the Owner chips (Me comes first). */
  owners: { id: string; label: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  relationships: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const { hrefFor } = useCrmOpen();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [website, setWebsite] = useState("");
  const [company, setCompany] = useState<Company>(start.company);
  const [people, setPeople] = useState(start.people);
  const [relationship, setRelationship] = useState("");
  const [owner, setOwner] = useState<string>(viewerId);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [stageId, setStageId] = useState(pipelines[0]?.stages[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [closes, setCloses] = useState("");
  const [pending, setPending] = useState(false);
  const [filled, setFilled] = useState<{ before: Snapshot; how: string } | null>(null);
  const [match, setMatch] = useState<Match>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Bumped by a reset, so the company box starts over too.
  const [round, setRound] = useState(0);

  const snapshot = (): Snapshot => ({ name, email, phone, title, website, company });
  const restore = (s: Snapshot) => {
    setName(s.name);
    setEmail(s.email);
    setPhone(s.phone);
    setTitle(s.title);
    setWebsite(s.website);
    setCompany(s.company);
  };

  /** Leaves the card: `open` (and what it started with) off the URL, or another card in its place. */
  const leave = (next: string | null) => {
    const p = new URLSearchParams(params.toString());
    p.delete("with");
    router.replace(hrefWithOpen(pathname, p, next), { scroll: false });
  };

  // "Already here": as the name, address or number settles, ask once.
  const key = what === "person" ? `${name}|${email}|${phone}` : what === "company" ? `${name}|${website}` : "";
  useEffect(() => {
    if (what === "deal" || (!name.trim() && !email.trim() && !website.trim())) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await likelyExistingAction(
        orgId,
        what === "person"
          ? { kind: "person", name: name.trim(), email: email.trim() || null, phone: phone.trim() || null }
          : { kind: "company", name: name.trim(), domain: website.trim() || null },
      ).catch(() => null);
      if (live && r?.ok) setMatch(r.match);
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // `key` holds the fields the check reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, orgId, what]);
  const shownMatch = what !== "deal" && (name.trim() || email.trim() || website.trim()) ? match : null;

  const apply = (r: ContactFill, how: string) => {
    if (!r.name && !r.email && !r.phone) {
      toast({ title: "Couldn't find a name, email or number in that.", tone: "error" });
      return;
    }
    setFilled({ before: snapshot(), how });
    if (r.name) setName(r.name);
    if (r.email) setEmail(r.email);
    if (r.phone) setPhone(r.phone);
    if (r.title) setTitle(r.title);
    if (r.company) setCompany({ id: null, label: r.company });
    if (r.website) setWebsite(r.website);
  };

  const readText = async (text: string) => {
    const r = await runAction(() => readSignatureAction(orgId, text));
    if (!r) return;
    if (r.ok) return apply(r, "Filled from the signature. Check it, then create.");
    if (r.code === "no-connection") {
      return apply(parseSignature(text), "Filled from the signature, without AI. Check it, then create.");
    }
    toast({ title: r.error, tone: "error" });
  };

  const readImage = async (file: File | Blob) => {
    const r = await sendImage(orgId, await shrinkImage(file), { purpose: "fill" });
    if (r.error) {
      toast({
        title:
          r.code === "no-connection"
            ? "Reading a photo needs your organization's AI. Connect it in CRM settings, or paste the text instead."
            : r.error,
        tone: "error",
      });
      return;
    }
    apply(
      {
        name: (r.name as string | null) ?? null,
        title: (r.title as string | null) ?? null,
        company: (r.company as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        website: (r.website as string | null) ?? null,
      },
      "Filled from the card. Check it, then create.",
    );
  };

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setTitle("");
    setWebsite("");
    setCompany(start.company);
    setPeople(start.people);
    setAmount("");
    setCloses("");
    setFilled(null);
    setMatch(null);
    setRound((n) => n + 1);
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const ready =
    what === "person" ? Boolean(name.trim() || email.trim()) : what === "deal" ? Boolean(name.trim() && pipelineId) : Boolean(name.trim());

  async function create(another: boolean) {
    if (!ready || pending) return;
    setPending(true);
    const ownerId = owner;
    const r =
      what === "person"
        ? await runAction(() =>
            newPersonAction(orgId, {
              name: name.trim() || undefined,
              primaryEmail: email.trim() || undefined,
              phone: phone.trim() || undefined,
              title: title.trim() || undefined,
              companyId: company?.id ?? null,
              companyName: company && !company.id ? company.label : null,
              website: website.trim() || null,
              relationship: relationship || null,
              ownerId,
            }),
          )
        : what === "company"
          ? await runAction(() =>
              newCompanyAction(orgId, { name: name.trim(), website: website.trim() || null, ownerId }),
            )
          : await runAction(() =>
              newDealAction(orgId, {
                pipelineId,
                stageId: stageId || null,
                title: name.trim(),
                amount: amount.trim() || null,
                expectedOn: closes || null,
                companyId: company?.id ?? null,
                people: people.map((p) => p.id),
                ownerId,
              }),
            );
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    const made = name.trim() || email.trim() || TITLES[what].replace("New ", "The new ");
    if (another) {
      toast({ title: `${made} is in ${WHERE[what]}. This one is blank for the next.` });
      reset();
      router.refresh();
      return;
    }
    toast({ title: `${made} is in ${WHERE[what]}.` });
    leave(`${what}:${r.id}`);
  }

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const domain = website.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] ?? "";

  return (
    <CrmCard
      title={TITLES[what]}
      description={`Add a ${what} to the CRM`}
      onClose={() => leave(null)}
      tabs={[
        { value: "person", label: "Person" },
        { value: "company", label: "Company" },
        { value: "deal", label: "Deal" },
      ]}
      tab={what}
      onTab={(v) => {
        const p = new URLSearchParams(params.toString());
        router.replace(hrefWithOpen(pathname, p, `new:${v}`), { scroll: false });
      }}
      foot={
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={!ready || pending} onClick={() => void create(true)}>
            Create and open another
          </Button>
          <span className="flex-1" />
          <Button disabled={!ready || pending} onClick={() => void create(false)}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </div>
      }
    >
      {() => (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create(false);
          }}
        >
          {what === "person" &&
            (filled ? (
              <div className="bg-muted flex flex-nowrap items-center gap-3 rounded-2xl px-4 py-3">
                <span className="min-w-0 flex-1 text-sm">{filled.how}</span>
                <button
                  type="button"
                  className={cn(AMBIENT_BUTTON, OUTLINE)}
                  onClick={() => {
                    restore(filled.before);
                    setFilled(null);
                    setRound((n) => n + 1);
                  }}
                >
                  Undo
                </button>
              </div>
            ) : (
              <FillZone onText={readText} onImage={readImage} />
            ))}

          <label className="grid gap-1.5">
            <span className="text-muted-foreground text-[13px] font-medium">
              {what === "person" ? "Name" : what === "company" ? "Company name" : "Deal name"}
            </span>
            <input
              ref={nameRef}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={what === "person" ? "Full name" : what === "company" ? "Company name" : "Spring showcase partnership"}
              className="border-input focus-visible:border-foreground h-14 rounded-2xl border bg-transparent px-4 text-xl font-semibold outline-none"
            />
          </label>

          {shownMatch && (
            <div className="-mt-2 flex flex-nowrap items-center gap-2.5">
              <AmbientWhy className="min-w-0 truncate text-[13px]">
                {shownMatch.name} is already here{shownMatch.sub ? `, ${shownMatch.sub}` : ""}
              </AmbientWhy>
              <Link
                href={hrefFor({ kind: what === "company" ? "company" : "person", id: shownMatch.id })}
                scroll={false}
                className={cn(AMBIENT_BUTTON, OUTLINE)}
                onClick={(e) => {
                  e.preventDefault();
                  leave(`${what === "company" ? "company" : "person"}:${shownMatch.id}`);
                }}
              >
                Open {what === "company" ? "it" : (shownMatch.name.split(" ")[0] ?? "them")}
              </Link>
            </div>
          )}

          {what === "person" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
                </Field>
                <Field label="Phone">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company">
                  <CompanyInput key={round} orgId={orgId} value={company} onChange={setCompany} />
                </Field>
                <Field label="Title">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
                </Field>
              </div>
              {relationships.length > 0 && (
                <Chips label="Relationship">
                  {relationships.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={relationship === t.id}
                      onClick={() => setRelationship(relationship === t.id ? "" : t.id)}
                      className={chip(relationship === t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </Chips>
              )}
            </>
          )}

          {what === "company" && (
            <>
              <Field label="Website">
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="harborlight.org" />
              </Field>
              {domain.includes(".") && (
                <p className="text-muted-foreground -mt-2 text-[13px]">
                  People with an @{domain} email join it on their own.
                </p>
              )}
            </>
          )}

          {what === "deal" && (
            <>
              <Field label="With">
                <div className="grid gap-2">
                  <CompanyInput key={round} orgId={orgId} value={company} onChange={setCompany} existingOnly />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {people.map((p) => (
                      <span key={p.id} className="bg-muted inline-flex h-8 items-center gap-1 rounded-full ps-3 pe-1 text-[13px] font-semibold">
                        {p.label}
                        <button
                          type="button"
                          aria-label={`Take ${p.label} off`}
                          onClick={() => setPeople(people.filter((x) => x.id !== p.id))}
                          className="hover:bg-background grid size-6 place-items-center rounded-full"
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <CrmPicker
                      orgId={orgId}
                      kind="person"
                      value={null}
                      placeholder={people.length ? "Add a person" : "Pick a person"}
                      onPick={(h) => h && !people.some((p) => p.id === h.id) && setPeople([...people, { id: h.id, label: h.label }])}
                    />
                  </div>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount">
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$1,200" />
                </Field>
                <Field label="Closes">
                  <Input type="date" value={closes} onChange={(e) => setCloses(e.target.value)} />
                </Field>
              </div>
              {pipelines.length > 1 && (
                <Chips label="Pipeline">
                  {pipelines.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={pipelineId === p.id}
                      onClick={() => {
                        setPipelineId(p.id);
                        setStageId(p.stages[0]?.id ?? "");
                      }}
                      className={chip(pipelineId === p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </Chips>
              )}
              {pipeline && pipeline.stages.length > 0 && (
                <Chips label="Stage">
                  {pipeline.stages.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={stageId === s.id}
                      onClick={() => setStageId(s.id)}
                      className={chip(stageId === s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </Chips>
              )}
              {pipelines.length === 0 && (
                <p className="text-muted-foreground text-sm">There&apos;s no pipeline yet. Add one in CRM settings first.</p>
              )}
            </>
          )}

          <Chips label="Owner">
            {[{ id: viewerId, label: "Me" }, ...owners, { id: "", label: "Nobody" }].map((o) => (
              <button
                key={o.id || "nobody"}
                type="button"
                aria-pressed={owner === o.id}
                onClick={() => setOwner(o.id)}
                className={chip(owner === o.id)}
              >
                {o.label}
              </button>
            ))}
          </Chips>
          <button type="submit" hidden />
        </form>
      )}
    </CrmCard>
  );
}

const OUTLINE =
  "bg-transparent text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-muted-foreground text-[13px] font-medium">{label}</span>
      {children}
    </div>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-muted-foreground me-1.5 w-24 text-[13px] font-medium max-sm:w-full">{label}</span>
      {children}
    </div>
  );
}

/**
 * Paste an email signature or a card photo here (or drop the photo, or
 * pick one): it reads it and fills the fields in.
 */
function FillZone({
  onText,
  onImage,
}: {
  onText: (text: string) => Promise<void>;
  onImage: (file: File) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    await job();
    setBusy(false);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith("image/")) void run(() => onImage(f));
        else {
          const text = e.dataTransfer.getData("text/plain");
          if (text.trim()) void run(() => onText(text));
        }
      }}
      className={cn(
        "flex flex-nowrap items-center gap-2 rounded-2xl border-[1.5px] border-dashed px-2 py-2 transition-colors",
        over ? "border-foreground bg-muted" : "border-input",
      )}
    >
      {busy ? (
        <span className="text-muted-foreground flex flex-1 items-center gap-2 px-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Reading it…
        </span>
      ) : (
        <textarea
          rows={1}
          aria-label="Paste an email signature or a business card photo"
          placeholder="Paste an email signature or a business card photo and it fills these in"
          className="placeholder:text-muted-foreground min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          onPaste={(e) => {
            const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (img) {
              e.preventDefault();
              void run(() => onImage(img));
              return;
            }
            const text = e.clipboardData.getData("text/plain");
            if (text.trim()) {
              e.preventDefault();
              void run(() => onText(text));
            }
          }}
        />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => file.current?.click()}
        className={cn(AMBIENT_BUTTON, OUTLINE)}
        title="Pick a photo of a card"
      >
        <ImageUp aria-hidden="true" />
        Photo
      </button>
      <input
        ref={file}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void run(() => onImage(f));
        }}
      />
    </div>
  );
}

/**
 * A company by name: the ones already here as you type, or the name as a
 * new one (not for a deal, which links an existing company).
 */
function CompanyInput({
  orgId,
  value,
  onChange,
  existingOnly = false,
}: {
  orgId: string;
  value: Company;
  onChange: (c: Company) => void;
  existingOnly?: boolean;
}) {
  const [text, setText] = useState(value?.label ?? "");
  const [hits, setHits] = useState<PickerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(value);
  // Picked here or filled from a signature: show it.
  if (seen !== value) {
    setSeen(value);
    if (value) setText(value.label);
  }
  useEffect(() => {
    if (!open) return;
    const q = text.trim();
    if (!q) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchCrmAction(orgId, "company", q).catch(() => null);
      if (live && r?.ok) setHits(r.hits.slice(0, 4));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, open, orgId]);
  const q = text.trim();
  const exact = hits.some((h) => h.label.toLowerCase() === q.toLowerCase());
  return (
    <div className="relative">
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={existingOnly ? "A company" : "Optional"}
        aria-label="Company"
      />
      {value && (
        <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs">
          {value.id ? "" : "new"}
        </span>
      )}
      {open && q && !value && (hits.length > 0 || !existingOnly) && (
        <div className="bg-popover ring-foreground/10 absolute inset-x-0 top-full z-20 mt-1 grid gap-0.5 rounded-2xl p-1.5 shadow-lg ring-1">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: h.id, label: h.label });
                setOpen(false);
              }}
              className="hover:bg-muted flex items-center gap-2 rounded-xl px-3 py-2 text-start text-sm"
            >
              <b className="min-w-0 truncate">{h.label}</b>
              {h.sub && <span className="text-muted-foreground truncate text-xs">{h.sub}</span>}
            </button>
          ))}
          {!existingOnly && !exact && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: null, label: q });
                setOpen(false);
              }}
              className="hover:bg-muted rounded-xl px-3 py-2 text-start text-sm"
            >
              Add &ldquo;{q}&rdquo; as a new company
            </button>
          )}
        </div>
      )}
    </div>
  );
}

