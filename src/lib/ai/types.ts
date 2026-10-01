/** Client-safe shapes shared by the AI import dialogs and their server side. */

export type AiConnectionId = "claude" | "ai-model" | "platform" | "standin";

export interface AiConnectionInfo {
  id: AiConnectionId;
  /** "Claude Sonnet 5", "OpenAI · gpt-4.1-mini". */
  label: string;
  /** "Your club's Claude key", "Bananasplit's Claude key". */
  detail: string;
  /** Where the data goes, for the privacy line under the import box. */
  sentTo: string;
}

export interface ImportRosterMember {
  id: string;
  name: string;
  title: string | null;
}
