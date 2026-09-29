import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Sectionary: what the library is for, what the screenshots are, and what we promise.",
  alternates: { canonical: "/terms" },
};

// Plain-language draft for the private beta, built on docs/PLAN.md section 9
// (attribution, identify-not-endorse, our screenshots only). Goes past the
// lawyer before public launch (SEC-30); paid plans (SEC-28) add their own
// terms at checkout.
const sections: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <p>
        Sectionary is a reference library of real online-store designs, built by Blackbird (&ldquo;we&rdquo;). By using
        the site or joining the waitlist you agree to these terms. If you don&apos;t agree, please don&apos;t use
        Sectionary.
      </p>
    ),
  },
  {
    id: "beta",
    title: "Sectionary is in beta",
    body: (
      <p>
        The library, its features and these terms will change as we build. Parts of it may be slow, wrong or missing,
        and we may pause or remove features. We&apos;ll say so here when something important changes.
      </p>
    ),
  },
  {
    id: "use",
    title: "Using the library",
    body: (
      <>
        <p>
          Sectionary is for studying how stores are designed: research, benchmarking, briefs, mood boards and client
          presentations. Within that, use it freely. Please don&apos;t:
        </p>
        <ul>
          <li>scrape, bulk-download or mirror the library, or resell access to it;</li>
          <li>get around limits, access controls or the way we serve screenshots;</li>
          <li>present a store&apos;s design as your own, or use it to imitate a brand or mislead its customers;</li>
          <li>use Sectionary for anything unlawful, or in a way that harms the stores in it.</li>
        </ul>
        <p>We may limit or end access for anyone who does.</p>
      </>
    ),
  },
  {
    id: "screenshots",
    title: "The screenshots and the brands in them",
    body: (
      <>
        <p>
          The screenshots are ours: captures of public web pages, shown for reference and comparison. We don&apos;t host
          any store&apos;s code, images or files. Every block names the store and links to the page it came from.
        </p>
        <p>
          The designs, logos, photos and trademarks you see belong to their owners. Brand names identify a store; they
          don&apos;t mean it endorses us or has any link to Sectionary. If you use a screenshot outside Sectionary, keep
          the store&apos;s name and link with it.
        </p>
      </>
    ),
  },
  {
    id: "owners",
    title: "For store owners",
    body: (
      <p>
        If your store is in the library and you&apos;d rather it wasn&apos;t, you can block our crawler or ask for
        removal, and we remove its screenshots within 48 hours. How, on the{" "}
        <Link href="/bot">SectionaryBot page</Link>.
      </p>
    ),
  },
  {
    id: "ours",
    title: "What's ours",
    body: (
      <p>
        The Sectionary site, its software, the way the library is organised, the block names and the data we derive
        (platforms, themes and apps detected) belong to us. Using Sectionary doesn&apos;t give you rights to them beyond
        what these terms allow.
      </p>
    ),
  },
  {
    id: "waitlist",
    title: "The waitlist",
    body: (
      <p>
        Joining the waitlist is free and doesn&apos;t guarantee an invite or any price. We invite people in the order
        that suits the beta, agencies first. How we handle your email is in our <Link href="/privacy">privacy policy</Link>.
      </p>
    ),
  },
  {
    id: "warranty",
    title: "No guarantees",
    body: (
      <>
        <p>
          Sectionary is provided as it is. Screenshots show a page as it looked when captured, and the platform, theme
          and app details are detected automatically, so they can be out of date or wrong. Check anything that matters
          on the live store.
        </p>
        <p>
          As far as the law allows, we aren&apos;t liable for indirect or consequential losses from using Sectionary,
          and our total liability to you is limited to what you paid us in the twelve months before the claim, which
          during the free beta is nothing. Nothing here limits liability that can&apos;t be limited by law.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        When these terms change we update the date at the top; if the change is significant and you&apos;re on the
        waitlist or have an account, we&apos;ll email you first. Questions go to <Contact subject="Terms" />.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms of use"
      title="The terms, in plain words."
      lede={
        <p>
          What Sectionary is for, what the screenshots are, and what we can and can&apos;t promise while the library is
          in beta.
        </p>
      }
      current="/terms"
      sections={sections}
    />
  );
}
