"use client";

import { Plus, Trash2, UsersRound } from "@/components/icons";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { chartTeams, LEADERSHIP_TEAM, type NamedTeam } from "@/lib/org-chart/teams";

import type { EditorMember } from "./member-picker";

const NONE = "__none";

/**
 * The draft's teams (src/lib/org-chart/teams.ts): make teams by name and
 * put each position on one. A position left on "Manager's team" goes with
 * the person it reports to; anyone with no team above them is Leadership.
 * Nothing is worked out from the chart's shape once a team exists, so the
 * head of finance who reports to the president can be on Finance.
 */
export function TeamsEditor({
  teams,
  positions,
  members,
  onTeams,
  onAssign,
}: {
  teams: NamedTeam[];
  positions: DraftPosition[];
  members: EditorMember[];
  onTeams: (next: NamedTeam[]) => void;
  onAssign: (positionId: string, teamId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  // Where everyone lands with the teams as they are now.
  const landed = useMemo(() => {
    const result = chartTeams(
      positions.map((p) => ({
        id: p.id,
        reportsToId: p.reportsTo,
        isAdvisor: p.isAdvisor,
        rank: p.rank,
        title: p.title,
        userId: p.userId,
        teamId: p.teamId ?? null,
      })),
      teams,
    );
    const names = new Map(result.teams.map((t) => [t.key, t.name]));
    return new Map([...result.teamOfPosition].map(([id, key]) => [id, names.get(key) ?? ""]));
  }, [positions, teams]);

  function add() {
    const clean = name.trim().slice(0, 60);
    if (!clean || teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) return;
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    onTeams([...teams, { id, name: clean }]);
    setName("");
  }

  function remove(id: string) {
    onTeams(teams.filter((t) => t.id !== id));
    for (const p of positions) if (p.teamId === id) onAssign(p.id, null);
  }

  const count = (id: string) => positions.filter((p) => p.teamId === id).length;

  return (
    <section aria-labelledby="teams-heading" className="bg-card space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="teams-heading" className="heading flex items-center gap-2 text-[15px]">
            <UsersRound className="size-4" aria-hidden="true" />
            Teams
          </h2>
          <p className="text-muted-foreground max-w-[60ch] text-[13px]">
            Make your teams and put each position on one. A position on its manager&apos;s team
            follows the person it reports to; anyone with no team above them is {LEADERSHIP_TEAM}.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Finance"
            aria-label="New team name"
            maxLength={60}
            className="w-44"
          />
          <Button type="submit" variant="outline" disabled={!name.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Create team
          </Button>
        </form>
      </div>

      {teams.length > 0 && (
        <ul className="flex list-none flex-wrap gap-2 p-0">
          {teams.map((t) => (
            <li
              key={t.id}
              className="bg-muted/60 inline-flex h-9 items-center gap-1 rounded-full ps-1.5 pe-1"
            >
              <Input
                value={t.name}
                aria-label={`Team name: ${t.name}`}
                maxLength={60}
                onChange={(e) =>
                  onTeams(teams.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))
                }
                onBlur={(e) => {
                  if (!e.target.value.trim())
                    onTeams(teams.map((x) => (x.id === t.id ? { ...x, name: "Team" } : x)));
                }}
                className="h-7 w-32 border-transparent bg-transparent px-2 text-[13px] font-semibold"
              />
              <span className="text-muted-foreground text-[12px] tabular-nums">{count(t.id)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete the ${t.name} team`}
                onClick={() => remove(t.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {teams.length > 0 && positions.length > 0 && (
        <ul className="divide-border m-0 list-none divide-y p-0">
          {positions.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {p.title || "Untitled position"}
                </span>
                <span className="text-muted-foreground block truncate text-[12px]">
                  {p.isOpen
                    ? "Open role"
                    : ((p.userId ? nameOf.get(p.userId) : null) ?? p.personName ?? "Nobody yet")}
                </span>
              </span>
              <Select
                value={p.teamId ?? NONE}
                onValueChange={(v) => onAssign(p.id, v === NONE ? null : v)}
              >
                <SelectTrigger
                  className="w-48"
                  aria-label={`Team for ${p.title || "this position"}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    Manager&apos;s team
                    {!p.teamId && landed.get(p.id) ? ` (${landed.get(p.id)})` : ""}
                  </SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
