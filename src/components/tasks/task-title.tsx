"use client";

import { FileText, Paperclip } from "@/components/icons";
import Link from "next/link";

import { fileRefHref, hasFileRef, splitFileRefs, type FileRefKind } from "@/lib/tasks/file-refs";
import { cn } from "@/lib/utils";

import { useTasks } from "./tasks-context";

/**
 * A task's title with its file references drawn as chips.
 *
 * `linked` makes each chip a link to the file or the note. It is off by
 * default, because most titles sit inside something that is already one
 * click — a card, a row's button — and a link inside a button is not valid
 * markup and not a click anyone can aim at. The detail panel and the task's
 * own page turn it on: there the title is text on a surface, and the chip
 * is the way through.
 *
 * With no reference in the title this renders the string and nothing else,
 * so it is safe to use everywhere a title is shown.
 */

export function FileRefChip({
  name,
  kind,
  id,
  linked,
}: {
  name: string;
  kind: FileRefKind;
  id: string;
  linked?: boolean;
}) {
  const { org } = useTasks();
  const Icon = kind === "note" ? FileText : Paperclip;
  const body = (
    <>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {name}
    </>
  );
  const className = cn(
    "bg-muted text-foreground/80 mx-0.5 inline-flex max-w-[16rem] items-center gap-1 rounded-md px-1.5 align-baseline text-[0.9em] font-medium no-underline",
    linked && "hover:bg-muted/70 hover:text-foreground focus-glow transition-colors",
  );

  if (!linked) {
    return (
      <span className={className} title={name}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={fileRefHref(org.slug, kind, id)}
      className={className}
      title={`Open ${name}`}
      // In a title that is itself inside something clickable, the chip wins.
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </Link>
  );
}

export function TaskTitle({
  children,
  linked,
  className,
}: {
  children: string;
  linked?: boolean;
  className?: string;
}) {
  if (!hasFileRef(children)) return <>{children}</>;
  const parts = splitFileRefs(children);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <FileRefChip
            key={i}
            name={part.ref.name}
            kind={part.ref.kind}
            id={part.ref.id}
            linked={linked}
          />
        ),
      )}
    </span>
  );
}
