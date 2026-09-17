"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { industryLabel, platformLabel, rankLabel, type Store, type StoreSet } from "@/lib/stores";

type Sort = "rank" | "brand" | "platform" | "industry";

export function StoresTableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading stores">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5" aria-hidden>
          <div className="shimmer h-3 w-8 rounded bg-muted" />
          <div className="shimmer h-3 w-40 rounded bg-muted" />
          <div className="shimmer hidden h-3 w-28 rounded bg-muted md:block" />
          <div className="shimmer hidden h-3 w-32 rounded bg-muted md:block" />
          <div className="shimmer ml-auto h-3 w-14 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function Select({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: [string, string, number][] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 max-w-full rounded-lg border bg-background px-2 text-[12px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      <option value="">{label}</option>
      {options.map(([v, l, n]) => (
        <option key={v} value={v}>
          {l} ({n})
        </option>
      ))}
    </select>
  );
}

export function StoresTable({ src = "/sample/stores.json" }: { src?: string }) {
  const [data, setData] = useState<StoreSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const f = { platform: sp.get("platform") ?? "", industry: sp.get("industry") ?? "", country: sp.get("country") ?? "", q: sp.get("q") ?? "", sort: (sp.get("sort") as Sort) || "rank" };

  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: StoreSet) => alive && setData(j))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [src]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const stores = useMemo(() => data?.stores ?? [], [data]);
  const count = (pick: (s: Store) => string | null) => {
    const m = new Map<string, number>();
    for (const s of stores) {
      const k = pick(s) || "";
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const platforms = useMemo(() => count((s) => s.platform).map(([v, n]) => [v, platformLabel(v), n] as [string, string, number]), [stores]);
  const industries = useMemo(() => count((s) => s.industry).map(([v, n]) => [v, industryLabel(v), n] as [string, string, number]), [stores]);
  const countries = useMemo(() => count((s) => s.country).map(([v, n]) => [v, v, n] as [string, string, number]), [stores]);

  const q = f.q.trim().toLowerCase();
  const shown = stores
    .filter(
      (s) =>
        (!f.platform || s.platform === f.platform) &&
        (!f.industry || s.industry === f.industry) &&
        (!f.country || s.country === f.country) &&
        (!q || s.brand.toLowerCase().includes(q) || s.host.includes(q) || (s.theme ?? "").toLowerCase().includes(q) || s.apps.some((a) => a.toLowerCase().includes(q))),
    )
    .sort((a, b) => {
      if (f.sort === "brand") return a.brand.localeCompare(b.brand);
      if (f.sort === "platform") return platformLabel(a.platform).localeCompare(platformLabel(b.platform)) || (a.rank ?? 1e9) - (b.rank ?? 1e9);
      if (f.sort === "industry") return industryLabel(a.industry).localeCompare(industryLabel(b.industry)) || (a.rank ?? 1e9) - (b.rank ?? 1e9);
      return (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.n - b.n;
    });
  const active = Boolean(f.platform || f.industry || f.country || f.q);

  const th = (key: Sort, label: string, className = "") => (
    <th className={cn("px-3 py-2 text-left font-medium", className)}>
      <button type="button" onClick={() => set("sort", key === "rank" ? "" : key)} className={cn("rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50", f.sort === key && "text-foreground")}>
        {label}
        {f.sort === key ? " ↓" : ""}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.platform} onChange={(v) => set("platform", v)} label="All platforms" options={platforms} />
        <Select value={f.industry} onChange={(v) => set("industry", v)} label="All industries" options={industries} />
        <Select value={f.country} onChange={(v) => set("country", v)} label="All countries" options={countries} />
        <input
          type="search"
          placeholder="Brand, domain, theme or app…"
          aria-label="Search stores"
          defaultValue={f.q}
          onChange={(e) => set("q", e.target.value)}
          className="h-7 min-w-0 flex-1 basis-44 rounded-lg border bg-background px-2.5 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 sm:max-w-72"
        />
        {active && (
          <Button variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
            Clear
          </Button>
        )}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {data ? `${shown.length} of ${stores.length} stores` : "loading…"}
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>The store list could not be loaded ({error}).</p>
        </div>
      ) : !data ? (
        <StoresTableSkeleton />
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>No store matches. Try a wider filter.</p>
        </div>
      ) : (
        <>
          {/* Phones: one card per store. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((s) => (
              <li key={s.host} className="rounded-lg border bg-card px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{s.brand}</span>
                  <a href={`https://${s.host}/`} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-primary">
                    {s.host} <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{platformLabel(s.platform)}{s.theme ? ` · ${s.theme}` : ""}</span>
                  <span>{industryLabel(s.industry)}</span>
                  {s.country && <span>{s.country}</span>}
                  <span className="font-mono tabular-nums">rank {rankLabel(s.rank)}</span>
                </div>
              </li>
            ))}
          </ul>
          {/* Wider screens: the table. */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <table className="w-full text-[13px]">
              <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">#</th>
                  {th("brand", "Store")}
                  {th("platform", "Platform · theme")}
                  {th("industry", "Industry")}
                  <th className="px-3 py-2 text-left font-medium">Country</th>
                  {th("rank", "Traffic rank", "text-right")}
                  <th className="px-3 py-2 text-left font-medium">Apps</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s, i) => (
                  <tr key={s.host} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5">
                      <a href={`https://${s.host}/`} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        <span className="font-medium">{s.brand}</span>
                        <span className="font-mono text-[11px] text-muted-foreground group-hover:text-primary">{s.host}</span>
                      </a>
                    </td>
                    <td className="px-3 py-1.5">
                      {platformLabel(s.platform)}
                      {s.theme && <span className="text-muted-foreground"> · {s.theme}{s.themeVersion ? ` ${s.themeVersion}` : ""}</span>}
                    </td>
                    <td className="px-3 py-1.5">{industryLabel(s.industry)}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{s.country ?? "–"}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums">{rankLabel(s.rank)}</td>
                    <td className="px-3 py-1.5 text-[12px] text-muted-foreground">
                      {s.apps.slice(0, 3).join(", ")}
                      {s.apps.length > 3 ? ` +${s.apps.length - 3}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
