"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import type { LinkRef } from "@/lib/links";
import { epicColor } from "@/lib/tasks/epic";
import type { TaskTypeValue } from "@/lib/tasks/hierarchy";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

import { MentionTextarea } from "./mention-textarea";
import { HashTagHint } from "./tag-menu";
import { TitleInput } from "./task-title-field";
import {
  LabelsField,
  OwnerField,
  PeopleField,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from "./task-fields";
import type { LabelOption, ParentOption } from "./types";

const NONE = "__none";

/** One field's value and its setter. */
type Bind<T> = { value: T; set: (next: T) => void };

/**
 * The task form's fields, the same for New task and for editing one, so the
 * two can't drift apart. In one column, top to bottom: title, type and
 * priority, owner and who else, the epic (an epic's colour instead) and the
 * due date, then the description, tags, status and who can see it, the
 * start for epics and stories, and what a blocked task waits on. The
 * parent owns the state and the saving; this only draws.
 */
export function TaskFormFields({
  title,
  type,
  typeChoices,
  priority,
  owner,
  ownerAbove,
  people,
  parent,
  parentChoices,
  color,
  due,
  dueRequired,
  description,
  descriptionAudience,
  linkFrom,
  onSubmitShortcut,
  labels,
  labelOptions,
  status,
  visibility,
  visibilityLocked,
  visibilityExtra,
  start,
  blockedReason,
  error,
  readOnly = false,
  autoFocus = false,
}: {
  title: Bind<string>;
  type: Bind<TaskTypeValue>;
  typeChoices: readonly { value: TaskTypeValue; label: string }[];
  priority: Bind<TaskPriority>;
  owner: Bind<string | null>;
  /** The owner picked is above the viewer on the org chart (it'll be flagged). */
  ownerAbove: boolean;
  people: Bind<string[]>;
  parent: Bind<string | null>;
  parentChoices: readonly ParentOption[];
  color: Bind<string | null>;
  due: Bind<string>;
  dueRequired: boolean;
  description: Bind<string>;
  /** C4: on a private task, the only people who may be mentioned. */
  descriptionAudience?: readonly string[] | null;
  /** The saved task, so `@` can link things to it. */
  linkFrom?: LinkRef | null;
  onSubmitShortcut?: () => void;
  labels: Bind<string[]>;
  labelOptions: LabelOption[];
  status: Bind<TaskStatus>;
  visibility: Bind<TaskVisibility>;
  /** Why who-can-see-it can't change here (a subtask, or not theirs to change). */
  visibilityLocked: string | null;
  /** Under who-can-see-it: who a private task's audience is. */
  visibilityExtra?: React.ReactNode;
  start: Bind<string>;
  blockedReason: Bind<string>;
  error: string | null;
  readOnly?: boolean;
  autoFocus?: boolean;
}) {
  const isEpic = type.value === "EPIC";
  const hasStart = type.value === "EPIC" || type.value === "STORY";

  return (
    <>
      <div className="flex flex-col gap-4 px-6 pt-2 pb-4">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="task-title">Title</Label>
          <TitleInput
            id="task-title"
            value={title.value}
            onChange={title.set}
            autoFocus={autoFocus}
            disabled={readOnly}
            required
            maxLength={200}
            placeholder={
              isEpic ? "e.g. Annual showcase" : "e.g. Book the room (#tag, /file to link one)"
            }
          />
          {!readOnly && <HashTagHint title={title.value} />}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-type">Type</Label>
            <Select
              value={type.value}
              disabled={readOnly || typeChoices.length < 2}
              onValueChange={(v) => type.set(v as TaskTypeValue)}
            >
              <SelectTrigger id="task-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeChoices.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-priority">Priority</Label>
            <Select
              value={priority.value}
              disabled={readOnly}
              onValueChange={(v) => priority.set(v as TaskPriority)}
            >
              <SelectTrigger id="task-priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-owner">Owner</Label>
            {/*
              The same picker as Who else, so both read the same: faces,
              names and how each person relates to you in the org chart.
            */}
            <OwnerField
              id="task-owner"
              value={owner.value}
              onChange={owner.set}
              disabled={readOnly}
            />
            {ownerAbove && (
              <p className="text-warning text-xs">Above your level: this will be flagged.</p>
            )}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-involved">Who else</Label>
            <PeopleField
              id="task-involved"
              value={people.value}
              onChange={people.set}
              exclude={owner.value}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          {isEpic ? (
            <div className="grid content-start gap-1.5">
              <span className="text-sm leading-none font-medium">Colour</span>
              <div
                role="radiogroup"
                aria-label="Epic colour"
                className="flex flex-wrap gap-1.5 pt-1"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={color.value === null}
                  aria-label="Theme colour"
                  disabled={readOnly}
                  onClick={() => color.set(null)}
                  className={cn(
                    "focus-glow hatch bg-muted size-6 rounded-full",
                    color.value === null && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                  )}
                />
                {LABEL_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color.value === c}
                    aria-label={`Colour ${c}`}
                    disabled={readOnly}
                    onClick={() => color.set(c)}
                    className={cn(
                      "focus-glow size-6 rounded-full",
                      color.value === c && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid content-start gap-1.5">
              <Label htmlFor="task-parent">Epic</Label>
              <Select
                value={parent.value ?? NONE}
                disabled={readOnly}
                onValueChange={(v) => parent.set(v === NONE ? null : v)}
              >
                <SelectTrigger id="task-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not in an epic</SelectItem>
                  {parentChoices
                    .filter((p) => p.type === "EPIC")
                    .flatMap((epic) => [
                      epic,
                      ...parentChoices.filter(
                        (s) => s.type === "STORY" && s.parentTaskId === epic.id,
                      ),
                    ])
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.type === "EPIC" ? (
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: epicColor(p) }}
                          />
                        ) : (
                          <span aria-hidden className="w-2 shrink-0" />
                        )}
                        <span
                          className={cn("truncate", p.type === "STORY" && "text-muted-foreground")}
                        >
                          {p.title}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              type="date"
              value={due.value}
              min={start.value || undefined}
              required={dueRequired}
              disabled={readOnly}
              onChange={(e) => due.set(e.target.value)}
            />
            {dueRequired && !readOnly && (
              <p className="text-muted-foreground text-xs">
                Every task in this organization needs a due date.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-6 pb-5">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="task-description">Description</Label>
          {/* @ mentions a member, / links an organization file, markdown works. */}
          <MentionTextarea
            id="task-description"
            value={description.value}
            onChange={description.set}
            audience={descriptionAudience}
            linkFrom={linkFrom}
            onSubmitShortcut={onSubmitShortcut}
            disabled={readOnly}
            rows={4}
            maxLength={20000}
            placeholder="Markdown, @mentions and /file links work"
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="task-labels">Tags</Label>
          <LabelsField
            id="task-labels"
            labels={labelOptions}
            value={labels.value}
            onChange={labels.set}
            disabled={readOnly}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-status">Status</Label>
            <Select
              value={status.value}
              disabled={readOnly}
              onValueChange={(v) => status.set(v as TaskStatus)}
            >
              <SelectTrigger id="task-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.icon}
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-visibility">Who can see it</Label>
            <Select
              value={visibility.value}
              disabled={readOnly || visibilityLocked !== null}
              onValueChange={(v) => visibility.set(v as TaskVisibility)}
            >
              <SelectTrigger id="task-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TaskVisibility.ORG}>Everyone in the organization</SelectItem>
                <SelectItem value={TaskVisibility.PRIVATE}>Only its people</SelectItem>
              </SelectContent>
            </Select>
            {visibilityLocked && (
              <p className="text-muted-foreground text-xs">{visibilityLocked}</p>
            )}
          </div>
        </div>
        {visibilityExtra}
        {hasStart && (
          <div className="grid content-start gap-1.5 sm:max-w-[50%]">
            <Label htmlFor="task-start">Starts</Label>
            <Input
              id="task-start"
              type="date"
              value={start.value}
              max={due.value || undefined}
              disabled={readOnly}
              onChange={(e) => start.set(e.target.value)}
            />
          </div>
        )}
        {status.value === TaskStatus.BLOCKED && (
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-blocked">Blocked on</Label>
            <Input
              id="task-blocked"
              value={blockedReason.value}
              maxLength={MAX_BLOCKED_REASON}
              disabled={readOnly}
              placeholder="What is it waiting for?"
              onChange={(e) => blockedReason.set(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
