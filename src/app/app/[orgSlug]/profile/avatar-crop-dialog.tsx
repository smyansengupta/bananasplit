"use client";

import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { PixelArea } from "./crop-image";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * The crop step of a picture upload. Loaded on demand (next/dynamic from
 * AvatarEditor), so react-easy-crop is not in the profile page's bundle.
 * Drag or use the arrow keys to move, pinch, scroll or use the slider to
 * zoom.
 */
export default function AvatarCropDialog({
  imageSrc,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  imageSrc: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (area: PixelArea) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crop your picture</DialogTitle>
          <DialogDescription>
            Drag to position it. Pinch, scroll or use the slider to zoom.
          </DialogDescription>
        </DialogHeader>

        {/* Square, and never taller than about half the screen (landscape phones). */}
        <div className="bg-muted relative mx-auto aspect-square w-full max-w-[max(12rem,min(100%,50dvh))] overflow-hidden rounded-lg">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            aspect={1}
            cropShape="round"
            showGrid={false}
            objectFit="cover"
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setArea(pixels)}
            cropperProps={{ "aria-label": "Crop area. Use the arrow keys to move the picture." }}
          />
        </div>

        <div className="flex items-center gap-3">
          <ZoomOut className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Zoom"
            className="accent-primary h-2 w-full cursor-pointer"
          />
          <ZoomIn className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        </div>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => area && onConfirm(area)} disabled={busy || !area}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? "Saving…" : "Save picture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
