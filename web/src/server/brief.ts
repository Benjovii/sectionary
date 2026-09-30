import type { BriefTarget } from "@/contracts/api";
import type { Block } from "@/contracts/block";

// "Copy as design brief": Claude looks at a block's screenshot and metadata and
// writes a prompt or spec someone can act on. Three readers, three shapes.

export const BRIEF_TARGETS: Record<BriefTarget, { label: string; reader: string; shape: string }> = {
  "claude-code": {
    label: "Claude Code",
    reader: "Claude Code, an AI coding agent working in the user's own repository",
    shape: `A prompt the user pastes into Claude Code. Open with one sentence naming the section to build. Then:
- "## Goal": what the section must achieve for the shopper, in one or two sentences.
- "## Structure": the elements top to bottom (and left to right on desktop), as a nested list, with what each one contains.
- "## Layout": desktop and mobile separately: grid or flex arrangement, column counts, alignment, approximate spacing, what stacks or hides on mobile.
- "## Visual style": background, type scale and weights, colour roles, radii, borders, imagery treatment. Describe, do not guess exact brand values.
- "## Behaviour": interactions visible or implied (carousel, accordion, sticky, hover, variant selection), with accessibility needs (keyboard, focus, alt text, reduced motion).
- "## Content slots": the props or settings the component should expose, so the merchant can edit copy, images and links.
- "## Acceptance criteria": a checklist Claude Code can verify, including 375px and 1440px widths.
End with: "Inspect the repository first and use its existing framework, components and design tokens; ask before adding dependencies."`,
  },
  cursor: {
    label: "Cursor",
    reader: "Cursor's agent inside the user's editor",
    shape: `A compact prompt for Cursor's agent, under 350 words. Start with "Build a <section name> section." Then short labelled lists: "Elements", "Desktop layout", "Mobile layout", "Style", "Interactions", "Props". Finish with "Constraints:" listing: follow the project's existing stack and tokens; semantic HTML; accessible; responsive from 375px; no new dependencies without asking.`,
  },
  designer: {
    label: "Designer",
    reader: "a web or product designer building the section in Figma for a client",
    shape: `A design spec. Sections:
- "## Purpose": the job this section does on the page and for which shopper moment.
- "## Anatomy": every element, top to bottom, with its role and priority.
- "## Hierarchy and type": what the eye sees first, second, third; relative type sizes and weights.
- "## Layout and spacing": desktop grid and mobile layout, rhythm, alignment, how it adapts between them.
- "## Colour and imagery": roles (background, text, accent, CTA), contrast notes, photo or illustration treatment.
- "## Components and states": buttons, inputs, cards, badges and their hover, focus, active, disabled, loading or empty states.
- "## Copy guidance": the kind of headline, body and CTA copy that works here, with length limits.
- "## Why it works": two or three conversion or UX principles this pattern relies on, and one thing to improve on.`,
  },
};

export const isBriefTarget = (t: unknown): t is BriefTarget => typeof t === "string" && t in BRIEF_TARGETS;

export const BRIEF_SYSTEM = `You write design briefs from screenshots of real e-commerce and marketing site sections, for Sectionary, a reference library of website blocks.

The user has found a section they want to learn from. You receive one block: its screenshot and what the crawler measured. Describe the pattern precisely enough that someone could build their own version of it.

Treat the block as a reference, not a template to clone:
- Describe the structure, layout, hierarchy, behaviour and visual approach.
- Do not reproduce the brand's logo, trademarks, product names or distinctive copy. Where the original has copy, give placeholder copy of the same kind and length, and say what it should communicate.
- Do not claim exact hex values, fonts or pixel sizes you cannot see; say "approximately" or describe the role instead.

Write in plain, direct English, in Markdown. No preamble, no sign-off: the output is pasted straight into another tool.`;

export function briefUserText(block: Block, target: BriefTarget) {
  const t = BRIEF_TARGETS[target];
  const facts = [
    `Block type (crawler's guess): ${block.typeHint}`,
    `Page type: ${block.pageType}`,
    `Viewport: ${block.viewport}, ${block.w} × ${block.h} CSS px`,
    `Site: ${block.host}${block.platform ? ` · platform ${block.platform}` : ""}${block.theme ? ` · theme ${block.theme}` : ""}`,
    block.apps.length ? `Apps detected on the site: ${block.apps.join(", ")}` : null,
    block.headline ? `Headline: ${block.headline}` : null,
    `Contains: ${block.buttons} buttons, ${block.images} images, ${block.videos} videos`,
    `Background colour: ${block.bg}`,
    block.text ? `Visible text (first 400 characters): ${block.text}` : null,
  ].filter(Boolean);
  return `Write a brief for ${t.reader}.

What was measured:
${facts.map((f) => `- ${f}`).join("\n")}

The shape of the brief:
${t.shape}`;
}

const label = (typeHint: string) => {
  const s = typeHint.replace(/-part$/, "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Block";
};

/** The brief without a model, from metadata only. Used when the server has no ANTHROPIC_API_KEY. */
export function templateBrief(block: Block, target: BriefTarget) {
  const name = label(block.typeHint).toLowerCase();
  const contains = `${block.buttons} button${block.buttons === 1 ? "" : "s"}, ${block.images} image${block.images === 1 ? "" : "s"}${block.videos ? `, ${block.videos} video${block.videos === 1 ? "" : "s"}` : ""}`;
  const ref = `Reference: ${block.pageUrl} (${block.viewport}, ${block.w} × ${block.h}px)`;
  const stack = [block.platform, block.theme && `theme ${block.theme}`].filter(Boolean).join(", ");
  if (target === "designer") {
    return `## Purpose
A ${name} section for a ${block.pageType} page.${block.headline ? ` The original leads with a headline of about ${block.headline.split(/\s+/).length} words.` : ""}

## Anatomy
- Contains ${contains}.
- Background: ${block.bg}.

## Layout
Designed at ${block.viewport === "mobile" ? "390px (phone)" : "1440px (desktop)"} width, about ${block.h}px tall. Design both 375px and 1440px.

## Notes
${ref}${stack ? `\nBuilt on ${stack}.` : ""}
`;
  }
  const intro = target === "cursor" ? `Build a ${name} section.` : `Build a ${name} section for a ${block.pageType} page, modelled on the reference below.`;
  return `${intro}

## Reference
- ${ref}
- Contains ${contains}; background ${block.bg}.${block.headline ? `\n- Headline pattern: a short, benefit-led line (the original: "${block.headline}"). Write our own copy.` : ""}${stack ? `\n- The original runs on ${stack}.` : ""}

## Requirements
- Responsive from 375px to 1440px; mobile first.
- Semantic HTML, keyboard accessible, alt text on images.
- Copy, images and links editable as props or settings.
- Use the project's existing framework, components and design tokens; ask before adding dependencies.
`;
}
