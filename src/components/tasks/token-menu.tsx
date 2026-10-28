"use client";

import { FileText, Paperclip } from "@/components/icons";

import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { PopoverContent } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";

import type { TokenMenuState } from "./use-token-menu";

/**
 * The list the `@` and `/` menus share (useTokenMenu holds the state). The
 * field wraps itself in a Popover with a PopoverAnchor and renders this as
 * the content, so the menu hangs off the field and the caret never leaves
 * it.
 */
export function TokenMenu({
  menu,
  audience,
  width = "w-72",
}: {
  menu: TokenMenuState;
  /** A private task: the mention list is the task's own people. */
  audience?: readonly string[] | null;
  className?: string;
  width?: string;
}) {
  const heading =
    menu.kind === "file"
      ? "Link a file"
      : audience
        ? "Mention someone on this task"
        : "Mention a member";

  return (
    <PopoverContent
      className={`${width} p-0`}
      align="start"
      side="bottom"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <Command shouldFilter={false} value={menu.options[menu.highlight]?.id ?? ""}>
        <CommandList id={menu.listId}>
          <CommandGroup heading={heading}>
            {menu.options.map((option, i) => (
              <CommandItem
                key={option.id}
                value={option.id}
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => menu.pick(option)}
                onMouseEnter={() => menu.setHighlight(i)}
              >
                {option.kind === "member" && option.member ? (
                  <>
                    <UserAvatar user={option.member} size="xs" />
                    <span className="truncate">{option.label}</span>
                    {option.member.title && (
                      <span className="text-muted-foreground ml-auto truncate text-xs">
                        {option.member.title}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {option.file?.kind === "note" ? (
                      <FileText className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                    ) : (
                      <Paperclip className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                    )}
                    <span className="truncate">{option.label}</span>
                  </>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        {menu.kind === "member" && audience && (
          <p className="text-muted-foreground border-t px-3 py-2 text-xs">
            Only people who can see this private task. Add a collaborator to include someone else.
          </p>
        )}
        {menu.kind === "file" && (
          <p className="text-muted-foreground border-t px-3 py-2 text-xs">
            A note or an upload from the club&apos;s Files. The task shows it as a link.
          </p>
        )}
      </Command>
    </PopoverContent>
  );
}
