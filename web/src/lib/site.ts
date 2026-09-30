/**
 * Facts the public pages quote (SEC-29). One place, so Terms, Privacy and
 * /bot never disagree.
 */

/** Where people write for removals, privacy and everything else. Set it when
 * the domain is bought (SEC-33); until then the pages say it is coming. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;

/** Bump when the wording of Terms, Privacy or /bot changes. */
export const LEGAL_UPDATED = "2026-09-29";

export const LEGAL_PAGES = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/bot", label: "SectionaryBot" },
] as const;
