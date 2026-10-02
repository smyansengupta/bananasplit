/**
 * Finance setup, the guided way (Finance › Set up). Progress is derived from
 * the books themselves, never stored: a step is done when what it sets up
 * exists. The first three are what a working budget needs; the rest help
 * but can wait. Pure and client-safe.
 */

/** How the starting balance is recognized: an ADJUSTMENT with this description. */
export const STARTING_BALANCE_DESCRIPTION = "Starting balance";

export interface FinanceSetupState {
  period: { id: string; label: string; startsOn: string; endsOn: string } | null;
  /** Signed cents (negative when the club starts in debt), and the day it was true. */
  startingBalance: { cents: number; asOf: string } | null;
  /** Transactions in the active period other than the starting balance. */
  transactionCount: number;
  categoryCount: number;
  /** Any category with money allocated. */
  budgeted: boolean;
  treasurerCount: number;
  /** This member saved their own finance board. */
  boardSaved: boolean;
}

export const SETUP_STEPS = [
  { id: "period", title: "Your money year", short: "Budget period", core: true },
  { id: "balance", title: "What you have now", short: "Starting balance", core: true },
  { id: "budget", title: "Your budget", short: "Budget lines", core: true },
  { id: "people", title: "Who handles money", short: "Treasurers", core: false },
  { id: "records", title: "Past records", short: "Import", core: false },
  { id: "board", title: "Your dashboard", short: "Widgets", core: false },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

export function stepDone(state: FinanceSetupState, step: SetupStepId): boolean {
  switch (step) {
    case "period":
      return state.period !== null;
    case "balance":
      return state.startingBalance !== null || state.transactionCount > 0;
    case "budget":
      return state.budgeted;
    case "people":
      return state.treasurerCount > 0;
    case "records":
      return state.transactionCount > 0;
    case "board":
      return state.boardSaved;
  }
}

/** Whether the parts a budget needs are in place (the dashboard stops nudging then). */
export function coreSetupDone(state: FinanceSetupState): boolean {
  return SETUP_STEPS.filter((s) => s.core).every((s) => stepDone(state, s.id));
}

export function setupProgress(state: FinanceSetupState): { done: number; total: number; next: SetupStepId | null } {
  const done = SETUP_STEPS.filter((s) => stepDone(state, s.id)).length;
  const next = SETUP_STEPS.find((s) => !stepDone(state, s.id))?.id ?? null;
  return { done, total: SETUP_STEPS.length, next };
}

/** Everyday budget lines to pick from (the defaults plus what clubs usually add). */
export const SUGGESTED_CATEGORIES = [
  "Food",
  "Events",
  "Supplies",
  "Travel",
  "Marketing",
  "Merch",
  "Software",
  "Prizes",
  "Speakers",
  "Fees",
  "Miscellaneous",
] as const;
