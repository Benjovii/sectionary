import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Sectionary collects (very little), why, who helps us run it, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

// Plain-language draft for the private beta, written from what the code does
// today: the waitlist action (welcome/actions.ts), next-themes, no analytics.
// Goes past the lawyer before public launch (SEC-30). If the app starts
// collecting anything new, this page changes in the same pull request.
const sections: LegalSection[] = [
  {
    id: "short",
    title: "The short version",
    body: (
      <ul>
        <li>We collect your email address when you join the waitlist, and almost nothing else.</li>
        <li>We use it to send your invite. We don&apos;t sell it, share it for advertising or add you to other lists.</li>
        <li>There are no analytics, ad pixels or tracking cookies on Sectionary.</li>
        <li>
          Write to <Contact subject="Privacy" /> and we&apos;ll show you what we hold or delete it.
        </li>
      </ul>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <p>
          <strong>When you join the waitlist:</strong> your email address, the time you joined, which form you used,
          the page that sent you to us, and your browser&apos;s user agent (the line that names your browser and
          system). The last two tell us which links bring people in and help us spot automated sign-ups.
        </p>
        <p>
          <strong>When you browse:</strong> our hosting provider keeps short-lived server logs, including IP addresses,
          to keep the site running and secure. We don&apos;t build profiles from them.
        </p>
        <p>
          <strong>In your browser:</strong> your light or dark theme choice is saved in your browser&apos;s local
          storage. It never leaves your device.
        </p>
        <p>When accounts and paid plans arrive, this page will say what they add before they go live.</p>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use it",
    body: (
      <ul>
        <li>To email you once, when your invite is ready, and not again unless you ask.</li>
        <li>To decide who gets invited first (agencies do, for now).</li>
        <li>To keep the waitlist free of spam and duplicate sign-ups.</li>
      </ul>
    ),
  },
  {
    id: "providers",
    title: "Who helps us run Sectionary",
    body: (
      <>
        <p>We use a small number of providers who handle data only on our instructions:</p>
        <ul>
          <li>
            <strong>Vercel</strong> hosts the site and its server logs.
          </li>
          <li>
            <strong>Supabase</strong> hosts the database the waitlist is stored in.
          </li>
        </ul>
        <p>We&apos;ll list any email provider here before we send the first invite.</p>
      </>
    ),
  },
  {
    id: "keep",
    title: "How long we keep it",
    body: (
      <p>
        Your waitlist entry stays until you have an account or ask us to remove it. If Sectionary never opens to you, we
        delete the waitlist when the beta ends.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your choices",
    body: (
      <p>
        You can ask to see the data we hold about you, correct it, or delete it, at any time and at no cost. Write to{" "}
        <Contact subject="Privacy request" /> from the address you signed up with and we&apos;ll answer within 30 days,
        usually much sooner.
      </p>
    ),
  },
  {
    id: "stores",
    title: "The stores in the library",
    body: (
      <p>
        Our crawler captures public store pages only. It never signs in and never captures account, checkout or search
        pages, so it doesn&apos;t collect shoppers&apos; personal data. Store owners can opt out or ask for removal on
        the <Link href="/bot">SectionaryBot page</Link>.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    body: (
      <p>
        If this policy changes, we&apos;ll update the date at the top. If a change affects how we use data you&apos;ve
        already given us, we&apos;ll email you first.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="We collect an email address, and that's about it."
      lede={
        <p>
          Sectionary is built by Blackbird. This page covers the site and the waitlist during the private beta, in
          plain words.
        </p>
      }
      current="/privacy"
      sections={sections}
    />
  );
}
