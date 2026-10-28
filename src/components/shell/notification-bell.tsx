"use client";

import { Bell } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/app/notifications-actions";
import { capsuleButtonClass } from "@/components/shell/capsule";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await fetchMyNotifications();
      if (!cancelled) {
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
      }
    }

    void refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      startTransition(async () => {
        const result = await fetchMyNotifications();
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
      });
    }
  }

  function handleItemClick(item: NotificationItem) {
    if (!item.readAt) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date() } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      startTransition(async () => {
        await markNotificationRead(item.id);
      });
    }
    setOpen(false);
    if (item.linkUrl) router.push(item.linkUrl);
  }

  function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })));
    setUnreadCount(0);
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          title="Notifications"
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
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <p className="text-sm font-medium">Notifications</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">No notifications yet.</p>
          ) : (
            <ul>
              {notifications.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={cn(
                      "hover:bg-accent/50 w-full border-b p-3 text-left text-sm last:border-b-0",
                      !item.readAt && "bg-accent/20",
                    )}
                  >
                    <p className={cn(!item.readAt && "font-medium")}>{item.title}</p>
                    {item.body && (
                      <p className="text-muted-foreground mt-0.5 text-xs">{item.body}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
