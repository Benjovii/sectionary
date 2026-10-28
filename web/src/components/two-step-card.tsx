"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { Download, ShieldCheck } from "lucide-react";
import { beginTwoStep, confirmTwoStep, disableTwoStep, newRecoveryCodes, type TwoStepState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { field } from "@/components/sign-in-form";
import { cn } from "@/lib/utils";

const idle: TwoStepState = { status: "idle" };

type Props = {
  /** When it was turned on, or null when off. */
  since: string | null;
  codesLeft: number;
  /** The setup screen: the QR code (SVG markup made on the server) and the key to type by hand. */
  setup: { qrSvg: string; secret: string } | null;
  configured: boolean;
  note?: string;
};

/** Two-step sign-in on the account page: off, setting up, on. */
export function TwoStepCard({ since, codesLeft, setup, configured, note }: Props) {
  return (
    <section aria-label="Two-step sign-in" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-heading text-[15px] font-semibold">Two-step sign-in</p>
        {since ? (
          <p className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
            <ShieldCheck aria-hidden className="size-3.5 text-link" /> On since {day(since)}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">Off</p>
        )}
      </div>
      {since ? <On codesLeft={codesLeft} /> : setup ? <Setup {...setup} /> : <Off configured={configured} />}
      {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
    </section>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Off({ configured }: { configured: boolean }) {
  return (
    <>
      <p className="text-[13px] text-muted-foreground text-pretty">
        After the email link, also ask for a code from an authenticator app (Google Authenticator, 1Password, Authy). Someone with your inbox still can&apos;t sign in.
      </p>
      {configured ? (
        <form action={beginTwoStep}>
          <Button type="submit" variant="outline">Turn on</Button>
        </form>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-[13px] text-muted-foreground">Two-step sign-in is not switched on for this deployment yet.</p>
      )}
    </>
  );
}

function Setup({ qrSvg, secret }: { qrSvg: string; secret: string }) {
  const [state, confirm, pending] = useActionState(confirmTwoStep, idle);
  const id = useId();
  if (state.status === "codes") return <RecoveryCodes codes={state.codes} done />;
  const error = state.status === "error" ? state.message : null;
  return (
    <div className="flex flex-col gap-4 min-[620px]:flex-row min-[620px]:items-start">
      <div
        aria-label="QR code for your authenticator app"
        role="img"
        className="size-[168px] shrink-0 rounded-lg border bg-white p-2 [&_svg]:size-full"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-[13px] text-muted-foreground">
          <li>In your authenticator app, add an account and scan the code.</li>
          <li>
            Can&apos;t scan? Enter this key instead:
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-[12px] tracking-wider break-all text-foreground">{secret.match(/.{1,4}/g)?.join(" ")}</code>
              <CopyButton text={secret} label="Copy key" />
            </span>
          </li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <form action={confirm} className="flex flex-col gap-2" noValidate>
          <label htmlFor={`${id}-code`} className="sr-only">6-digit code</label>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <input
              id={`${id}-code`}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={cn(field, "font-mono tracking-[0.2em] min-[420px]:flex-1")}
            />
            <Button type="submit" size="lg" disabled={pending} className="h-11">
              {pending ? "Checking…" : "Turn on"}
            </Button>
          </div>
          <p id={`${id}-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>{error}</p>
        </form>
        <Link href="/account" className="self-start rounded text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function On({ codesLeft }: { codesLeft: number }) {
  const [mode, setMode] = useState<"idle" | "codes" | "off">("idle");
  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        Signing in asks for the email link, then a code from your app.{" "}
        <span className="font-mono tabular-nums text-foreground">{codesLeft}</span> recovery {codesLeft === 1 ? "code" : "codes"} left.
      </p>
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setMode("codes")}>New recovery codes</Button>
          <Button variant="ghost" onClick={() => setMode("off")}>Turn off</Button>
        </div>
      ) : (
        <CodeGate key={mode} mode={mode} onCancel={() => setMode("idle")} />
      )}
    </>
  );
}

/** New recovery codes and turning off both need a current code. */
function CodeGate({ mode, onCancel }: { mode: "codes" | "off"; onCancel: () => void }) {
  const [state, submit, pending] = useActionState(mode === "off" ? disableTwoStep : newRecoveryCodes, idle);
  const id = useId();
  if (state.status === "codes") return <RecoveryCodes codes={state.codes} />;
  if (state.status === "off") return <p className="text-[13px] text-muted-foreground">Two-step sign-in is off.</p>;
  const error = state.status === "error" ? state.message : null;
  return (
    <form action={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor={`${id}-code`} className="text-[13px] text-muted-foreground">
        {mode === "off" ? "To turn it off, type a code from your app (or a recovery code)" : "To make new codes, type a code from your app"}
      </label>
      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        <input
          id={`${id}-code`}
          name="code"
          autoFocus
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={20}
          placeholder="123456"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(field, "font-mono tracking-[0.2em] min-[420px]:flex-1")}
        />
        <Button type="submit" size="lg" variant={mode === "off" ? "outline" : "default"} disabled={pending} className="h-11">
          {pending ? "Checking…" : mode === "off" ? "Turn off" : "Make new codes"}
        </Button>
      </div>
      <p id={`${id}-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>{error}</p>
      <button type="button" onClick={onCancel} className="self-start rounded text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        Cancel
      </button>
    </form>
  );
}

/** Shown once. Each works one time, in place of the app's code. */
function RecoveryCodes({ codes, done }: { codes: string[]; done?: boolean }) {
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Sectionary recovery codes\n\n${text}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "sectionary-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-[13px] text-pretty">
        <span className="font-medium">{done ? "Two-step sign-in is on." : "New recovery codes."}</span>{" "}
        <span className="text-muted-foreground">
          Keep these somewhere safe. Each one signs you in once if you lose your phone. You won&apos;t see them again{done ? "" : "; the old ones no longer work"}.
        </span>
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-background px-4 py-3 font-mono text-[13px] tabular-nums min-[420px]:w-fit">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text} label="Copy codes" />
        <button
          type="button"
          onClick={download}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
        >
          <Download aria-hidden className="size-3.5" /> Download
        </button>
        <Link href="/account" className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11">
          I&apos;ve saved them
        </Link>
      </div>
    </div>
  );
}
