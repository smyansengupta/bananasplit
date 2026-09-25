"use client";

import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { mentionHrefUserId } from "@/lib/tasks/mentions";
import { cn } from "@/lib/utils";

import { useTasks } from "./tasks-context";

/**
 * Task markdown (descriptions, comments) with @mention chips: the token
 * @[Name](user:id) is a markdown link whose target keeps the user: scheme
 * (every other target goes through react-markdown's safe default), and the
 * link renderer turns it into a chip with the member's current name.
 */

function urlTransform(url: string): string {
  return mentionHrefUserId(url) ? url : defaultUrlTransform(url);
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
