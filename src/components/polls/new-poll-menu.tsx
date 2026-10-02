"use client";

import { CalendarRange, ChevronDown, Plus, Vote, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Choice {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** The two kinds of poll a member can start. */
const CHOICES: readonly Choice[] = [
  {
    path: "/calendar/polls/ask",
    label: "Ask a question",
    description: "Give options and let the club vote.",
    icon: Vote,
  },
  {
    path: "/calendar/polls/new",
    label: "Find a time",
    description: "Offer days and hours; see when people are free.",
    icon: CalendarRange,
  },
];

/** The polls page's "New poll": a question or a find-a-time poll. */
export function NewPollMenu({ orgSlug }: { orgSlug: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus aria-hidden className="size-4" />
          New poll
          <ChevronDown aria-hidden className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1.5">
        {CHOICES.map((choice) => {
          const Icon = choice.icon;
          return (
            <DropdownMenuItem
              key={choice.path}
              asChild
              className="items-start gap-3 rounded-lg p-2.5"
            >
              <Link href={`/app/${orgSlug}${choice.path}`}>
                <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{choice.label}</span>
                  <span className="text-muted-foreground text-xs">{choice.description}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Both kinds side by side, for the empty polls page. */
export function NewPollButtons({ orgSlug }: { orgSlug: string }) {
  return (
    <>
      {CHOICES.map((choice, i) => {
        const Icon = choice.icon;
        return (
          <Button key={choice.path} asChild size="sm" variant={i === 0 ? "default" : "outline"}>
            <Link href={`/app/${orgSlug}${choice.path}`}>
              <Icon aria-hidden className="size-4" />
              {choice.label}
            </Link>
          </Button>
        );
      })}
    </>
  );
}
