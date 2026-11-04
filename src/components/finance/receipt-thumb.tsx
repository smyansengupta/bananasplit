"use client";

import { Paperclip } from "@/components/icons";
import { useEffect, useState } from "react";

import { getSignedReceiptUrl } from "@/app/app/[orgSlug]/finance/receipts-actions";

/**
 * A receipt on a transaction row: a small picture of it when it's a photo
 * (fetched through a short-lived signed link once the row is on screen),
 * a paperclip for a PDF. Clicking either opens the receipt.
 */
export function ReceiptThumb({
  orgId,
  receipt,
}: {
  orgId: string;
  receipt: { id: string; filename: string; mimeType: string };
}) {
  const image = receipt.mimeType.startsWith("image/");
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!image) return;
    let live = true;
    void getSignedReceiptUrl(orgId, receipt.id).then((r) => {
      if (live && r.url) setSrc(r.url);
    });
    return () => {
      live = false;
    };
  }, [image, orgId, receipt.id]);

  async function open() {
    const result = await getSignedReceiptUrl(orgId, receipt.id);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void open();
      }}
      aria-label={`Receipt: ${receipt.filename}`}
      title="Open the receipt"
      className="text-muted-foreground hover:text-foreground hover:bg-muted ring-border relative z-10 inline-grid size-9 shrink-0 place-items-center overflow-hidden rounded-md ring-1"
    >
      {image && src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, private receipt
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <Paperclip className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
