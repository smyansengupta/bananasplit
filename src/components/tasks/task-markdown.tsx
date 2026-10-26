"use client";

import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { fileHrefRef } from "@/lib/tasks/file-refs";
import { mentionHrefUserId } from "@/lib/tasks/mentions";
import { cn } from "@/lib/utils";

import { FileRefChip } from "./task-title";
import { useTasks } from "./tasks-context";

/**
 * Task markdown (descriptions, comments) with the two chips: @[Name](user:id)
 * is a member, and [Name.pdf](file:id) or [Build log](note:id) is something
 * on the club's Files page. All of them are markdown links
 * whose target keeps its own scheme — every other target goes through
 * react-markdown's safe default — and the link renderer turns each into its
 * chip: the member's current name, or a link through to the file.
 */

function urlTransform(url: string): string {
  return mentionHrefUserId(url) || fileHrefRef(url) ? url : defaultUrlTransform(url);
}

function MentionChip({ userId, fallback }: { userId: string; fallback: React.ReactNode }) {
  const { memberById } = useTasks();
  const member = memberById.get(userId);
  return (
    <span className="bg-primary/10 text-primary rounded px-1 py-0.5 font-medium whitespace-nowrap no-underline">
      @{member?.name ?? fallback}
    </span>
  );
}

const components: Components = {
  a({ href, children, node: _node, ...props }) {
    const userId = mentionHrefUserId(href);
    if (userId) return <MentionChip userId={userId} fallback={children} />;
    const ref = fileHrefRef(href);
    if (ref) {
      return (
        <FileRefChip
          kind={ref.kind}
          id={ref.id}
          name={typeof children === "string" ? children : String(children ?? "File")}
          linked
        />
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
        {children}
      </a>
    );
  },
};

export function TaskMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
