"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatCents } from "@/lib/finance/money";

export function BurnChart({
  data,
}: {
  data: { month: string; inCents: number; outCents: number }[];
}) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet this period.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v: number) => formatCents(v).replace(".00", "")}
          width={70}
        />
        <Tooltip formatter={(value) => formatCents(Number(value ?? 0))} />
        <Bar dataKey="inCents" name="In" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="outCents" name="Out" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
