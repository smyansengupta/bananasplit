"use client";

import { ImageUp, Loader2, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { parseAvatarVariants } from "@/lib/avatar";

import {
  ACCEPTED_IMAGE_TYPES,
  cropToSquare,
  MAX_SOURCE_BYTES,
  type PixelArea,
} from "./crop-image";

// react-easy-crop loads only when someone picks a file (or hovers the button).
const loadCropDialog = () => import("./avatar-crop-dialog");
const AvatarCropDialog = dynamic(loadCropDialog, { ssr: false });

type Status = { kind: "idle" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

/**
 * Profile picture: pick a file, crop it to a square in the browser, upload
 * the 512px result to /api/profile/avatar (which re-encodes it to small
 * WebP variants). The whole app shows the new picture after the refresh.
 */
export function AvatarEditor({
  user,
  compact = false,
}: {
  user: UserAvatarUser;
  /** Onboarding A1: a small picture with Upload and "Use Google photo". */
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const hasUpload = Object.keys(parseAvatarVariants(user.avatar)).length > 0;

  // Release the object URL when the dialog closes or the component unmounts.
  useEffect(() => {
    if (!source) return;
    return () => URL.revokeObjectURL(source);
  }, [source]);

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setStatus({ kind: "error", message: "Choose a JPEG, PNG or WebP image." });
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setStatus({ kind: "error", message: "That file is too large. Choose one under 25 MB." });
      return;
    }
    setStatus({ kind: "idle" });
    setCropError(null);
    setSource(URL.createObjectURL(file));
  }

  async function upload(area: PixelArea) {
    if (!source) return;
    setUploading(true);
    setCropError(null);
    try {
      const blob = await cropToSquare(source, area);
      const form = new FormData();
      form.set("file", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
      if (!response.ok) {
        setCropError(await readError(response, "Couldn't save your picture. Try again."));
        return;
      }
      setSource(null);
      setStatus({ kind: "saved", message: "Picture updated." });
      router.refresh();
    } catch (error) {
      setCropError(error instanceof Error ? error.message : "Couldn't save your picture. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setStatus({ kind: "idle" });
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!response.ok) {
        setStatus({ kind: "error", message: await readError(response, "Couldn't remove your picture.") });
        return;
      }
      setStatus({ kind: "saved", message: "Picture removed." });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Couldn't remove your picture. Check your connection." });
    } finally {
      setRemoving(false);
    }
  }

  const cropDialog = source && (
    <AvatarCropDialog
      imageSrc={source}
      busy={uploading}
      error={cropError}
      onCancel={() => setSource(null)}
      onConfirm={upload}
    />
  );
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_IMAGE_TYPES.join(",")}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={pickFile}
    />
  );

  if (compact) {
    const hasPicture = hasUpload || Boolean(user.image);
    return (
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onPointerEnter={() => void loadCropDialog()}
          aria-label={hasPicture ? "Change your picture" : "Upload a picture"}
          className={
            hasPicture
              ? "focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-3"
              : "text-muted-foreground bg-muted/50 hover:bg-muted focus-visible:ring-ring/50 grid size-16 shrink-0 place-items-center rounded-full border border-dashed text-xl outline-none focus-visible:ring-3"
          }
        >
          {hasPicture ? <UserAvatar user={user} size="xl" /> : "+"}
        </button>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Profile picture</span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              onFocus={() => void loadCropDialog()}
              disabled={uploading || removing}
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Upload
            </Button>
            {user.image && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-muted-foreground"
                onClick={remove}
                disabled={!hasUpload || uploading || removing}
                title={hasUpload ? undefined : "Your Google photo is already in use"}
              >
                {hasUpload ? "Use Google photo" : "Using Google photo"}
              </Button>
            )}
          </div>
          <p
            aria-live="polite"
            className={status.kind === "error" ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
          >
            {status.kind === "idle" ? "" : status.message}
          </p>
        </div>
        {fileInput}
        {cropDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <UserAvatar user={user} size="2xl" />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            onPointerEnter={() => void loadCropDialog()}
            onFocus={() => void loadCropDialog()}
            disabled={uploading || removing}
          >
            <ImageUp className="size-4" aria-hidden="true" />
            {hasUpload ? "Change picture" : "Upload picture"}
          </Button>
          {hasUpload && (
            <Button type="button" variant="ghost" onClick={remove} disabled={uploading || removing}>
              {removing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Remove
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          JPEG, PNG or WebP. You&apos;ll crop it to a square; it&apos;s resized for the web and
          location data is removed.
        </p>
        <p
          aria-live="polite"
          className={
            status.kind === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"
          }
        >
          {status.kind === "idle" ? "" : status.message}
        </p>
        {fileInput}
      </div>

      {cropDialog}
    </div>
  );
}
