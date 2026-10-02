"use client";

import {
  AtSign,
  Briefcase,
  Camera,
  CodeXml,
  Globe,
  Link2,
  Music2,
  NotebookPen,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { DashedButton, FieldError, FieldLabel } from "@/components/onboarding/step-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { detectLinkKind, SETUP_BIO_MAX } from "@/lib/onboarding/steps";
import {
  LINK_KIND_META,
  MAX_LINKS,
  normalizeLinkUrl,
  type LinkKind,
  type ProfileLink,
} from "@/lib/profile/links";

import { saveBioStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

const KIND_ICONS: Record<LinkKind, LucideIcon> = {
  linkedin: Briefcase,
  github: CodeXml,
  website: Globe,
  instagram: Camera,
  tiktok: Music2,
  x: AtSign,
  other: Link2,
};

function LinkKindIcon({ kind, small = false }: { kind: LinkKind; small?: boolean }) {
  const Icon = KIND_ICONS[kind];
  if (small) return <Icon className="size-3.5" aria-hidden="true" />;
  return <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />;
}

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
    <div className="space-y-5">
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="ob-bio" icon={NotebookPen} aside={`${bio.length}/${SETUP_BIO_MAX}`}>
          Bio
        </FieldLabel>
        <Textarea
          id="ob-bio"
          rows={3}
          value={bio}
          maxLength={SETUP_BIO_MAX}
          placeholder="Junior in CS. I run client projects and like building internal tools."
          onChange={(e) => setBio(e.target.value)}
          className="min-h-20 resize-none"
        />
        <FieldError message={errors.bio} />
      </div>

      <div className="grid gap-1.5">
        <FieldLabel icon={Link2} aside={`${links.length} / ${MAX_LINKS}`}>
          Links
        </FieldLabel>
        <ul className="grid gap-1.5">
          {links.map((link, i) => (
            <li
              key={link.url}
              className="bg-muted/40 animate-in fade-in-0 slide-in-from-top-1 flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-sm duration-200"
            >
              <LinkKindIcon kind={link.kind} />
              <span className="text-muted-foreground w-16 shrink-0 text-xs">
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
                placeholder="linkedin.com/in/your-name"
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
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <LinkKindIcon kind={draftKind} small />
                Detected: {LINK_KIND_META[draftKind].label}
              </p>
            )}
            <FieldError message={draftError ?? undefined} />
          </div>
        ) : (
          links.length < MAX_LINKS && (
            <DashedButton icon={Plus} onClick={() => setAdding(true)}>
              Add link
            </DashedButton>
          )
        )}
      </div>

      <FieldError message={errors.form} />
      <StepNav step="bio" pending={pending} onContinue={submit} />
    </div>
  );
}
