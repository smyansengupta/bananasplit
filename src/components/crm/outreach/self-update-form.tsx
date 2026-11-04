"use client";

import { Check } from "@/components/icons";
import { useState } from "react";

import { saveDetailsAction } from "@/app/c/[token]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Your own details, as the organization has them; change what's out of date. */
export function SelfUpdateForm({
  token,
  initial,
}: {
  token: string;
  initial: { name: string; email: string; title: string; phone: string; company: string };
}) {
  const [v, setV] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const field = (key: keyof typeof v, label: string, type = "text", auto?: string) => (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={v[key]}
        autoComplete={auto}
        onChange={(e) => {
          setV({ ...v, [key]: e.target.value });
          setSaved(false);
        }}
      />
    </label>
  );
  return (
    <form
      className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await saveDetailsAction(token, v).catch(() => null);
        setPending(false);
        if (!r) return setError("That didn't save. Try again.");
        if (!r.ok) return setError(r.error);
        setSaved(true);
      }}
    >
      {field("name", "Name", "text", "name")}
      {field("email", "Email", "email", "email")}
      {field("title", "Title", "text", "organization-title")}
      {field("company", "Where you work", "text", "organization")}
      {field("phone", "Phone", "tel", "tel")}
      {error && <p className="text-tint-danger-foreground text-sm">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm">
            <Check className="size-4" aria-hidden="true" />
            Saved. Thank you.
          </span>
        )}
      </div>
    </form>
  );
}
