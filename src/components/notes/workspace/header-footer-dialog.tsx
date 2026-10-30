"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { MAX_BAND_TEXT } from "@/lib/notes/paper";

/**
 * Document mode's Page setup: the paper (Letter or A4, saved the moment
 * it's picked) and the header and footer text (Note.headerText /
 * footerText). Left empty, a band shows its default: the title and club
 * on top, the title at the bottom (beside the page number either way).
 */
export function HeaderFooterDialog({
  headerText,
  footerText,
  defaults,
  paperSize,
  onPaperSize,
  onSave,
  onClose,
}: {
  headerText: string | null;
  footerText: string | null;
  paperSize?: "LETTER" | "A4";
  onPaperSize?: (next: "LETTER" | "A4") => void;
  defaults: { header: string; footer: string };
  onSave: (next: { headerText: string | null; footerText: string | null }) => void;
  onClose: () => void;
}) {
  const [header, setHeader] = useState(headerText ?? "");
  const [footer, setFooter] = useState(footerText ?? "");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ headerText: header.trim() || null, footerText: footer.trim() || null });
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>Page setup</DialogTitle>
            <DialogDescription>Leave a band empty for the default.</DialogDescription>
          </DialogHeader>
          {paperSize && onPaperSize && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold">Paper</span>
              <Segmented
                label="Paper"
                options={[
                  { value: "LETTER", label: "Letter" },
                  { value: "A4", label: "A4" },
                ]}
                value={paperSize}
                onSelect={(v) => onPaperSize(v as "LETTER" | "A4")}
              />
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="note-header-text" className="text-[13px] font-semibold">
              Header
            </label>
            <Input
              id="note-header-text"
              value={header}
              maxLength={MAX_BAND_TEXT}
              placeholder={defaults.header}
              autoFocus
              onChange={(e) => setHeader(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="note-footer-text" className="text-[13px] font-semibold">
              Footer
            </label>
            <Input
              id="note-footer-text"
              value={footer}
              maxLength={MAX_BAND_TEXT}
              placeholder={defaults.footer}
              onChange={(e) => setFooter(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">The page number stays on the right.</p>
          </div>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
