"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NotesListFilters({
  members,
}: {
  members: { userId: string; name: string | null; email: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={searchParams.get("visibility") ?? "all"}
        onValueChange={(v) => setParam("visibility", v)}
      >
        <SelectTrigger className="h-9 w-36" aria-label="Visibility">
          <SelectValue placeholder="Visibility" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Anyone can see</SelectItem>
          <SelectItem value="PRIVATE">Only me</SelectItem>
          <SelectItem value="ORGANIZATION">Shared</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("author") ?? "all"}
        onValueChange={(v) => setParam("author", v)}
      >
        <SelectTrigger className="h-9 w-36" aria-label="Author">
          <SelectValue placeholder="Author" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Anyone</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name ?? m.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("sort") ?? "edited"} onValueChange={(v) => setParam("sort", v === "edited" ? null : v)}>
        <SelectTrigger className="h-9 w-40" aria-label="Sort">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="edited">Recently edited</SelectItem>
          <SelectItem value="created">Newest</SelectItem>
          <SelectItem value="title">Title A–Z</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
