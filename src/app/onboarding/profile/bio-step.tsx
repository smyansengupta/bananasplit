"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { DashedButton, FieldError } from "@/components/onboarding/step-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { detectLinkKind, SETUP_BIO_MAX } from "@/lib/onboarding/steps";
import { LINK_KIND_META, MAX_LINKS, normalizeLinkUrl, type ProfileLink } from "@/lib/profile/links";

import { saveBioStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

/** "https://www.linkedin.com/in/ada" -> "linkedin.com/in/ada" */
function shortUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/** A3 · Bio + links: up to 8 links, the type detected from the URL. */
export function BioStep({ initial }: { initial: { bio: string | null; links: ProfileLink[] } }) {
  const { pending, errors, saveAndContinue } = useStepSave("bio");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [links, setLinks] = useState<ProfileLink[]>(initial.links);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const draftKind = draft.trim() ? detectLinkKind(draft) : null;

  function addLink() {
    const kind = detectLinkKind(draft);
    const result = normalizeLinkUrl(kind, draft);
    if (!result.ok) {
      setDraftError(result.error);
      return;
    }
    if (links.some((l) => l.url === result.url)) {
      setDraftError("That link is already on your list.");
      return;
    }
    setLinks([...links, { kind, url: result.url }]);
    setDraft("");
    setDraftError(null);
    setAdding(links.length + 1 < MAX_LINKS);
  }

  function submit() {
    saveAndContinue(() => saveBioStep({ bio: bio || null, links }));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="ob-bio" className="text-xs">
          Bio
        </Label>
        <Textarea
          id="ob-bio"
          rows={3}
          value={bio}
          maxLength={SETUP_BIO_MAX}
          placeholder="Junior in CS. I run client projects and like building internal tools."
          onChange={(e) => setBio(e.target.value)}
          className="min-h-20 resize-none"
        />
        <span className="text-muted-foreground justify-self-end font-mono text-[11px] tabular-nums">
          {bio.length}/{SETUP_BIO_MAX}
        </span>
        <FieldError message={errors.bio} />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium">Links</span>
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {links.length} / {MAX_LINKS}
          </span>
        </div>
        <ul className="grid gap-1.5">
          {links.map((link, i) => (
            <li
              key={link.url}
              className="bg-muted/40 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs"
            >
              <span className="text-muted-foreground w-16 shrink-0">
                {LINK_KIND_META[link.kind].label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                {shortUrl(link.url)}
              </span>
              <button
                type="button"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground rounded p-0.5"
                aria-label={`Remove ${LINK_KIND_META[link.kind].label} link`}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {errors[`links`] && <FieldError message={errors.links} />}
          {Object.entries(errors)
            .filter(([k]) => k.startsWith("links."))
            .slice(0, 1)
            .map(([k, v]) => (
              <FieldError key={k} message={v} />
            ))}
        </ul>
        {adding ? (
          <div className="grid gap-1.5">
            <div className="flex gap-1.5">
              <Input
                aria-label="Link URL"
                placeholder="github.com/your-handle"
                value={draft}
                autoFocus
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                  if (e.key === "Escape") setAdding(false);
                }}
                className="font-mono text-xs"
              />
              <button
                type="button"
                onClick={addLink}
                className="hover:bg-muted rounded-md border px-3 text-xs font-medium"
              >
                Add
              </button>
            </div>
            {draftKind && !draftError && (
              <p className="text-muted-foreground text-xs">
                Detected: {LINK_KIND_META[draftKind].label}
              </p>
            )}
            <FieldError message={draftError ?? undefined} />
          </div>
        ) : (
          links.length < MAX_LINKS && (
            <DashedButton onClick={() => setAdding(true)}>+ Add link</DashedButton>
          )
        )}
      </div>

      <FieldError message={errors.form} />
      <StepNav step="bio" pending={pending} onContinue={submit} />
    </div>
  );
}
