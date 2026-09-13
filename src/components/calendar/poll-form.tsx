"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createPoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesFromTimeInput(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function PollForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dates, setDates] = useState<Date[]>([]);
  const [dailyStart, setDailyStart] = useState("09:00");
  const [dailyEnd, setDailyEnd] = useState("17:00");
  const [granularity, setGranularity] = useState<15 | 30 | 60>(30);
  const [duration, setDuration] = useState(60);
  const [closesAt, setClosesAt] = useState("");

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createPoll(orgId, {
        title,
        description: description || null,
        timezone,
        dates: dates.map(localDate),
        dailyStartMinutes: minutesFromTimeInput(dailyStart),
        dailyEndMinutes: minutesFromTimeInput(dailyEnd),
        granularityMinutes: granularity,
        durationMinutes: duration,
        closesAt: closesAt || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/app/${orgSlug}/calendar/polls/${result.pollId}`);
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New availability poll</h1>

      <div className="grid gap-1.5">
        <Label htmlFor="poll-title">Title</Label>
        <Input id="poll-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="poll-description">Description</Label>
        <Textarea
          id="poll-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Candidate dates</Label>
        <Calendar
          mode="multiple"
          selected={dates}
          onSelect={(value) => setDates(value ?? [])}
          className="w-fit rounded-md border"
        />
        <p className="text-muted-foreground text-xs">{dates.length} date(s) selected</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="poll-start">Daily window start</Label>
          <Input
            id="poll-start"
            type="time"
            value={dailyStart}
            onChange={(e) => setDailyStart(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="poll-end">Daily window end</Label>
          <Input
            id="poll-end"
            type="time"
            value={dailyEnd}
            onChange={(e) => setDailyEnd(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Slot granularity</Label>
          <Select
            value={String(granularity)}
            onValueChange={(v) => setGranularity(Number(v) as 15 | 30 | 60)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="60">60 minutes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="poll-duration">Meeting duration (min)</Label>
          <Input
            id="poll-duration"
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Poll timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="poll-closes">Closes (optional)</Label>
          <Input
            id="poll-closes"
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={isPending || !title.trim()}>
          Create poll
        </Button>
      </div>
    </div>
  );
}
