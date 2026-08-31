import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Upload, X, User as UserIcon, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const BUCKET = "employee-photos";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (source)
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Target dimensions and quality for compressed avatars. Avatar renders
// max 72px, but we keep 2× for retina + a headroom for detail views.
const TARGET_MAX_DIM = 512;
const TARGET_QUALITY = 0.85;
// Signed URLs last an hour; React Query refetches slightly before that.
const SIGNED_TTL_SEC = 60 * 60;
const SIGNED_STALE_MS = 55 * 60 * 1000;

/**
 * Downscale + re-encode an image to a max dimension and JPEG quality.
 * Returns the original File when:
 *   - the source is a GIF (preserve animation),
 *   - the browser can't decode it (fallback rather than block upload),
 *   - or the re-encoded blob is larger than the original.
 */
async function compressImage(
  file: File,
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const isGif = file.type === "image/gif";
  if (isGif) return { blob: file, ext: "gif", contentType: "image/gif" };

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, TARGET_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", TARGET_QUALITY),
    );
    if (!blob) throw new Error("encode failed");
    if (blob.size >= file.size) {
      // Recompression didn't help — keep the original bytes.
      return {
        blob: file,
        ext: (file.name.split(".").pop() || "jpg").toLowerCase(),
        contentType: file.type || "image/jpeg",
      };
    }
    return { blob, ext: "jpg", contentType: "image/jpeg" };
  } catch {
    return {
      blob: file,
      ext: (file.name.split(".").pop() || "jpg").toLowerCase(),
      contentType: file.type || "image/jpeg",
    };
  }
}

/** Reactive signed URL for a stored photo path (null when none). */
export function useEmployeePhotoUrl(photoPath: string | null | undefined) {
  return useQuery({
    queryKey: ["employee-photo-url", photoPath ?? ""],
    enabled: !!photoPath,
    staleTime: SIGNED_STALE_MS,
    gcTime: SIGNED_STALE_MS,
    queryFn: async () => {
      if (!photoPath) return null;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(photoPath, SIGNED_TTL_SEC);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * Read-only avatar (list rows, detail page).
 *
 * States:
 *   - no photoPath                → initials / user glyph
 *   - signed URL loading          → shimmer skeleton
 *   - signed URL error            → warning glyph with retry button
 *   - signed URL ok, img loading  → shimmer skeleton behind <img>
 *   - signed URL ok, img error    → same retry fallback (re-signs and retries decode)
 */
export function EmployeeAvatar({
  photoPath,
  name,
  size = 32,
  className = "",
}: {
  photoPath: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const qc = useQueryClient();
  const {
    data: url,
    isLoading: urlLoading,
    isError: urlError,
    refetch,
  } = useEmployeePhotoUrl(photoPath);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Reset image state when the underlying URL changes.
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [url]);

  const dim = { width: size, height: size };
  const base =
    "relative rounded-full bg-muted text-muted-foreground flex items-center justify-center overflow-hidden shrink-0";
  const skeleton =
    "absolute inset-0 rounded-full bg-gradient-to-br from-muted via-muted-foreground/10 to-muted animate-pulse";

  // No photo assigned → initials.
  if (!photoPath) {
    return (
      <div
        style={dim}
        className={`${base} ${className}`}
        aria-label={name ? `${name} (no photo)` : "No photo"}
      >
        {name ? (
          <span className="text-xs font-medium">{initials(name)}</span>
        ) : (
          <UserIcon className="h-4 w-4" aria-hidden="true" />
        )}
      </div>
    );
  }

  const retry = () => {
    setImgError(false);
    setImgLoaded(false);
    // Force a fresh signed URL — the old one may have expired or 404'd.
    qc.removeQueries({ queryKey: ["employee-photo-url", photoPath] });
    refetch();
  };

  // Signed URL failed OR image itself failed to decode.
  if (urlError || imgError) {
    return (
      <button
        type="button"
        onClick={retry}
        style={dim}
        className={`${base} ${className} group border border-dashed border-destructive/40 text-destructive hover:bg-destructive/5 transition-colors`}
        aria-label={name ? `Reload photo for ${name}` : "Reload photo"}
        title="Photo failed to load — click to retry"
      >
        <RefreshCw
          className="h-4 w-4 opacity-70 group-hover:opacity-100 group-hover:rotate-90 transition-transform"
          aria-hidden="true"
        />
      </button>
    );
  }

  return (
    <div
      style={dim}
      className={`${base} ${className}`}
      aria-busy={urlLoading || (!!url && !imgLoaded)}
    >
      {/* Shimmer while URL resolves OR image decodes. */}
      {(urlLoading || (!!url && !imgLoaded)) && <span className={skeleton} aria-hidden="true" />}
      {url && (
        <img
          src={url}
          alt={name ? `${name}'s photo` : "Employee photo"}
          style={dim}
          className={`rounded-full object-cover transition-opacity duration-200 ${
            imgLoaded ? "opacity-100" : "opacity-0"
          }`}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}

/**
 * Upload/replace/remove photo widget for the employee form. Uploads happen
 * immediately so the parent form only has to persist `value` (the storage
 * path) on save. Orphan files are cheap and rare — an unsaved cancel leaves
 * an unreferenced object in the bucket, which a future cron can prune.
 */
export function EmployeePhotoPicker({
  value,
  onChange,
  name,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  name?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading">("idle");
  const { data: url } = useEmployeePhotoUrl(value);

  /** PUT the blob to a signed upload URL with real XHR upload progress. */
  function putWithProgress(signedUrl: string, blob: Blob, contentType: string) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload aborted"));
      xhr.send(blob);
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      toast.error("Photo must be JPG, PNG, WebP, or GIF");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Photo must be 5 MB or smaller");
      return;
    }

    const replacing = !!value;
    const toastId = toast.loading(replacing ? "Replacing photo…" : "Uploading photo…", {
      description: "Preparing image…",
    });
    setUploading(true);
    setProgress(0);
    setPhase("compressing");

    try {
      const { blob, ext, contentType } = await compressImage(file);
      const path = `emp/${crypto.randomUUID()}.${ext}`;

      setPhase("uploading");
      toast.loading(replacing ? "Replacing photo…" : "Uploading photo…", {
        id: toastId,
        description: "Uploading to secure storage…",
      });

      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("Could not start upload");

      await putWithProgress(signed.signedUrl, blob, contentType);
      setProgress(100);

      if (value) {
        await supabase.storage
          .from(BUCKET)
          .remove([value])
          .catch(() => {});
      }
      onChange(path);

      const savedKb = Math.max(0, Math.round((file.size - blob.size) / 1024));
      toast.success(replacing ? "Photo replaced" : "Photo uploaded", {
        id: toastId,
        description:
          savedKb > 20
            ? `Compressed — saved ~${savedKb} KB`
            : `${Math.round(blob.size / 1024)} KB stored`,
      });
    } catch (err: any) {
      toast.error(replacing ? "Could not replace photo" : "Could not upload photo", {
        id: toastId,
        description: err?.message ?? "Please try again.",
      });
    } finally {
      setUploading(false);
      setPhase("idle");
      setProgress(0);
    }
  }

  async function handleRemove() {
    if (!value) return;
    const stale = value;
    onChange(null);
    const { error } = await supabase.storage.from(BUCKET).remove([stale]);
    if (error) {
      toast.error("Photo removed from form, but stored file could not be deleted", {
        description: error.message,
      });
    } else {
      toast.success("Photo removed");
    }
  }

  const phaseLabel =
    phase === "compressing"
      ? "Compressing…"
      : phase === "uploading"
        ? progress >= 100
          ? "Finalizing…"
          : `Uploading… ${progress}%`
        : "";

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <EmployeeAvatar photoPath={value} name={name} size={72} />
        {uploading && (
          <div className="absolute inset-0 rounded-full bg-background/70 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFile}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
            {value ? "Replace" : "Upload"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 min-w-11 text-destructive"
              onClick={handleRemove}
              disabled={uploading}
            >
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
        {uploading ? (
          <div
            className="flex flex-col gap-1 max-w-xs"
            role="status"
            aria-live="polite"
            aria-label={phaseLabel}
          >
            <Progress value={phase === "compressing" ? undefined : progress} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground">{phaseLabel}</p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Optional. JPG/PNG/WebP/GIF up to 5 MB. {url ? "Preview visible above." : ""}
          </p>
        )}
      </div>
    </div>
  );
}
