"use client";

import { ChevronDown, X } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChoices } from "@/components/ui/phone-toolbar";
import { chipClass } from "@/components/ui/segmented";

/** The order, beside the search (Files' toolbar) and in the phone's sheet. */
export const NOTE_SORT_OPTIONS = [
  { value: "edited", label: "Edited" },
  { value: "created", label: "Newest" },
  { value: "title", label: "A–Z" },
] as const;

const AUDIENCES = [
  ["all", "Anyone"],
  ["PRIVATE", "Private"],
  ["SHARED", "Shared with me"],
  ["ORGANIZATION", "Everyone"],
] as const;

/**
 * Files › the row of filter chips under the search, as People has: who can
 * see it and who added it, each a chip that opens its choices and reads
 * what's picked, and Clear once anything is. All of it lives in the URL, so
 * a filtered view can be linked and pinned. Personal has one person, so
 * none of it.
 */
export function NotesListFilters({
  members,
  personal = false,
}: {
  members: { userId: string; name: string | null; email: string }[];
  personal?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (personal) return null;

  const visibility = searchParams.get("visibility") ?? "all";
  const author = searchParams.get("author") ?? "all";
  const authorMember = members.find((m) => m.userId === author);
  const audience = AUDIENCES.find(([value]) => value === visibility)?.[1];

  function setParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <>
      <ChipMenu
        label="Access"
        on={visibility !== "all"}
        display={audience}
        value={visibility}
        options={AUDIENCES.map(([value, label]) => ({ value, label }))}
        onChange={(v) => setParams({ visibility: v })}
      />
      {members.length > 1 && (
        <ChipMenu
          label="Added by"
          on={author !== "all"}
          display={authorMember ? (authorMember.name ?? authorMember.email) : undefined}
          value={author}
          options={[
            { value: "all", label: "Anyone" },
            ...members.map((m) => ({ value: m.userId, label: m.name ?? m.email })),
          ]}
          onChange={(v) => setParams({ author: v })}
        />
      )}
      {(visibility !== "all" || author !== "all") && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setParams({ visibility: null, author: null })}
        >
          <X aria-hidden="true" />
          Clear
        </Button>
      )}
    </>
  );
}

/** One filter chip: its name, or "Name: choice" once one is picked. */
function ChipMenu({
  label,
  on,
  display,
  value,
  options,
  onChange,
}: {
  label: string;
  on: boolean;
  display: string | undefined;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipClass(on)}>
          {on && display ? `${label}: ${display}` : label}
          <ChevronDown aria-hidden="true" className="opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The same filters and order for the phone's filter sheet (the library adds
 * the folder; All, Notes and Uploads are the page's tabs): each one a named
 * row of chips.
 */
export function NotesFilterChoices({
  members,
  personal = false,
}: {
  members: { userId: string; name: string | null; email: string }[];
  /** A Personal space: everything is yours alone, so no "who can see it". */
  personal?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value !== fallback) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <>
      {!personal && (
        <FilterChoices
          title="Access"
          value={searchParams.get("visibility") ?? "all"}
          onPick={(v) => setParam("visibility", v, "all")}
          options={AUDIENCES.map(([value, label]) => ({ value, label }))}
        />
      )}
      {members.length > 1 && (
        <FilterChoices
          title="Added by"
          value={searchParams.get("author") ?? "all"}
          onPick={(v) => setParam("author", v, "all")}
          options={[
            { value: "all", label: "Anyone" },
            ...members.map((m) => ({ value: m.userId, label: m.name ?? m.email })),
          ]}
        />
      )}
      <FilterChoices
        title="Sort by"
        value={searchParams.get("sort") ?? "edited"}
        onPick={(v) => setParam("sort", v, "edited")}
        options={[...NOTE_SORT_OPTIONS]}
      />
    </>
  );
}
