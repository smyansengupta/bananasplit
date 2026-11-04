"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

/**
 * The CRM's biggest pieces that most visits never open, kept out of the code
 * every CRM page loads: follow-up plans, Ask, the automation builder and the
 * Board with its drag library. Server components import them from here.
 *
 * CrmWarmUp fetches them once the page is idle, so by the time one is opened
 * its code is already here and the card costs only its data.
 */

const loadPlanCard = () => import("@/components/crm/cards/plan-card");
const loadNewPlanCard = () => import("@/components/crm/cards/new-plan-card");
const loadAskCard = () => import("@/components/crm/cards/ask-card");
const loadBuilder = () => import("@/components/crm/workflow-builder");
const loadBoard = () => import("@/components/crm/pipeline-view");

export const PlanCard = dynamic(() => loadPlanCard().then((m) => m.PlanCard));
export const NewPlanCard = dynamic(() => loadNewPlanCard().then((m) => m.NewPlanCard));
export const AskCard = dynamic(() => loadAskCard().then((m) => m.AskCard));
export const WorkflowBuilder = dynamic(() => loadBuilder().then((m) => m.WorkflowBuilder));
export const RunLog = dynamic(() => loadBuilder().then((m) => m.RunLog));
export const DealBoard = dynamic(() => loadBoard().then((m) => m.DealBoard), {
  loading: BoardLoading,
});

/** The Board's columns, in their place, for the moment its code is on its way. */
function BoardLoading() {
  return (
    <div aria-busy="true" className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-muted/60 h-64 w-72 shrink-0 animate-pulse rounded-2xl motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function CrmWarmUp() {
  useEffect(() => {
    const warm = () => {
      for (const load of [loadBoard, loadPlanCard, loadNewPlanCard, loadAskCard, loadBuilder]) {
        void load().catch(() => null);
      }
    };
    if (typeof window.requestIdleCallback !== "function") {
      const t = setTimeout(warm, 2000);
      return () => clearTimeout(t);
    }
    const id = window.requestIdleCallback(warm, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }, []);
  return null;
}
