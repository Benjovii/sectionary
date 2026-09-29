"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copies `text` and says so for two seconds. Screen readers hear it too. */
export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (http, old browser): the text is selectable anyway.
        }
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:h-11",
        className,
      )}
    >
      {copied ? <Check aria-hidden className="size-3.5 text-link" /> : <Copy aria-hidden className="size-3.5" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
