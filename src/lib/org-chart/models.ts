/**
 * The Claude models an org may pick for the org-chart importer, with what
 * they cost and which request parameters they take. Pure and client-safe:
 * Settings renders the price from here and the parser sends the right
 * parameters from here.
 *
 * Claude is only the backup. The built-in parser reads most documents with
 * no key and no cost, so the default is the cheapest model that can read a
 * document well, Claude Haiku 4.5.
 */

export interface ClaudeModelInfo {
  id: string;
  label: string;
  note: string;
  /** Anthropic list price, US dollars per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  /**
   * Adaptive thinking and output_config.effort (the 4.6 family and later).
   * Haiku 4.5 takes a thinking budget instead and rejects effort outright.
   */
  adaptiveThinking: boolean;
  /** Anthropic's server-side refusal fallbacks may be requested. */
  serverFallbacks: boolean;
}

export const CLAUDE_MODELS: readonly ClaudeModelInfo[] = [
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    note: "Default. Fastest and cheapest; enough for a club's org chart.",
    inputPerMTok: 1,
    outputPerMTok: 5,
    adaptiveThinking: false,
    serverFallbacks: false,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    note: "A step up for long or unusual documents.",
    inputPerMTok: 2,
    outputPerMTok: 10,
    adaptiveThinking: true,
    serverFallbacks: false,
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    note: "The most thorough reader, and the most expensive.",
    inputPerMTok: 5,
    outputPerMTok: 25,
    adaptiveThinking: true,
    serverFallbacks: true,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    note: "The previous Opus generation.",
    inputPerMTok: 5,
    outputPerMTok: 25,
    adaptiveThinking: true,
    serverFallbacks: false,
  },
];

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/**
 * What one import of a chart this size costs, roughly: a few thousand
 * tokens of document and a schema-bound answer. Used for the estimate in
 * Settings; the draft shows the real cost once a document has been read.
 */
export const TYPICAL_PARSE_TOKENS = { input: 3_000, output: 4_000 } as const;

/**
 * The entry for a model id, matching a dated snapshot to its family
 * ("claude-haiku-4-5" and "claude-haiku-4-5-20251001" are the same model),
 * or null for an id this portal does not know.
 */
export function claudeModel(id: string | null | undefined): ClaudeModelInfo | null {
  if (!id) return null;
  const exact = CLAUDE_MODELS.find((m) => m.id === id);
  if (exact) return exact;
  return (
    CLAUDE_MODELS.find((m) => id.startsWith(m.id) || m.id.startsWith(id)) ??
    CLAUDE_MODELS.find((m) => id.startsWith(m.id.replace(/-\d{8}$/, ""))) ??
    null
  );
}

/** US dollars for a given number of input and output tokens. */
export function claudeCostUsd(id: string, tokens: { input: number; output: number }): number | null {
  const model = claudeModel(id);
  if (!model) return null;
  return (tokens.input * model.inputPerMTok + tokens.output * model.outputPerMTok) / 1_000_000;
}

/** The rough cost of one import on a model, in US dollars. */
export function estimateParseCostUsd(id: string): number | null {
  return claudeCostUsd(id, { ...TYPICAL_PARSE_TOKENS });
}

/** "$0.02", or "<$0.01" for anything smaller than a cent. */
export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}

/** "Claude Haiku 4.5", or the raw id for a model this portal does not list. */
export function claudeModelLabel(id: string | null | undefined): string {
  return claudeModel(id)?.label ?? id ?? "Claude";
}
