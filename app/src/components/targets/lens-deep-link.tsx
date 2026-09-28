"use client";

// Phase 4 Track H — deep-link reader for `?lens=` query parameter.
//
// Two modes:
//   1. `?lens=<lensId>`         — tenant-local. Activates an available lens;
//                                 reports missing, deleted and wrong-target links.
//   2. `?lens=opaque:<b64>`     — self-contained. Decodes the config via
//                                 `decodeOpaqueLensUrl`; renders a "viewing
//                                 through shared lens" banner. No DB write.
//
// Opaque links are previews only; their config is not applied to the view.

import { useEffect, useRef, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { decodeOpaqueLensUrl, type EncodedLensPayload } from "@/lib/targets/lens-url";
import { contextController, useTargetContext } from "@/lib/targets/context-controller";

interface LensDto {
  id: string;
  name: string;
  isDefault: boolean;
  deletedAt: string | null;
}

interface LensDeepLinkProps {
  primaryTargetId: string;
}

type BannerState =
  | { kind: "none" }
  | { kind: "activated"; name: string }
  | { kind: "deleted" }
  | { kind: "missing" }
  | { kind: "wrongTarget" }
  | { kind: "unavailable" }
  | { kind: "opaque"; payload: EncodedLensPayload }
  | { kind: "invalid" };

export function LensDeepLink({ primaryTargetId }: LensDeepLinkProps) {
  const { snapshot, ready } = useTargetContext();
  const hasSnapshot = Boolean(snapshot);
  const activeLensId = snapshot?.activeLensId;
  const targetId = snapshot?.secondaryTargetId ?? primaryTargetId;
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [banner, setBanner] = useState<BannerState>({ kind: "none" });
  const [retry, setRetry] = useState(0);
  const handledLink = useRef<string | null>(null);
  const lensParam = searchParams?.get("lens") ?? null;

  useEffect(() => {
    if (!ready || !hasSnapshot) { setBanner({ kind: "none" }); return; }
    const param = lensParam;
    if (param === null) {
      handledLink.current = null;
      setBanner({ kind: "none" });
      return;
    }
    const linkKey = `${pathname ?? ""}:${targetId}:${param}`;
    if (handledLink.current === linkKey) {
      if (activeLensId !== param) {
        setBanner(current => current.kind === "activated" ? { kind: "none" } : current);
      }
      return;
    }
    handledLink.current = linkKey;
    const startingRevision = snapshot?.revision;

    // Opaque variant — decode inline, no server round-trip.
    if (param.startsWith("opaque:")) {
      const decoded = decodeOpaqueLensUrl(param);
      if (decoded) {
        setBanner({ kind: "opaque", payload: decoded });
      } else {
        setBanner({ kind: "invalid" });
      }
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param)) {
      setBanner({ kind: "invalid" });
      return;
    }

    // Tenant-local variant — fetch the lens and activate if alive.
    let cancelled = false;
    let pending = true;
    setBanner({ kind: "none" });
    void (async () => {
      try {
        const res = await fetch(`/api/targets/${targetId}/lenses`);
        if (!res.ok) throw new Error("Lens list unavailable");
        const json = (await res.json()) as { data: LensDto[] };
        if (cancelled) return;
        const existing = (json.data ?? []).find((l) => l.id === param);
        if (!existing) {
          const detailRes = await fetch(
            `/api/targets/${targetId}/lenses/${param}`);
          if (cancelled) return;
          if (detailRes.status === 404) { setBanner({ kind: "missing" }); return; }
          if (!detailRes.ok) throw new Error("Lens detail unavailable");
          const detail = await detailRes.json() as
            { status?: 'deleted' | 'wrongTarget' | 'available'; name?: string };
          if (cancelled) return;
          if (detail.status === 'deleted' || detail.status === 'wrongTarget') {
            setBanner({ kind: detail.status });
            return;
          }
          if (detail.status !== 'available') throw new Error("Invalid lens detail");
          if (activeLensId !== param) {
            if (contextController.getSnapshot().snapshot?.revision !== startingRevision) {
              handledLink.current = null;
              setBanner({ kind: "unavailable" });
              return;
            }
            await contextController.activateLens(targetId, param, startingRevision);
          }
          if (!cancelled) setBanner({ kind: "activated", name: detail.name ?? "Lens" });
          return;
        }
        if (activeLensId !== existing.id) {
          if (contextController.getSnapshot().snapshot?.revision !== startingRevision) {
            handledLink.current = null;
            setBanner({ kind: "unavailable" });
            return;
          }
          await contextController.activateLens(targetId, existing.id, startingRevision);
        }
        if (cancelled) return;
        setBanner({ kind: "activated", name: existing.name });
      } catch {
        if (!cancelled) {
          handledLink.current = null;
          setBanner({ kind: "unavailable" });
        }
      } finally {
        pending = false;
      }
    })();
    return () => {
      cancelled = true;
      if (pending && handledLink.current === linkKey) handledLink.current = null;
    };
  }, [lensParam, pathname, targetId, ready, hasSnapshot, snapshot?.revision, activeLensId, retry]);

  const dismiss = () => {
    setBanner({ kind: "none" });
    if (pathname) {
      // Strip the ?lens= param so reload doesn't re-trigger the banner.
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("lens");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
    }
  };

  if (banner.kind === "none") return null;

  const style =
    "border-b px-4 py-2 text-xs flex items-center gap-2 " +
    (banner.kind === "deleted" || banner.kind === "missing" ||
      banner.kind === "wrongTarget" || banner.kind === "invalid" || banner.kind === "unavailable"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-border/40 bg-muted/30 text-foreground");

  let message: string;
  if (banner.kind === "activated") {
    message = `Lens activated from link: ${banner.name}`;
  } else if (banner.kind === "deleted") {
    message = "This lens was deleted; the current context is unchanged.";
  } else if (banner.kind === "missing") {
    message = "This lens does not exist or is unavailable to this account.";
  } else if (banner.kind === "wrongTarget") {
    message = "This lens belongs to another target.";
  } else if (banner.kind === "unavailable") {
    message = "Could not verify this lens; retry the link.";
  } else if (banner.kind === "opaque") {
    message = `Shared lens preview${
      banner.payload.name ? `: ${banner.payload.name}` : ""
    }; settings are not applied.`;
  } else {
    message = "Shared lens URL could not be decoded; viewing default.";
  }

  return (
    <div className={style} role="status" aria-live="polite">
      <span className="flex-1">{message}</span>
      {banner.kind === "unavailable" && (
        <button type="button" onClick={() => setRetry(value => value + 1)}
          className="rounded border border-current/40 px-2 py-0.5 text-[11px] uppercase tracking-wide">
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="rounded border border-current/40 px-2 py-0.5 text-[11px] uppercase tracking-wide"
      >
        Dismiss
      </button>
    </div>
  );
}
