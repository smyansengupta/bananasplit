/**
 * The meeting providers' own marks (docs/features/meetings.md).
 *
 * Used wherever someone picks or connects a provider, because a Zoom meeting
 * should look like Zoom: a row of three identical grey camera glyphs tells you
 * nothing, and these are the marks people already recognise. Each is drawn in
 * the provider's own colours and sits on a 24x24 box like the rest of the
 * icon set, so it can swap in anywhere an icon goes.
 *
 * They are the providers' trademarks, used only to name the provider they
 * belong to. Same standing as GoogleIcon on the sign-in button.
 */

export interface MeetingLogoProps {
  className?: string;
}

/** Google Meet: the video camera built from Google's four brand colours. */
export function GoogleMeetLogo({ className }: MeetingLogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path fill="#00832D" d="M3 7.5A1.5 1.5 0 0 1 4.5 6H13v12H4.5A1.5 1.5 0 0 1 3 16.5v-9Z" />
      <path fill="#0066DA" d="M3 9.75V7.5A1.5 1.5 0 0 1 4.5 6h3.75L3 9.75Z" />
      <path fill="#E94235" d="M13 18v-4.5l4.25 3.19V18a1.5 1.5 0 0 1-1.5 1.5H13V18Z" />
      <path fill="#2684FC" d="M13 6h2.75a1.5 1.5 0 0 1 1.5 1.5v9.19L13 13.5v-7.5Z" />
      <path fill="#00AC47" d="M13 6v7.5l4.25 3.19V7.5A1.5 1.5 0 0 0 15.75 6H13Z" />
      <path fill="#FFBA00" d="m17.25 9.38 3-2.25A.75.75 0 0 1 21.5 7.7v8.6a.75.75 0 0 1-1.25.57l-3-2.25V9.38Z" />
    </svg>
  );
}

/** Zoom: the white camera on Zoom blue. */
export function ZoomLogo({ className }: MeetingLogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill="#0B5CFF" />
      <path
        fill="#fff"
        d="M6.4 8.6h6.3a1.7 1.7 0 0 1 1.7 1.7v5.1a.6.6 0 0 1-.6.6H7.5a1.7 1.7 0 0 1-1.7-1.7V9.2a.6.6 0 0 1 .6-.6Zm9.3 3.02 2.46-1.8a.56.56 0 0 1 .9.45v3.46a.56.56 0 0 1-.9.45l-2.46-1.8a.38.38 0 0 1 0-.76Z"
      />
    </svg>
  );
}

/** Microsoft Teams: the purple badge with its white T. */
export function MicrosoftTeamsLogo({ className }: MeetingLogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path fill="#5059C9" d="M16.6 9.6h4.6a.8.8 0 0 1 .8.8v4.3a3.1 3.1 0 0 1-3.1 3.1 3.1 3.1 0 0 1-3.1-3.1V9.6h.8Z" />
      <circle cx="18.9" cy="6.3" r="2" fill="#5059C9" />
      <circle cx="12.6" cy="5.5" r="2.8" fill="#7B83EB" />
      <path
        fill="#7B83EB"
        d="M9.2 9.6h7.3a.7.7 0 0 1 .7.7v5.4a4.4 4.4 0 0 1-4.4 4.4 4.4 4.4 0 0 1-4.4-4.4V9.6h.8Z"
      />
      <path
        fill="#000"
        opacity=".2"
        d="M12.9 8.9v8.4a.8.8 0 0 1-.8.8H8.5a5 5 0 0 1-.1-1V8.9a.8.8 0 0 1 .8-.8h2.9a.8.8 0 0 1 .8.8Z"
      />
      <rect x="2.2" y="6.6" width="10.8" height="10.8" rx="1.1" fill="#4B53BC" />
      <path fill="#fff" d="M10.2 9.5H4.9v1.4h1.9v5.1h1.5v-5.1h1.9V9.5Z" />
    </svg>
  );
}

/**
 * The mark for an OrgIntegration provider, drawn in place. A component rather
 * than a lookup that hands back a component type, so nothing picks a
 * component during render.
 */
export function MeetingLogo({
  provider,
  className,
}: MeetingLogoProps & { provider: string }) {
  if (provider === "GOOGLE_MEET") return <GoogleMeetLogo className={className} />;
  if (provider === "ZOOM") return <ZoomLogo className={className} />;
  if (provider === "MICROSOFT_TEAMS") return <MicrosoftTeamsLogo className={className} />;
  return null;
}

/** Whether a provider has a mark of its own (NONE and OTHER do not). */
export function hasMeetingLogo(provider: string): boolean {
  return provider === "GOOGLE_MEET" || provider === "ZOOM" || provider === "MICROSOFT_TEAMS";
}
