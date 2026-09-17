import { cn } from "@/lib/utils";

/**
 * The mark: a page cut into three blocks, white on the orange chip, the same
 * lockup family as Next Level's white mark on an orange chip.
 */
export function Logo({ className, spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-primary text-white",
        spinning && "animate-[logo-loading_0.9s_cubic-bezier(0.55,0.12,0.45,0.88)_infinite]",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <rect x="2" y="2" width="12" height="4.5" rx="1" />
        <rect x="2" y="8.25" width="7.5" height="5.75" rx="1" />
        <rect x="10.75" y="8.25" width="3.25" height="5.75" rx="1" />
      </svg>
    </span>
  );
}
