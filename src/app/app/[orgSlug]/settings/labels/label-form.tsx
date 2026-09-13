"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LABEL_COLOR_PALETTE, type LabelColor } from "@/lib/label-colors";

import { createLabel } from "./actions";

export function LabelForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>(LABEL_COLOR_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createLabel(orgId, { name, color });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <label htmlFor="label-name" className="text-sm font-medium">
          New label
        </label>
        <Input
          id="label-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Urgent"
          required
          className="w-48"
        />
      </div>
      <div className="flex items-center gap-1.5">
        {LABEL_COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            className={cn(
              "size-6 rounded-full ring-offset-2 outline-none",
              color === c && "ring-ring ring-2",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding…" : "Add label"}
      </Button>
      {error && <p className="text-destructive w-full text-sm">{error}</p>}
    </form>
  );
}
