import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Next Level's button recipe on a plain <button>: rust only on the default
// (primary) variant, hairline outline otherwise, rust ring on focus.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "border-border bg-card hover:bg-muted hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        link: "text-link underline-offset-4 hover:underline",
      },
      // Desktop density by default; 44px under a finger (the touch variant in
      // globals.css), which is the smallest target a thumb hits reliably.
      size: {
        default: "h-8 px-2.5 touch:h-11 touch:px-3.5",
        sm: "h-7 px-2.5 text-[12px] touch:h-11 touch:px-3 touch:text-[13px]",
        lg: "h-9 px-3 touch:h-11",
        icon: "size-8 touch:size-11",
        "icon-sm": "size-7 touch:size-11",
      },
      active: {
        // Selected filter or option: rust, with the button text colour on it.
        true: "border-primary bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, active, type = "button", ...props }: ButtonProps) {
  return <button type={type} data-slot="button" className={cn(buttonVariants({ variant, size, active, className }))} {...props} />;
}

export { buttonVariants };
