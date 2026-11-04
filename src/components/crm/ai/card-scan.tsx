"use client";

import { Camera, Check, Loader2, RotateCcw, Upload } from "@/components/icons";
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { crmApprovalsHref } from "@/lib/crm/href";

import { IMAGE_ACCEPT, sendImage, shrinkImage } from "./image";

/**
 * Card and badge scanning at fairs and events (docs/features/crm.md module
 * 12): take a photo with the phone's camera, the organization's AI reads
 * it, and the person waits in Review to be added (or, when their email is
 * already in the CRM, the new details do). Made for one hand: one big
 * button, then the next card.
 */
export function CardScan({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [metAt, setMetAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; company: string | null; existing: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File) => {
    setError(null);
    setBusy(true);
    const blob = await shrinkImage(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    const r = await sendImage(orgId, blob, { purpose: "card", ...(metAt.trim() ? { metAt: metAt.trim() } : {}) });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setDone((d) => [{ name: String(r.name ?? "Someone"), company: (r.company as string | null) ?? null, existing: Boolean(r.existing) }, ...d]);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void read(f);
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Input value={metAt} onChange={(e) => setMetAt(e.target.value)} placeholder="Where you are (optional): Spring career fair" maxLength={120} aria-label="Where you met them" className="h-11" />
      <Card className="items-center gap-4 p-6 text-center">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="The last card scanned" className="max-h-56 w-full rounded-2xl object-contain" />
        ) : (
          <span className="bg-tint-accent text-tint-accent-foreground grid size-16 place-items-center rounded-full" aria-hidden="true">
            <Camera className="size-7" />
          </span>
        )}
        <Button size="lg" className="h-14 w-full text-base" disabled={busy} onClick={() => camera.current?.click()}>
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Camera className="size-5" aria-hidden="true" />}
          {busy ? "Reading the card…" : done.length ? "Scan the next card" : "Take a photo of a card or badge"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => library.current?.click()}>
          <Upload className="size-4" aria-hidden="true" />
          Pick a photo instead
        </Button>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        <input ref={library} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={onFile} />
        {error && (
          <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
            <RotateCcw className="size-4" aria-hidden="true" />
            {error}
          </p>
        )}
      </Card>
      {done.length > 0 && (
        <Card className="gap-2 p-5">
          <p className="font-semibold">Waiting in To approve</p>
          <ul className="space-y-1.5 text-sm">
            {done.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <Check className="text-tint-success-foreground size-4" aria-hidden="true" />
                <span className="font-medium">{d.name}</span>
                {d.company && <span className="text-muted-foreground">{d.company}</span>}
                {d.existing && <span className="text-muted-foreground ms-auto text-xs">already in, new details</span>}
              </li>
            ))}
          </ul>
          <Button variant="outline" asChild className="mt-2">
            <Link href={crmApprovalsHref(orgSlug)}>Open To approve</Link>
          </Button>
        </Card>
      )}
      <p className="text-muted-foreground text-center text-xs">Photos are read once by your organization&apos;s AI and never kept.</p>
    </div>
  );
}
