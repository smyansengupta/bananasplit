"use client";

import { useId, useState, type ReactNode } from "react";

import { Check, Plus, UserPlus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import {
  confirmMember,
  extraManagerOptions,
  toOpenRole,
  toTree,
  type DraftPosition,
} from "@/lib/org-chart/draft";
import { outlineOrder } from "@/lib/org-chart/outline";
import { visibleQuotes } from "@/lib/org-chart/self-place";
import type { NamedTeam } from "@/lib/org-chart/teams";
import { descendantIds } from "@/lib/org-chart/tree";
import type { ValidationIssue } from "@/lib/org-chart/validate";
import { cn } from "@/lib/utils";

import { BulletListEditor } from "./bullet-list-editor";
import { MemberPicker, type EditorMember } from "./member-picker";

/**
 * One position, edited in the editor's side panel (or the phone's bottom
 * sheet, `layout="sheet"`): title, who holds it, who it reports to and
 * what they do up front; advisor, second managers, decisions, team and
 * the import's quotes under More. The panel ends with Remove position and
 * Make it an open role; the sheet with Add under and Done.
 */

const TOP = "__top__";
const NO_TEAM = "__none__";

export interface PositionFieldsProps {
  position: DraftPosition;
  positions: DraftPosition[];
  members: EditorMember[];
  teams: NamedTeam[];
  issues: ValidationIssue[];
  layout: "panel" | "sheet";
  onChange: (next: DraftPosition) => void;
  onSetManager: (managerId: string | null) => void;
  onAddAlso: (managerId: string) => void;
  onRemoveAlso: (managerId: string) => void;
  onAddUnder: () => void;
  onRemove: () => void;
  onSelect: (id: string) => void;
  /** Makes a team and puts this position on it. */
  onNewTeam: (name: string) => void;
  onClose: () => void;
  /** "Invite someone" for an open role, when the viewer may invite. */
  invite?: ReactNode;
}

function nameOf(p: DraftPosition, members: ReadonlyMap<string, EditorMember>): string | null {
  if (p.isOpen) return null;
  return (p.userId ? members.get(p.userId)?.name : null) ?? p.personName;
}

export function PositionFields({
  position,
  positions,
  members,
  teams,
  issues,
  layout,
  onChange,
  onSetManager,
  onAddAlso,
  onRemoveAlso,
  onAddUnder,
  onRemove,
  onSelect,
  onNewTeam,
  onClose,
  invite,
}: PositionFieldsProps) {
  const uid = useId();
  const [teamName, setTeamName] = useState("");
  const byMember = new Map(members.map((m) => [m.id, m]));
  const byId = new Map(positions.map((p) => [p.id, p]));
  const linked = position.userId ? byMember.get(position.userId) : undefined;
  const suggestion =
    !position.userId && !position.isOpen && position.suggestedUserIds[0]
      ? byMember.get(position.suggestedUserIds[0])
      : undefined;
  const below = descendantIds(toTree(positions), position.id);
  const managers = outlineOrder(positions)
    .map((o) => o.position)
    .filter((p) => p.id !== position.id && !below.has(p.id) && !p.isAdvisor);
  const reports = outlineOrder(positions)
    .map((o) => o.position)
    .filter((p) => p.reportsTo === position.id);
  const hasReports = reports.length > 0;
  const also = (position.alsoReportsTo ?? []).filter((id) => id !== position.reportsTo);
  const alsoOptions = extraManagerOptions(positions, position.id);
  const quotes = visibleQuotes(position.sourceQuote);
  const sheet = layout === "sheet";
  const field = sheet ? "h-[46px] text-base" : undefined;
  const label = (p: DraftPosition) => {
    const who = nameOf(p, byMember);
    return `${p.title || "Untitled position"}${who ? `, ${who}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {linked ? (
          <UserAvatar user={linked} size="lg" />
        ) : (
          <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full">
            <UserPlus className="size-[18px]" aria-hidden="true" />
          </span>
        )}
        <h2 className="heading min-w-0 flex-1 text-lg break-words">
          {position.title || "Untitled position"}
        </h2>
        {!sheet && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="To fix on this position">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={cn(
                "rounded-tile px-3 py-2 text-[13px] leading-snug",
                issue.level === "error" ? "bg-tint-danger" : "bg-tint-accent",
              )}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-title`}>Title</Label>
        <Input
          id={`${uid}-title`}
          value={position.title}
          maxLength={120}
          className={field}
          onChange={(e) => onChange({ ...position, title: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Who holds it</Label>
        <MemberPicker
          members={members}
          value={position.userId}
          suggestedIds={position.suggestedUserIds}
          onSelect={(m) =>
            onChange(confirmMember({ ...position, personName: m.name }, m.id, m.name))
          }
        />
        {suggestion && (
          <p className="bg-muted/60 rounded-tile flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1">
              Is <b className="font-semibold">{position.personName}</b> {suggestion.name}?
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => onChange(confirmMember(position, suggestion.id, suggestion.name))}
            >
              <Check aria-hidden="true" />
              Yes
            </Button>
          </p>
        )}
        {!position.userId && !suggestion && position.personName && !position.isOpen && (
          <p className="text-muted-foreground text-[12.5px]">
            {position.personName} isn&apos;t a member yet. Pick them above once they join.
          </p>
        )}
        {position.isOpen && (
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-[12.5px]">
            An open role. Pick who holds it, or invite someone.
            {invite}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-reports`}>Reports to</Label>
        <Select
          value={position.reportsTo ?? TOP}
          onValueChange={(v) => onSetManager(v === TOP ? null : v)}
        >
          <SelectTrigger id={`${uid}-reports`} className={cn("w-full", field)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOP}>Nobody, the top of the chart</SelectItem>
            {managers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {label(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!sheet && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-does`}>What they do</Label>
            <Textarea
              id={`${uid}-does`}
              rows={3}
              value={position.responsibilities.join("\n")}
              placeholder="One thing per line"
              onChange={(e) =>
                onChange({ ...position, responsibilities: e.target.value.split("\n").slice(0, 25) })
              }
            />
          </div>

          {reports.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">Their team</span>
              {reports.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="bg-secondary hover:bg-muted-strong focus-glow inline-flex h-7 max-w-[14rem] items-center rounded-full px-2.5 text-xs font-semibold outline-none"
                >
                  <span className="truncate">
                    {p.isOpen ? `Open: ${p.title}` : (nameOf(p, byMember) ?? p.title)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <details className="group text-sm">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[13px] font-semibold">
              More
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <Label htmlFor={`${uid}-advisor`}>Advisor</Label>
                  <span className="text-muted-foreground block text-[12.5px]">
                    Sits beside their manager, outside the line of reporting.
                  </span>
                </span>
                <Switch
                  id={`${uid}-advisor`}
                  checked={position.isAdvisor}
                  disabled={!position.isAdvisor && (hasReports || position.reportsTo === null)}
                  onCheckedChange={(checked) => onChange({ ...position, isAdvisor: checked })}
                />
              </div>

              {!position.isAdvisor && position.reportsTo !== null && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${uid}-also`}>Also reports to</Label>
                  {also.map((id) => (
                    <span
                      key={id}
                      className="bg-muted/60 flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-[13px]"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {byId.get(id) ? label(byId.get(id)!) : "A position not in this draft"}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${byId.get(id)?.title ?? "this manager"}`}
                        onClick={() => onRemoveAlso(id)}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </span>
                  ))}
                  {alsoOptions.length > 0 && (
                    <Select value="" onValueChange={(v) => v && onAddAlso(v)}>
                      <SelectTrigger id={`${uid}-also`} className="w-full">
                        <SelectValue placeholder="A dotted line to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {alsoOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {label(p)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <BulletListEditor
                label="Decides alone"
                items={position.decidesAlone}
                placeholder="Approving spend under the set limit"
                onChange={(decidesAlone) => onChange({ ...position, decidesAlone })}
              />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-team`}>Team</Label>
                {teams.length > 0 && (
                  <Select
                    value={position.teamId ?? NO_TEAM}
                    onValueChange={(v) =>
                      onChange({ ...position, teamId: v === NO_TEAM ? null : v })
                    }
                  >
                    <SelectTrigger id={`${uid}-team`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEAM}>Their manager&apos;s team</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!teamName.trim()) return;
                    onNewTeam(teamName.trim());
                    setTeamName("");
                  }}
                >
                  <Input
                    id={teams.length > 0 ? undefined : `${uid}-team`}
                    value={teamName}
                    maxLength={60}
                    placeholder="A new team, like Finance"
                    aria-label="New team name"
                    onChange={(e) => setTeamName(e.target.value)}
                  />
                  <Button type="submit" variant="outline" disabled={!teamName.trim()}>
                    <Plus aria-hidden="true" />
                    Add
                  </Button>
                </form>
              </div>

              {quotes.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold">Where the import read this</span>
                  <ul className="text-muted-foreground flex flex-col gap-1 border-l pl-3 text-xs">
                    {quotes.map((q, i) => (
                      <li key={i} className="break-words whitespace-pre-wrap">
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </>
      )}

      {sheet ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="outline"
              className="h-[46px]"
              disabled={position.isAdvisor}
              onClick={onAddUnder}
            >
              Add under
            </Button>
            <Button type="button" className="h-[46px]" onClick={onClose}>
              Done
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="text-tint-danger-foreground h-11"
            onClick={onRemove}
          >
            Remove position
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-tint-danger-foreground -ml-2"
            onClick={onRemove}
          >
            Remove position
          </Button>
          <span className="flex-1" />
          {!position.isOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(toOpenRole(position))}
            >
              Make it an open role
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
