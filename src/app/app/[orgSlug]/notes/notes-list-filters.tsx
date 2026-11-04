"use client";

import { ChevronDown } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChoices } from "@/components/ui/phone-toolbar";
import { chipClass } from "@/components/ui/segmented";
import { FiltersMenu } from "@/components/ui/toolbar-chips";

/** The order, in the Filters panel and the phone's sheet. */
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
 * Files' Filters chip (as on Tasks and People): one panel with the order,
 * who can see it and who added it, each reading what's picked. All of it
 * lives in the URL, so a filtered view can be linked and pinned. Personal
 * has one person, so only the order.
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

  const sort = searchParams.get("sort") ?? "edited";
  const visibility = searchParams.get("visibility") ?? "all";
  const author = searchParams.get("author") ?? "all";
  const authorMember = members.find((m) => m.userId === author);

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
    <FiltersMenu
      count={(visibility !== "all" ? 1 : 0) + (author !== "all" ? 1 : 0)}
      items={[
        {
          name: "Sort by",
          node: (
            <ChipMenu
              text={NOTE_SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Edited"}
              on={false}
              value={sort}
              options={[...NOTE_SORT_OPTIONS]}
              onChange={(v) => setParams({ sort: v === "edited" ? null : v })}
            />
          ),
        },
        ...(!personal
          ? [
              {
                name: "Access",
                node: (
                  <ChipMenu
                    text={AUDIENCES.find(([value]) => value === visibility)?.[1] ?? "Anyone"}
                    on={visibility !== "all"}
                    value={visibility}
                    options={AUDIENCES.map(([value, label]) => ({ value, label }))}
                    onChange={(v) => setParams({ visibility: v })}
                  />
                ),
              },
            ]
          : []),
        ...(!personal && members.length > 1
          ? [
              {
                name: "Added by",
                node: (
                  <ChipMenu
                    text={authorMember ? (authorMember.name ?? authorMember.email) : "Anyone"}
                    on={author !== "all"}
                    value={author}
                    options={[
                      { value: "all", label: "Anyone" },
                      ...members.map((m) => ({ value: m.userId, label: m.name ?? m.email })),
                    ]}
                    onChange={(v) => setParams({ author: v })}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/** One filter in the panel: what's picked, opening the choices. */
function ChipMenu({
  text,
  on,
  value,
  options,
  onChange,
}: {
  text: string;
  on: boolean;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipClass(on)}>
          <span className="truncate">{text}</span>
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
 * the folder and All, Notes or Uploads): each one a named row of chips.
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
