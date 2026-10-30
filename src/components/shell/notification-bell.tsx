"use client";

import { Bell } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMyNotifications } from "@/app/app/notifications-actions";
import { capsuleButtonClass } from "@/components/shell/capsule";

const POLL_INTERVAL_MS = 60_000;

/**
 * The bell in the top bar: a dot when something is unread, and one click to
 * the Inbox, where updates are read and acted on (the old popover list
 * lives there now, with room to do something about each one).
 */
export function NotificationBell({ href }: { href: string }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const result = await fetchMyNotifications();
      if (!cancelled) setUnreadCount(result.unreadCount);
    }
    void refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href={href}
      aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : "Inbox"}
      title="Inbox"
      className={capsuleButtonClass}
    >
      <Bell className="size-5" strokeWidth={1.75} aria-hidden="true" />
      {/* Unread: a small dot in the glow colour, not a count. */}
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="bg-glow ring-card absolute top-[9px] right-[10px] size-2 rounded-full ring-2"
        />
      )}
    </Link>
  );
}
