"use client";

import { ArrowDown, ArrowUp, Check, Plus, Trash2, Unlink } from "lucide-react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { confirmMember, toTree, unlinkMember, type DraftPosition } from "@/lib/org-chart/draft";
import { matchPerson } from "@/lib/org-chart/match";
import { descendantIds } from "@/lib/org-chart/tree";
import type { ValidationIssue } from "@/lib/org-chart/validate";

import { BulletListEditor } from "./bullet-list-editor";
import { MemberPicker, type EditorMember } from "./member-picker";

/**
 * Editing one position of a draft: title, person (link a member, confirm a
 * suggestion, or keep a placeholder name), reporting line (the keyboard and
 * touch alternative to dragging), advisor and open-hire toggles, and the
 * responsibilities and decides-alone bullets. Source quotes from the parse
 * are shown read-only so the admin can check them.
 */

const NOBODY = "__none__";

export function PositionEditor({
  position,
  positions,
  members,
  issues,
  onChange,
  onSetManager,
  onMove,
  onAddReport,
  onRemove,
}: {
  position: DraftPosition;
  positions: DraftPosition[];
  members: EditorMember[];
  issues: ValidationIssue[];
  onChange: (next: DraftPosition) => void;
  onSetManager: (managerId: string | null) => void;
  onMove: (direction: -1 | 1) => void;
  onAddReport: () => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const membersById = new Map(members.map((m) => [m.id, m]));
  const linked = position.userId ? membersById.get(position.userId) : undefined;
  const blocked = descendantIds(toTree(positions), position.id);
  const managerOptions = positions
    .filter((p) => !blocked.has(p.id) && !p.isAdvisor)
    .sort((a, b) => a.title.localeCompare(b.title));
  const hasReports = positions.some((p) => p.reportsTo === position.id);
  const suggestions = position.suggestedUserIds
    .map((id) => membersById.get(id))
    .filter((m): m is EditorMember => Boolean(m));

  const rematch = (name: string | null) => {
    if (position.userId || position.isOpen) return;
    const match = matchPerson(
      name,
      members.map((m) => ({ userId: m.id, name: m.name })),
    );
    onChange({
      ...position,
      personName: name,
      matchState: match.state,
      matchScore: match.score,
      suggestedUserIds: match.suggestions.map((s) => s.userId),
    });
  };

  return (
    <div className="space-y-6">
      {issues.length > 0 && (
        <ul className="space-y-1" aria-label="Problems with this position">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={
                issue.level === "error"
                  ? "border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2 text-sm"
                  : "rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
              }
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${uid}-title`}>Title</Label>
        <Input
          id={`${uid}-title`}
          value={position.title}
          maxLength={120}
          onChange={(e) => onChange({ ...position, title: e.target.value })}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${uid}-open`}>Open hire</Label>
          <Switch
            id={`${uid}-open`}
            checked={position.isOpen}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? { ...position, isOpen: true, userId: null, matchState: "UNMATCHED", suggestedUserIds: [], matchScore: null }
                  : { ...position, isOpen: false },
              )
            }
          />
        </div>

        {!position.isOpen && (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-person`}>Person (name as written)</Label>
              <Input
                id={`${uid}-person`}
                value={position.personName ?? ""}
                maxLength={120}
                placeholder="Nobody named"
                onChange={(e) => onChange({ ...position, personName: e.target.value || null })}
                onBlur={(e) => rematch(e.target.value.trim() || null)}
              />
            </div>

            {linked ? (
              <div className="bg-muted/50 flex items-center gap-3 rounded-lg border p-3">
                <UserAvatar user={linked} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{linked.name}</p>
                  <p className="text-muted-foreground text-xs">Linked member · shows their picture and profile</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(unlinkMember(position))}>
                  <Unlink className="size-4" aria-hidden="true" />
                  Unlink
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {suggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">
                      Suggested match{suggestions.length > 1 ? "es" : ""} for “{position.personName}”. Nothing is linked
                      until you confirm.
                    </p>
                    <ul className="space-y-1">
                      {suggestions.map((m, i) => (
                        <li key={m.id} className="flex items-center gap-2">
                          <UserAvatar user={m} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {m.name}
                            {i === 0 && position.matchScore === 1 && (
                              <Badge variant="secondary" className="ml-2">
                                Exact
                              </Badge>
                            )}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onChange(confirmMember(position, m.id, m.name))}
                          >
                            <Check className="size-4" aria-hidden="true" />
                            Confirm
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <MemberPicker
                  members={members}
                  value={position.userId}
                  suggestedIds={position.suggestedUserIds}
                  onSelect={(m) => onChange(confirmMember(position, m.id, m.name))}
                />
                {position.personName && (
                  <p className="text-muted-foreground text-xs">
                    Not linked: {position.personName} shows as a placeholder (“Not on the portal”).
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-manager`}>Reports to</Label>
        <Select
          value={position.reportsTo ?? NOBODY}
          onValueChange={(value) => onSetManager(value === NOBODY ? null : value)}
        >
          <SelectTrigger id={`${uid}-manager`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>Nobody (top of the chart)</SelectItem>
            {managerOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title || "Untitled position"}
                {p.personName ? ` · ${p.personName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" aria-hidden="true" />
            Move up
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onMove(1)}>
            <ArrowDown className="size-4" aria-hidden="true" />
            Move down
          </Button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor={`${uid}-advisor`}>Advisor</Label>
          <p className="text-muted-foreground text-xs">
            Shown beside their manager, outside the main hierarchy. An advisor has a manager and no reports.
          </p>
        </div>
        <Switch
          id={`${uid}-advisor`}
          checked={position.isAdvisor}
          disabled={!position.isAdvisor && (hasReports || position.reportsTo === null)}
          onCheckedChange={(checked) => onChange({ ...position, isAdvisor: checked })}
        />
      </div>

      <BulletListEditor
        label="Responsibilities"
        items={position.responsibilities}
        placeholder="Owns the semester calendar"
        onChange={(responsibilities) => onChange({ ...position, responsibilities })}
      />
      <BulletListEditor
        label="Decides alone"
        items={position.decidesAlone}
        placeholder="Approving spend under the set limit"
        onChange={(decidesAlone) => onChange({ ...position, decidesAlone })}
      />

      {position.sourceQuote.length > 0 && (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Where the import read this from</summary>
          <ul className="text-muted-foreground mt-2 space-y-1 border-l pl-3">
            {position.sourceQuote.map((q, i) => (
              <li key={i} className="font-mono text-xs break-words whitespace-pre-wrap">
                {q}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onAddReport} disabled={position.isAdvisor}>
          <Plus className="size-4" aria-hidden="true" />
          Add a report
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
          <Trash2 className="size-4" aria-hidden="true" />
          Delete position
        </Button>
      </div>
    </div>
  );
}
