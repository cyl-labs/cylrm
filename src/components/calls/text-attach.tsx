"use client";

import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * A picture to text (2026-10-09), shared by the Texts screen and the box under a
 * meeting so the two cannot behave differently.
 *
 * - **Paste or pick**: `pastedImage` pulls a picture off the clipboard, and
 *   `AttachButton` opens the file picker.
 * - **Shrunk in the browser first**: carriers cap a picture message at about
 *   1 MB in all, and a phone screenshot is several. The picture is redrawn
 *   smaller and saved as a JPEG until it fits, so nobody has to know that.
 *   A GIF is sent as it is, or refused when too big, since redrawing would
 *   stop it moving.
 * - **Uploaded straight away**, so Send only has to name it (`mediaId`), and
 *   the preview shows what was kept.
 */

const MAX_BYTES = 850_000;
const MAX_SIDE = 1600;

async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That is not a picture.");
  if (file.type === "image/gif") {
    if (file.size <= MAX_BYTES) return file;
    throw new Error("That GIF is too big to text. Use a still picture instead.");
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw new Error("Could not read that picture. A JPEG or PNG works best.");
  }
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare that picture.");
      // A transparent PNG would turn black as a JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (blob && blob.size <= MAX_BYTES) return blob;
      }
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Could not make that picture small enough to text.");
}

export type Attachment = {
  /** What the send routes take as `mediaId`. */
  id: string;
  /** A local preview, so what was kept is what is shown. */
  previewUrl: string;
};

export function useAttachment() {
  const [attachment, setAttachment] = React.useState<Attachment | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const urlRef = React.useRef<string | null>(null);

  const forget = React.useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);
  const clear = React.useCallback(() => {
    forget();
    setAttachment(null);
  }, [forget]);
  React.useEffect(() => forget, [forget]);

  const attach = React.useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const blob = await shrink(file);
        const form = new FormData();
        form.append("file", blob, "picture");
        const res = await fetch("/api/texts/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? "Could not add that picture. Try again.");
        }
        forget();
        urlRef.current = URL.createObjectURL(blob);
        setAttachment({ id: data.id, previewUrl: urlRef.current });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not add that picture.");
      } finally {
        setUploading(false);
      }
    },
    [forget],
  );

  return { attachment, uploading, attach, clear };
}

/** The picture on the clipboard, if there is one. Text pastes are left alone. */
export function pastedImage(e: React.ClipboardEvent): File | null {
  return Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/")) ?? null;
}

export function AttachButton({
  onFile,
  disabled,
  label,
  className,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Words beside the icon, where the layout has room for them. */
  label?: string;
  className?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label="Attach a picture"
        title="Attach a picture. You can also paste one into the box."
        className={cn("disabled:opacity-40", className)}
      >
        <ImagePlus className="size-[18px]" />
        {label}
      </button>
    </>
  );
}

/** The kept picture, with a way to take it off, or a note while it uploads. */
export function AttachmentPreview({
  attachment,
  uploading,
  onRemove,
  className,
}: {
  attachment: Attachment | null;
  uploading: boolean;
  onRemove: () => void;
  className?: string;
}) {
  if (uploading) {
    return (
      <p className={cn("flex items-center gap-1.5 text-[12px] text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin" />
        Adding picture…
      </p>
    );
  }
  if (!attachment) return null;
  return (
    <div className={cn("relative w-fit", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.previewUrl}
        alt="Picture to send"
        className="max-h-24 max-w-[180px] rounded-lg border object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove the picture"
        className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow"
      >
        <X className="size-3" strokeWidth={3} />
      </button>
    </div>
  );
}
