"use client";

import { UserAvatar } from "@/components/user-avatar";

import type { CollabPeer } from "./use-note-collab";

const MAX_SHOWN = 5;

/**
 * Who else has a live note open, ringed in the colour of their caret. Names
 * come from the collaboration server (stamped from each person's token), not
 * from what their browser claims.
 */
export function PresenceBar({ peers }: { peers: CollabPeer[] }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, MAX_SHOWN);
  const names = peers.map((p) => p.user.name).join(", ");
  return (
    <div className="flex items-center gap-1.5" title={`Also here: ${names}`}>
      <span className="sr-only">Also in this note: {names}</span>
      <div className="flex -space-x-1.5">
        {shown.map((peer) => (
          <span
            key={peer.user.id}
            className="rounded-full"
            style={{ boxShadow: `0 0 0 2px var(--chart-${peer.user.slot})` }}
          >
            <UserAvatar user={{ name: peer.user.name }} size="xs" />
          </span>
        ))}
      </div>
      {peers.length > MAX_SHOWN && (
        <span className="text-muted-foreground text-xs" aria-hidden>
          +{peers.length - MAX_SHOWN}
        </span>
      )}
    </div>
  );
}
