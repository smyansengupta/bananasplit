"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createBudgetPeriod,
  createCategory,
  deleteCategory,
  setActivePeriod,
  updateCategory,
} from "@/app/app/[orgSlug]/finance/periods-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";
import { toDateInputValue } from "@/components/tasks/utils";

interface Period {
  id: string;
  label: string;
  startsOn: Date;
  endsOn: Date;
  isActive: boolean;
}

interface Category {
  id: string;
  name: string;
  allocatedCents: number;
}

export function BudgetView({
  orgId,
  periods,
  activePeriodId,
  categories,
}: {
  orgId: string;
  periods: Period[];
  activePeriodId: string | null;
  categories: Category[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [label, setLabel] = useState("");
  const [startsOn, setStartsOn] = useState(toDateInputValue(new Date()));
  const [endsOn, setEndsOn] = useState("");

  const [newCategoryName, setNewCategoryName] = useState("");

  function handleCreatePeriod() {
    setError(null);
    startTransition(async () => {
      const result = await createBudgetPeriod(orgId, { label, startsOn, endsOn });
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowNewPeriod(false);
      setLabel("");
      router.refresh();
    });
  }

  function handleSetActive(periodId: string) {
    startTransition(async () => {
      await setActivePeriod(orgId, periodId);
      router.refresh();
    });
  }

  function handleAddCategory() {
    if (!activePeriodId || !newCategoryName.trim()) return;
    startTransition(async () => {
      await createCategory(orgId, activePeriodId, {
        name: newCategoryName.trim(),
        allocatedCents: 0,
      });
      setNewCategoryName("");
      router.refresh();
    });
  }

  function handleUpdateAllocation(categoryId: string, dollars: string) {
    startTransition(async () => {
      try {
        const allocatedCents = parseDollarsToCents(dollars || "0");
        await updateCategory(orgId, categoryId, { allocatedCents });
        router.refresh();
      } catch {
        // ignore malformed input; the field just won't save
      }
    });
  }

  function handleDeleteCategory(categoryId: string) {
    startTransition(async () => {
      const result = await deleteCategory(orgId, categoryId);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Budget periods</h2>
          <Button variant="outline" size="sm" onClick={() => setShowNewPeriod((v) => !v)}>
            New period
          </Button>
        </div>

        {showNewPeriod && (
          <div className="grid grid-cols-3 gap-2 rounded-md border p-3">
            <Input
              placeholder="Label, e.g. FY 2026–27"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            <Button
              className="col-span-3"
              onClick={handleCreatePeriod}
              disabled={isPending || !label.trim() || !endsOn}
            >
              Create and activate
            </Button>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <ul className="space-y-1.5">
          {periods.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <span>
                {p.label}
                <span className="text-muted-foreground ml-2 text-xs">
                  {p.startsOn.toLocaleDateString()} – {p.endsOn.toLocaleDateString()}
                </span>
              </span>
              {p.isActive ? (
                <span className="text-muted-foreground text-xs">Active</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => handleSetActive(p.id)}>
                  Make active
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {activePeriodId && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Categories for the active period</h2>
          <ul className="space-y-1.5">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <span className="flex-1">{c.name}</span>
                <Label htmlFor={`alloc-${c.id}`} className="sr-only">
                  Allocation for {c.name}
                </Label>
                <Input
                  id={`alloc-${c.id}`}
                  defaultValue={(c.allocatedCents / 100).toFixed(2)}
                  onBlur={(e) => handleUpdateAllocation(c.id, e.target.value)}
                  className="w-28"
                />
                <span className="text-muted-foreground w-24 text-right text-xs">
                  {formatCents(c.allocatedCents)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => handleDeleteCategory(c.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              placeholder="New category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="w-56"
            />
            <Button
              variant="outline"
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim()}
            >
              Add category
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
