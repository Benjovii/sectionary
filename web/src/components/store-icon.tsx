"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Favicons come from Google's public favicon service, looked up by domain.
 * The capture does not record a store's icon yet; when it does (Lane A), point
 * this at the captured file and nothing else changes.
 *
 * Asked for at 64px, the service answers a domain it has no icon for with a
 * 16px globe (and a 404 the browser ignores for images), so anything that
 * small is treated as missing and gets the letter tile instead. A real 16px
 * favicon blown up to 40px would look no better.
 */
const faviconUrl = (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

/** The store's favicon on a white tile, or its initial when there is none. */
export function StoreIcon({ host, brand, size = 20, className }: { host: string; brand: string; size?: number; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const initial = (brand.trim()[0] ?? host[0] ?? "?").toUpperCase();

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border",
        // White behind the icon: most favicons are drawn for a light tab bar.
        state === "missing" ? "bg-muted text-muted-foreground" : "bg-white",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {state === "missing" ? (
        <span className="font-heading leading-none font-semibold">{initial}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={faviconUrl(host)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => setState(e.currentTarget.naturalWidth <= 16 ? "missing" : "ok")}
          onError={() => setState("missing")}
          className={cn("size-[75%] object-contain transition-opacity duration-150", state === "ok" ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}
