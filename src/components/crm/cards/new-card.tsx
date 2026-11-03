"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createCompanyAction,
  createDealAction,
  createPersonAction,
} from "@/app/app/[orgSlug]/crm/actions";
import { CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { CrmPicker } from "@/components/crm/crm-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import type { CrmNewKind } from "@/lib/crm/overlay";
import { runAction } from "@/lib/run-action";

/**
 * New person, company or deal, as a card: the few fields that matter, then
 * the new record's own card opens in its place. Everything else is set on
 * that card (Details).
 */
export function NewCard({
  orgId,
  what,
  pipelines,
  relationships,
}: {
  orgId: string;
  what: CrmNewKind;
  pipelines: { id: string; name: string; noun: string }[];
  relationships: { id: string; label: string }[];
}) {
  const router = useRouter();
  const { close, hrefFor } = useCrmOpen();
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState<{ id: string | null; label: string } | null>(null);
  const [domain, setDomain] = useState("");
  const [relationship, setRelationship] = useState("");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [person, setPerson] = useState<{ id: string; label: string } | null>(null);

  const heading =
    what === "person" ? "New person" : what === "company" ? "New company" : "New deal";

  async function save() {
    setPending(true);
    const r =
      what === "person"
        ? await runAction(() =>
            createPersonAction(orgId, {
              name: name.trim() || undefined,
              primaryEmail: email.trim() || undefined,
              phone: phone.trim() || undefined,
              title: title.trim() || undefined,
              companyId: company?.id ?? undefined,
              companyName: company && !company.id ? company.label : undefined,
              relationship: relationship || undefined,
            }),
          )
        : what === "company"
          ? await runAction(() =>
              createCompanyAction(orgId, { name: name.trim(), domain: domain.trim() || undefined }),
            )
          : await runAction(() =>
              createDealAction(orgId, {
                pipelineId,
                title: name.trim(),
                amount: amount.trim() || null,
                companyId: company?.id ?? null,
                primaryPersonId: person?.id ?? null,
              }),
            );
    setPending(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    const id = (r as { id?: string }).id;
    toast({
      title: `${name.trim() || "They"} ${what === "deal" ? "is in Deals" : "is in the CRM"}.`,
    });
    if (id) router.replace(hrefFor({ kind: what, id }), { scroll: false });
    else close();
  }

  const ready =
    what === "person"
      ? Boolean(name.trim() || email.trim())
      : what === "deal"
        ? Boolean(name.trim() && pipelineId)
        : Boolean(name.trim());

  return (
    <CrmCard
      title={heading}
      description={`Add a ${what} to the CRM`}
      foot={
        <div className="flex justify-end gap-2">
          <Button disabled={!ready || pending} onClick={() => void save()}>
            {pending ? "Adding…" : `Add ${what === "person" ? "them" : "it"}`}
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !pending) void save();
        }}
      >
        <Field
          label={what === "person" ? "Name" : what === "company" ? "Company name" : "What it is"}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={what === "deal" ? "Spring showcase partnership" : ""}
          />
        </Field>
        {what === "person" && (
          <>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </>
        )}
        {what === "company" && (
          <Field label="Website">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="harborlight.org"
            />
          </Field>
        )}
        {what === "deal" && pipelines.length > 1 && (
          <Field label="Pipeline">
            <Segmented
              label="Pipeline"
              value={pipelineId}
              onSelect={setPipelineId}
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
              className="self-start"
            />
          </Field>
        )}
        {what === "deal" && (
          <Field label="Amount">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5,000"
            />
          </Field>
        )}
        {what !== "company" && (
          <Field label="Company">
            <CrmPicker
              orgId={orgId}
              kind="company"
              value={company?.id ?? null}
              display={company?.label}
              placeholder="Pick a company"
              allowClear
              onPick={(h) => setCompany(h ? { id: h.id, label: h.label } : null)}
            />
          </Field>
        )}
        {what === "deal" && (
          <Field label="Person">
            <CrmPicker
              orgId={orgId}
              kind="person"
              value={person?.id ?? null}
              display={person?.label}
              placeholder="Pick a person"
              allowClear
              onPick={(h) => setPerson(h ? { id: h.id, label: h.label } : null)}
            />
          </Field>
        )}
        {what === "person" && relationships.length > 0 && (
          <Field label="Relationship">
            <div className="flex flex-wrap gap-1.5">
              {relationships.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={relationship === t.id ? "default" : "outline"}
                  onClick={() => setRelationship(relationship === t.id ? "" : t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </CrmCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-[13px] font-medium">{label}</Label>
      {children}
    </div>
  );
}
