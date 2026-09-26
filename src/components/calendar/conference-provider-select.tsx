"use client";

import { ConferenceProvider } from "@/generated/prisma/enums";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PROVIDER_LABELS: Record<ConferenceProvider, string> = {
  NONE: "None",
  MEET: "Google Meet",
  ZOOM: "Zoom",
  TEAMS: "Microsoft Teams",
  OTHER: "Other",
};

export function ConferenceProviderSelect({
  value,
  onChange,
  disabled,
}: {
  value: ConferenceProvider;
  onChange: (value: ConferenceProvider) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ConferenceProvider)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.values(ConferenceProvider).map((p) => (
          <SelectItem key={p} value={p}>
            {PROVIDER_LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
