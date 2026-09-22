"use client";

import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { platformLabel } from "@/lib/stores";
import { TECH_LABEL, type TechCounts, type TechKey } from "@/lib/tech";

const APP_CHIPS = 10;

const selectClass =
  "h-7 max-w-full rounded-lg border bg-background px-2 text-[12px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const Count = ({ n }: { n: number }) => <span className="font-mono text-[10px] tabular-nums opacity-60">{n.toLocaleString("en-US")}</span>;

/**
 * The tech-stack row on the wall: platform, theme and apps, each with the
 * number of blocks it would show. Counts respect the other active filters, so
 * a zero never appears; the selected value always stays visible.
 */
export function TechFilters({
  counts,
  value,
  onChange,
}: {
  counts: TechCounts;
  value: Record<TechKey, string>;
  onChange: (key: TechKey, value: string) => void;
}) {
  const withSelected = (key: TechKey) =>
    value[key] && !counts[key].some(([v]) => v === value[key]) ? [[value[key], 0] as [string, number], ...counts[key]] : counts[key];
  const platforms = withSelected("platform"), themes = withSelected("theme"), apps = withSelected("app");
  const chipApps = apps.slice(0, APP_CHIPS);
  const moreApps = apps.slice(APP_CHIPS);
  const selectedInMore = moreApps.some(([v]) => v === value.app);
  if (!platforms.length && !themes.length && !apps.length) return null;

  return (
    <section aria-label="Tech stack" className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <h2 className="inline-flex items-center gap-1.5 text-[12px] font-medium">
        <Layers className="size-3.5 text-muted-foreground" aria-hidden />
        Tech stack
      </h2>

      {platforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={TECH_LABEL.platform}>
          {platforms.map(([p, n]) => (
            <Button key={p} variant="outline" size="sm" active={value.platform === p} aria-pressed={value.platform === p} onClick={() => onChange("platform", value.platform === p ? "" : p)}>
              {platformLabel(p)} <Count n={n} />
            </Button>
          ))}
        </div>
      )}

      {themes.length > 0 && (
        <select aria-label="Theme" value={value.theme} onChange={(e) => onChange("theme", e.target.value)} className={selectClass}>
          <option value="">All themes ({themes.length})</option>
          {themes.map(([t, n]) => (
            <option key={t} value={t}>
              {t} ({n.toLocaleString("en-US")})
            </option>
          ))}
        </select>
      )}

      {apps.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Apps">
          {chipApps.map(([a, n]) => (
            <Button key={a} variant="outline" size="sm" active={value.app === a} aria-pressed={value.app === a} onClick={() => onChange("app", value.app === a ? "" : a)}>
              {a} <Count n={n} />
            </Button>
          ))}
          {moreApps.length > 0 && (
            <select aria-label="More apps" value={selectedInMore ? value.app : ""} onChange={(e) => onChange("app", e.target.value)} className={selectClass}>
              <option value="">{moreApps.length} more apps</option>
              {moreApps.map(([a, n]) => (
                <option key={a} value={a}>
                  {a} ({n.toLocaleString("en-US")})
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </section>
  );
}
