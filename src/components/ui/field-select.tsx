"use client";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A drop-down that reads like the rest of the app, with a native
 * a native <select>'s shape.
 *
 * A native select draws the operating system's own menu — grey, square,
 * Segoe UI on Windows — which is the one control in the app that ignores
 * the theme. This takes the same props and the same `<option>` children and
 * renders the themed Select instead, so a form keeps working as it was:
 *
 *   <FieldSelect name="role" defaultValue="MEMBER">
 *     <option value="MEMBER">Member</option>
 *     <option value="ADMIN">Admin</option>
 *   </FieldSelect>
 *
 * Controlled, uncontrolled and plain-form-post uses all work. `onChange`
 * is handed an object with `target.value` and `currentTarget.value`, so the
 * handlers a native select had are unchanged. When `name` is set, a hidden
 * input carries the value into FormData, which is how the server actions
 * read these forms.
 *
 * `<optgroup>` becomes a labelled group. An `<option value="">` ("None",
 * "Not set") stays exactly that: Radix will not take an empty item value,
 * so inside here it travels as a sentinel and is turned back into "" on the
 * way out.
 */

/** Radix rejects an item whose value is "", which is how a select spells "nothing". */
const EMPTY = "\u0000empty";

const toKey = (value: string | number | undefined) =>
  value === undefined ? undefined : value === "" ? EMPTY : String(value);
const fromKey = (key: string) => (key === EMPTY ? "" : key);

export interface FieldSelectChangeEvent {
  target: { value: string; name: string };
  currentTarget: { value: string; name: string };
}

interface Choice {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface Group {
  /** An <optgroup>'s label, or null for options at the top level. */
  label: string | null;
  choices: Choice[];
}

/** Reads <option> and <optgroup> children (through arrays and fragments). */
function readGroups(children: React.ReactNode): Group[] {
  const groups: Group[] = [];
  const push = (label: string | null, choice: Choice) => {
    const last = groups.at(-1);
    if (last && last.label === label) last.choices.push(choice);
    else groups.push({ label, choices: [choice] });
  };

  const walk = (node: React.ReactNode, groupLabel: string | null) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children, groupLabel);
        return;
      }
      if (child.type === "optgroup") {
        const props = child.props as { label?: string; children?: React.ReactNode };
        walk(props.children, props.label ?? null);
        return;
      }
      if (child.type === "option") {
        const props = child.props as {
          value?: string | number;
          disabled?: boolean;
          children?: React.ReactNode;
        };
        const value = props.value === undefined ? "" : String(props.value);
        push(groupLabel, {
          value,
          label: props.children ?? value,
          disabled: props.disabled,
        });
      }
    });
  };

  walk(children, null);
  return groups;
}

export function FieldSelect({
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  id,
  className,
  placeholder,
  size = "default",
  children,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: FieldSelectChangeEvent) => void;
  disabled?: boolean;
  /**
   * Blocks submitting with nothing picked, through the hidden native select
   * Radix keeps for exactly this. Picking an `<option value="">` counts as
   * picking something, so give a required field no empty option.
   */
  required?: boolean;
  id?: string;
  /**
   * Goes on the trigger, which is the thing you see and click. Like a
   * native select it is as wide as its value, so a field that should fill
   * its row asks for `w-full`.
   */
  className?: string;
  /** Shown when nothing is picked and there is no empty option to name it. */
  placeholder?: string;
  size?: "sm" | "default";
  children: React.ReactNode;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const groups = React.useMemo(() => readGroups(children), [children]);
  const controlled = value !== undefined;
  const [own, setOwn] = React.useState(() => toKey(defaultValue));
  const key = controlled ? toKey(value) : own;

  const change = (next: string) => {
    if (!controlled) setOwn(next);
    const field = { value: fromKey(next), name: name ?? "" };
    onChange?.({ target: field, currentTarget: field });
  };

  return (
    <>
      <Select value={key} onValueChange={change} disabled={disabled} required={required}>
        <SelectTrigger
          id={id}
          size={size}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          className={className}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group, i) => (
            <SelectGroup key={group.label ?? i}>
              {group.label && <SelectLabel>{group.label}</SelectLabel>}
              {group.choices.map((choice) => (
                <SelectItem
                  key={choice.value}
                  value={toKey(choice.value) ?? choice.value}
                  disabled={choice.disabled}
                >
                  {choice.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {/* What a <select name> would have posted. */}
      {name && <input type="hidden" name={name} value={key === undefined ? "" : fromKey(key)} />}
    </>
  );
}
