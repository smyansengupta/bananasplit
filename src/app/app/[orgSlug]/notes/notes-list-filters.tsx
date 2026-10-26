"use client";

import { ListFilter, UserRound } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterChoices } from "@/components/ui/phone-toolbar";

/** `tab` keeps its old name so existing links (`?tab=files`) still land on uploads. */
const KINDS = [
  ["all", "Everything"],
  ["notes", "Notes"],
  ["files", "Uploads"],
] as const;

const AUDIENCES = [
  ["all", "Anyone"],
  ["PRIVATE", "Private"],
  ["SHARED", "Shared with me"],
  ["ORGANIZATION", "Everyone in the club"],
] as const;

/**
 * Files › the library's filter and order: one Filter menu (what kind, who
 * can see it, who added it) and a sort. Both live in the URL, so a filtered
 * view can be linked and pinned. Personal has one person, so only the kind.
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

  const kind = searchParams.get("tab") ?? "all";
  const visibility = searchParams.get("visibility") ?? "all";
  const author = searchParams.get("author") ?? "all";
  const active = [kind, visibility, author].filter((v) => v !== "all").length;
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

  // Picking an option keeps the menu open, so several filters can be set in one go.
  const keepOpen = (e: Event) => e.preventDefault();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <ListFilter className="size-4" aria-hidden="true" />
            Filter
            {active > 0 && (
              <span className="bg-muted text-muted-foreground rounded-md px-1.5 text-xs tabular-nums">
                {active}
                <span className="sr-only"> on</span>
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={kind} onValueChange={(v) => setParams({ tab: v })}>
            {KINDS.map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value} onSelect={keepOpen}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {!personal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Who can see it</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={visibility}
                onValueChange={(v) => setParams({ visibility: v })}
              >
                {AUDIENCES.map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value} onSelect={keepOpen}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserRound className="size-4" aria-hidden="true" />
                  Added by
                  <span className="text-muted-foreground ms-auto max-w-28 truncate text-xs">
                    {authorMember ? (authorMember.name ?? authorMember.email) : "Anyone"}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={author}
                    onValueChange={(v) => setParams({ author: v })}
                  >
                    <DropdownMenuRadioItem value="all">Anyone</DropdownMenuRadioItem>
                    {members.map((m) => (
                      <DropdownMenuRadioItem key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
          {active > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setParams({ tab: null, visibility: null, author: null })}
              >
                Clear filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Select
        value={searchParams.get("sort") ?? "edited"}
        onValueChange={(v) => setParams({ sort: v === "edited" ? null : v })}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Sort">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="edited">Recently edited</SelectItem>
          <SelectItem value="created">Newest</SelectItem>
          <SelectItem value="title">Title A–Z</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

const SORTS = [
  ["edited", "Recently edited"],
  ["created", "Newest"],
  ["title", "Title A–Z"],
] as const;

/**
 * The same filters and order for the phone's filter sheet (the library adds
 * the folder): each one a named row of chips.
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
      <FilterChoices
        title="Show"
        value={searchParams.get("tab") ?? "all"}
        onPick={(v) => setParam("tab", v, "all")}
        options={KINDS.map(([value, label]) => ({ value, label }))}
      />
      {!personal && (
        <FilterChoices
          title="Who can see it"
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
        options={SORTS.map(([value, label]) => ({ value, label }))}
      />
    </>
  );
}
