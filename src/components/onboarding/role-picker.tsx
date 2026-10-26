"use client";

import {
  ClipboardList,
  CodeXml,
  Crown,
  Handshake,
  Megaphone,
  NotebookPen,
  PartyPopper,
  PenLine,
  PenTool,
  PiggyBank,
  Star,
  UserRound,
  type IconComponent,
} from "@/components/icons";

import { Chip } from "@/components/onboarding/step-fields";
import { Input } from "@/components/ui/input";
import { MAX_TITLE, ROLE_CHOICES } from "@/lib/onboarding/steps";

const ROLE_ICONS: Record<(typeof ROLE_CHOICES)[number], IconComponent> = {
  President: Crown,
  "Vice President": Star,
  Treasurer: PiggyBank,
  Secretary: NotebookPen,
  "Project Manager": ClipboardList,
  Developer: CodeXml,
  Designer: PenTool,
  Marketing: Megaphone,
  Events: PartyPopper,
  Outreach: Handshake,
  Member: UserRound,
};

/** The picker's state: a listed role, "other" with typed text, or nothing. */
export interface RoleValue {
  choice: string;
  custom: string;
}

const OTHER = "__other__";

export function initialRoleValue(title: string | null): RoleValue {
  if (!title) return { choice: "", custom: "" };
  return (ROLE_CHOICES as readonly string[]).includes(title)
    ? { choice: title, custom: "" }
    : { choice: OTHER, custom: title };
}

/** The title to save: the chip, the typed text, or null. */
export function roleTitle(value: RoleValue): string | null {
  const title = value.choice === OTHER ? value.custom : value.choice;
  return title.trim() ? title : null;
}

/** Role chips plus "Something else" with a text box. */
export function RolePicker({
  value,
  onChange,
  labelledBy,
}: {
  value: RoleValue;
  onChange: (value: RoleValue) => void;
  labelledBy: string;
}) {
  const { choice, custom } = value;
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={labelledBy}>
        {ROLE_CHOICES.map((r) => (
          <Chip
            key={r}
            icon={ROLE_ICONS[r]}
            selected={choice === r}
            onClick={() => onChange({ choice: choice === r ? "" : r, custom })}
          >
            {r}
          </Chip>
        ))}
        <Chip
          icon={PenLine}
          selected={choice === OTHER}
          onClick={() => onChange({ choice: choice === OTHER ? "" : OTHER, custom })}
        >
          Something else
        </Chip>
      </div>
      {choice === OTHER && (
        <Input
          aria-label="Your role"
          placeholder="e.g. Head of Partnerships"
          maxLength={MAX_TITLE}
          value={custom}
          onChange={(e) => onChange({ choice, custom: e.target.value })}
          autoFocus
        />
      )}
    </>
  );
}
