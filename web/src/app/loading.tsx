import { WallSkeleton } from "@/components/wall";

/** Route-level loading screen: the filter row and the wall, as placeholders. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="flex flex-wrap items-center gap-2" aria-hidden>
        {[72, 56, 80, 64, 140, 60, 70, 66].map((w, i) => (
          <div key={i} className="shimmer h-7 rounded-lg bg-muted" style={{ width: w }} />
        ))}
      </div>
      <WallSkeleton />
    </div>
  );
}
