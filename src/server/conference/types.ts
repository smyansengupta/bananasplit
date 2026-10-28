import { ConferenceProvider, IntegrationProvider } from "@/generated/prisma/enums";
import { PermanentJobError } from "@/server/jobs/types";

/**
 * Making a real meeting at a provider (docs/features/meetings.md).
 *
 * `Event.conferenceProvider` has always said which kind of call a meeting is;
 * what is new is that Bananasplit can create it. Each provider implements the
 * same three verbs against the org's own connected account, and the caller
 * (src/server/conference/service.ts, run from the conference-sync job) never
 * knows which one it is talking to.
 *
 * The provider is the only thing here that touches the network. Everything it
 * returns is treated as untrusted: the service stores the join URL only after
 * checking it is an https URL on a host the provider is allowed to hand back,
 * so a compromised or misbehaving API cannot turn a meeting link into a
 * redirect at somewhere else.
 */

/** What we ask a provider to make. Ids only: no attendee lists are sent. */
export interface ConferenceDraft {
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** IANA zone of the org, for providers that schedule in local time. */
  timeZone: string;
  allDay: boolean;
}

/** One dial-in number, as a provider reported it. */
export interface ConferenceDialIn {
  country: string | null;
  number: string;
  pin: string | null;
}

/** What a provider made. `joinUrl` is the link people open. */
export interface ConferenceMeeting {
  meetingId: string;
  joinUrl: string;
  /** Zoom's start_url and the like: the host's own link, never shown to guests. */
  hostUrl: string | null;
  passcode: string | null;
  dialIn: ConferenceDialIn[];
}

export interface ConferenceContext {
  orgId: string;
  signal?: AbortSignal;
}

export interface ConferenceClient {
  /** Which `Event.conferenceProvider` this client serves. */
  readonly provider: ConferenceProvider;
  /** The OrgIntegration row holding its OAuth connection. */
  readonly integration: IntegrationProvider;
  /** Hosts the join URL may point at. Anything else is rejected. */
  readonly joinHosts: readonly string[];
  create(draft: ConferenceDraft, ctx: ConferenceContext): Promise<ConferenceMeeting>;
  /**
   * Moves or renames an existing meeting. Providers that have no notion of a
   * scheduled time for a meeting space (Google Meet) implement this as a
   * no-op and say so by returning the meeting unchanged.
   */
  update(
    meetingId: string,
    draft: ConferenceDraft,
    ctx: ConferenceContext,
  ): Promise<ConferenceMeeting>;
  /** Cancels it. A meeting already gone counts as deleted. */
  remove(meetingId: string, ctx: ConferenceContext): Promise<void>;
}

/** The stored grant no longer works; an admin has to connect again. */
export class ConferenceReauthError extends Error {
  readonly integration: IntegrationProvider;
  constructor(integration: IntegrationProvider, message?: string) {
    super(message ?? `The saved ${integration} authorization was refused.`);
    this.name = "ConferenceReauthError";
    this.integration = integration;
  }
}

/** This deployment has no OAuth client for the provider (no env credentials). */
export class ConferenceNotConfiguredError extends PermanentJobError {
  readonly integration: IntegrationProvider;
  constructor(integration: IntegrationProvider, envNames: readonly string[]) {
    super(`${integration} is not configured on this deployment (${envNames.join(" / ")}).`);
    this.name = "ConferenceNotConfiguredError";
    this.integration = integration;
  }
}

/** The provider answered with an error. Retryable unless 4xx. */
export class ConferenceApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ConferenceApiError";
    this.status = status;
    this.code = code;
  }
  /** 408, 429 and 5xx are worth another go; the rest are the request's fault. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}
