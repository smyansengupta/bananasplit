"use client";

import {
  createContext,
  use,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Shares one transition between the filter row (range picker, Refresh,
 * the periodic refresh) and the report grid, so a refetch keeps the
 * previous numbers on screen at reduced opacity instead of flashing
 * skeletons.
 */

interface FrameState {
  pending: boolean;
  startTransition: TransitionStartFunction;
}

const FrameContext = createContext<FrameState | null>(null);

export function ReportsFrame({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  return <FrameContext value={{ pending, startTransition }}>{children}</FrameContext>;
}

export function useReportsFrame(): FrameState {
  const state = use(FrameContext);
  if (!state) throw new Error("useReportsFrame must be used inside <ReportsFrame>");
  return state;
}

export function ReportsBody({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useReportsFrame();
  return (
    <div
      aria-busy={pending}
      className={cn("transition-opacity duration-200", pending && "opacity-60", className)}
    >
      {children}
    </div>
  );
}
