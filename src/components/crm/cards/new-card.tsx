"use client";

import { Building2, Handshake, ImageUp, Loader2, User, X } from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

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
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { CrmPicker } from "@/components/crm/crm-picker";
import { Button } from "@/components/ui/button";
import {
  ChoiceCards,
  FormDialog,
  FormDialogBody,
  FormDialogFoot,
  FormDialogHead,
  FormError,
  FormField,
  FormRow,
  keepOpenForToasts,
  type ChoiceCard,
} from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { hrefWithOpen, type CrmNewKind } from "@/lib/crm/overlay";
import { parseSignature, type ContactFill } from "@/lib/crm/people-view";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * New person, company or deal, built like New task and New event (the
 * shared FormDialog pieces): the header with the black Close, the Person,
 * Company and Deal cards the way New event picks its kind, the name first
 * and focused, the rest as labelled fields in pairs, and the foot with
 * Create, Cancel and Create and open another. Enter or Ctrl+Enter creates;
 * Ctrl+Shift+Enter creates and opens another.
 *
 * For a person, paste an email signature or drop a card photo and the
 * organization's own AI fills the fields in (read without AI when it isn't
 * connected). A line under the name says when they're already here, with
 * Open. Switching kind keeps what was typed. Create opens the new card in
 * its place; Create and open another keeps this one blank for the next. In
 * a Personal space there's nobody else to own it, so Owner isn't asked.
 */

export interface NewCardWith {
  company: { id: string; label: string } | null;
  people: { id: string; label: string }[];
}

type Company = { id: string | null; label: string } | null;
type Snapshot = {
  name: string;
  email: string;
  phone: string;
  title: string;
  website: string;
  company: Company;
};
type Match = { id: string; name: string; sub: string | null; reason: string | null } | null;

const KINDS: readonly ChoiceCard<CrmNewKind>[] = [
  { value: "person", label: "Person", hint: "Someone you know or want to reach", icon: User },
  {
    value: "company",
    label: "Company",
    hint: "A business or group you work with",
    icon: Building2,
  },
  {
    value: "deal",
    label: "Deal",
    hint: "Money or a partnership you're working toward",
    icon: Handshake,
  },
];
const TITLES: Record<CrmNewKind, string> = {
  person: "New person",
  company: "New company",
  deal: "New deal",
};
const DESCRIPTIONS: Record<CrmNewKind, string> = {
  person: "A name or an email is all it takes. Paste a signature to fill in the rest.",
  company: "A name is all it takes. Everything else has a sensible default.",
  deal: "A name is all it takes. It starts in the pipeline's first stage.",
};
const WHERE: Record<CrmNewKind, string> = {
  person: "People",
  company: "People, under Companies",
  deal: "Deals",
};
const NAME_LABEL: Record<CrmNewKind, string> = {
  person: "Name",
  company: "Company name",
  deal: "Deal name",
};
const NAME_PLACEHOLDER: Record<CrmNewKind, string> = {
  person: "e.g. Maya Chen",
  company: "e.g. Harborlight",
  deal: "e.g. Spring showcase sponsorship",
};

const NOBODY = "__nobody";
const NO_RELATIONSHIP = "__none";

export function NewCard({
  orgId,
  what: startWhat,
  start,
  viewerId,
  owners,
  pipelines,
  relationships,
  personal = false,
}: {
  orgId: string;
  what: CrmNewKind;
  start: NewCardWith;
  viewerId: string;
  /** Other members, for Owner (Me comes first). */
  owners: { id: string; label: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  relationships: { id: string; label: string }[];
  /** A Personal space: there's nobody else, so Owner isn't asked. */
  personal?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const { hrefFor } = useCrmOpen();
  const ids = useId();

  const [what, setWhat] = useState<CrmNewKind>(startWhat);
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
  const [error, setError] = useState<string | null>(null);
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

  /**
   * Person, Company or Deal: the URL follows (so a reload opens the same
   * one) without a navigation, which would start the card over and lose
   * what was typed.
   */
  const pickKind = (next: CrmNewKind) => {
    setWhat(next);
    setError(null);
    const p = new URLSearchParams(params.toString());
    window.history.replaceState(null, "", hrefWithOpen(pathname, p, `new:${next}`));
  };

  // "Already here": as the name, address or number settles, ask once.
  const key =
    what === "person"
      ? `${name}|${email}|${phone}`
      : what === "company"
        ? `${name}|${website}`
        : "";
  useEffect(() => {
    if (what === "deal" || (!name.trim() && !email.trim() && !website.trim())) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await likelyExistingAction(
        orgId,
        what === "person"
          ? {
              kind: "person",
              name: name.trim(),
              email: email.trim() || null,
              phone: phone.trim() || null,
            }
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
  const shownMatch =
    what !== "deal" && (name.trim() || email.trim() || website.trim()) ? match : null;

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
      return apply(
        parseSignature(text),
        "Filled from the signature, without AI. Check it, then create.",
      );
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
    setError(null);
    setRound((n) => n + 1);
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const ready =
    what === "person"
      ? Boolean(name.trim() || email.trim())
      : what === "deal"
        ? Boolean(name.trim() && pipelineId)
        : Boolean(name.trim());

  async function create(another: boolean) {
    if (!ready || pending) return;
    setError(null);
    setPending(true);
    const ownerId = personal ? viewerId : owner;
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
              newCompanyAction(orgId, {
                name: name.trim(),
                website: website.trim() || null,
                ownerId,
              }),
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
    if (!r.ok) return setError(r.error);
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
  const domain =
    website
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0] ?? "";
  const id = (field: string) => `${ids}-${field}`;

  const ownerField = personal ? null : (
    <FormField label="Owner" htmlFor={id("owner")}>
      <Select value={owner || NOBODY} onValueChange={(v) => setOwner(v === NOBODY ? "" : v)}>
        <SelectTrigger id={id("owner")} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={viewerId}>Me</SelectItem>
          {owners.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
          <SelectItem value={NOBODY}>Nobody</SelectItem>
        </SelectContent>
      </Select>
    </FormField>
  );

  return (
    <FormDialog open onOpenChange={(o) => !o && leave(null)} onInteractOutside={keepOpenForToasts}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void create(e.shiftKey);
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <FormDialogHead title={TITLES[what]} description={DESCRIPTIONS[what]} />

        <FormDialogBody>
          <ChoiceCards label="What to add" options={KINDS} value={what} onChange={pickKind} />

          {what === "person" &&
            (filled ? (
              <div className="bg-muted rounded-field flex flex-nowrap items-center gap-3 px-3.5 py-2">
                <span className="min-w-0 flex-1 text-sm">{filled.how}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    restore(filled.before);
                    setFilled(null);
                    setRound((n) => n + 1);
                  }}
                >
                  Undo
                </Button>
              </div>
            ) : (
              <FillZone onText={readText} onImage={readImage} />
            ))}

          <FormField label={NAME_LABEL[what]} htmlFor={id("name")}>
            <Input
              id={id("name")}
              ref={nameRef}
              autoFocus
              required={what !== "person"}
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={NAME_PLACEHOLDER[what]}
            />
            {shownMatch && (
              <div className="flex flex-nowrap items-center gap-2.5 pt-0.5">
                <AmbientWhy className="min-w-0 truncate text-xs">
                  {shownMatch.name} is already here{shownMatch.sub ? `, ${shownMatch.sub}` : ""}
                </AmbientWhy>
                <Link
                  href={hrefFor({
                    kind: what === "company" ? "company" : "person",
                    id: shownMatch.id,
                  })}
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
          </FormField>

          {what === "person" && (
            <>
              <FormRow>
                <FormField label="Email" htmlFor={id("email")}>
                  <Input
                    id={id("email")}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </FormField>
                <FormField label="Phone" htmlFor={id("phone")}>
                  <Input
                    id={id("phone")}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Optional"
                  />
                </FormField>
              </FormRow>
              <FormRow>
                <FormField label="Company" htmlFor={id("company")}>
                  <CompanyInput
                    key={round}
                    id={id("company")}
                    orgId={orgId}
                    value={company}
                    onChange={setCompany}
                  />
                </FormField>
                <FormField label="Title" htmlFor={id("title")}>
                  <Input
                    id={id("title")}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Optional"
                  />
                </FormField>
              </FormRow>
              {(relationships.length > 0 || ownerField) && (
                <FormRow>
                  {relationships.length > 0 && (
                    <FormField label="Relationship" htmlFor={id("relationship")}>
                      <Select
                        value={relationship || NO_RELATIONSHIP}
                        onValueChange={(v) => setRelationship(v === NO_RELATIONSHIP ? "" : v)}
                      >
                        <SelectTrigger id={id("relationship")} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_RELATIONSHIP}>None yet</SelectItem>
                          {relationships.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                  {ownerField}
                </FormRow>
              )}
            </>
          )}

          {what === "company" && (
            <FormRow>
              <FormField
                label="Website"
                htmlFor={id("website")}
                hint={
                  domain.includes(".")
                    ? `People with an @${domain} email join it on their own.`
                    : undefined
                }
              >
                <Input
                  id={id("website")}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="harborlight.org"
                />
              </FormField>
              {ownerField}
            </FormRow>
          )}

          {what === "deal" && (
            <>
              <FormRow>
                <FormField label="Company" htmlFor={id("company")}>
                  <CompanyInput
                    key={round}
                    id={id("company")}
                    orgId={orgId}
                    value={company}
                    onChange={setCompany}
                    existingOnly
                  />
                </FormField>
                <FormField label="People" labelId={id("people")}>
                  <div
                    role="group"
                    aria-labelledby={id("people")}
                    className="border-input rounded-field bg-card flex min-h-10 flex-wrap items-center gap-1 border px-1.5 py-1"
                  >
                    {people.map((p) => (
                      <span
                        key={p.id}
                        className="bg-muted inline-flex h-7 max-w-full items-center gap-0.5 rounded-full ps-2.5 pe-0.5 text-sm"
                      >
                        <span className="min-w-0 truncate">{p.label}</span>
                        <button
                          type="button"
                          aria-label={`Take ${p.label} off`}
                          onClick={() => setPeople(people.filter((x) => x.id !== p.id))}
                          className="hover:bg-background grid size-6 shrink-0 place-items-center rounded-full"
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <CrmPicker
                      orgId={orgId}
                      kind="person"
                      value={null}
                      className="h-7 border-0 px-2"
                      placeholder={people.length ? "Add a person" : "Pick a person"}
                      onPick={(h) =>
                        h &&
                        !people.some((p) => p.id === h.id) &&
                        setPeople([...people, { id: h.id, label: h.label }])
                      }
                    />
                  </div>
                </FormField>
              </FormRow>
              <FormRow>
                <FormField label="Amount" htmlFor={id("amount")}>
                  <Input
                    id={id("amount")}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="$1,200"
                  />
                </FormField>
                <FormField label="Close date" htmlFor={id("closes")}>
                  <Input
                    id={id("closes")}
                    type="date"
                    value={closes}
                    onChange={(e) => setCloses(e.target.value)}
                  />
                </FormField>
              </FormRow>
              {pipelines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  There&apos;s no pipeline yet. Add one in CRM settings first.
                </p>
              ) : (
                <FormRow>
                  {pipelines.length > 1 && (
                    <FormField label="Pipeline" htmlFor={id("pipeline")}>
                      <Select
                        value={pipelineId}
                        onValueChange={(v) => {
                          setPipelineId(v);
                          setStageId(pipelines.find((p) => p.id === v)?.stages[0]?.id ?? "");
                        }}
                      >
                        <SelectTrigger id={id("pipeline")} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelines.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                  {pipeline && pipeline.stages.length > 0 && (
                    <FormField label="Stage" htmlFor={id("stage")}>
                      <Select value={stageId} onValueChange={setStageId}>
                        <SelectTrigger id={id("stage")} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pipeline.stages.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                  {ownerField}
                </FormRow>
              )}
            </>
          )}

          <FormError>{error}</FormError>
        </FormDialogBody>

        <FormDialogFoot>
          <Button
            type="button"
            variant="ghost"
            className="sm:me-auto"
            disabled={!ready || pending}
            title="Ctrl+Shift+Enter"
            onClick={() => void create(true)}
          >
            Create and open another
          </Button>
          <Button type="button" variant="outline" onClick={() => leave(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? "Creating…" : `Create ${what}`}
          </Button>
        </FormDialogFoot>
      </form>
    </FormDialog>
  );
}

const OUTLINE =
  "bg-transparent text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8";

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
        "rounded-field flex flex-nowrap items-center gap-2 border border-dashed py-1 ps-1.5 pe-1 transition-colors",
        over ? "border-foreground bg-muted" : "border-input bg-card",
      )}
    >
      {busy ? (
        <span className="text-muted-foreground flex min-h-8 flex-1 items-center gap-2 px-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Reading it…
        </span>
      ) : (
        <textarea
          rows={1}
          aria-label="Paste an email signature or a business card photo"
          placeholder="Paste a signature or card photo to fill these in"
          className="placeholder:text-muted-foreground min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => file.current?.click()}
        title="Pick a photo of a card"
      >
        <ImageUp aria-hidden="true" />
        Photo
      </Button>
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
  id,
  orgId,
  value,
  onChange,
  existingOnly = false,
}: {
  id?: string;
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
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={existingOnly ? "A company already here" : "Optional"}
        autoComplete="off"
      />
      {value && !value.id && (
        <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs">
          new
        </span>
      )}
      {open && q && !value && (hits.length > 0 || !existingOnly) && (
        <div className="bg-popover ring-foreground/10 rounded-field absolute inset-x-0 top-full z-20 mt-1 grid gap-0.5 p-1 shadow-lg ring-1">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: h.id, label: h.label });
                setOpen(false);
              }}
              className="hover:bg-muted flex items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm"
            >
              <b className="min-w-0 truncate font-medium">{h.label}</b>
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
              className="hover:bg-muted rounded-md px-2.5 py-1.5 text-start text-sm"
            >
              Add &ldquo;{q}&rdquo; as a new company
            </button>
          )}
        </div>
      )}
    </div>
  );
}
