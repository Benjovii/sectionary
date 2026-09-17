import { cn } from "@/lib/utils";

/** A placeholder that holds the exact space of what is loading. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("shimmer rounded-md bg-muted", className)} {...props} />;
}
