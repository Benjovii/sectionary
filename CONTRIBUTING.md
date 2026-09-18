# Working in this repo

Read [docs/TEAM-PLAN.md](docs/TEAM-PLAN.md) first: it says which folders are
yours. This page is the mechanics.

## Setup

Node 24 and npm 11. Three packages, each with its own lockfile:

```bash
git clone https://github.com/Benjovii/sectionary.git
cd sectionary
npm install            # crawler (Lane A). Skip if you never run it.
cd web && npm install  # web app (Lane B for api/, Lane C for the rest)
npm run dev            # http://localhost:3000
```

A fresh clone shows a full wall: the sample JSON is committed and the block
screenshots load from the deployed site in development
(`web/src/lib/data-source.ts` explains the two switches).

Secrets never go in git. Copy `.env.example` to `.env` (root), and
`web/.env.example` to `web/.env.local`; ask Ben for values through the
password manager, not chat.

## Branches

One branch per person: `ben`, `buna`, `leke`. It works because each of us owns
different folders, so our branches almost never touch the same file.

- `main` is always deployable. Nobody commits to it directly.
- You work on your own branch, all the time. Commit as often as you like, one
  task per commit where you can, with the task in the message:
  `SEC-16 filters: multi-select for platform`.
- **Stay current.** At least every morning, and always before you open a pull
  request, bring `main` into your branch:

  ```bash
  git checkout buna        # your branch
  git pull origin main     # a normal merge, no rebase, no force-push
  ```

- **Merge to `main` at least every Friday**, in the merge window, with CI
  green. Never sit on more than a week of work: a finished task cannot reach
  `main` while an unfinished one shares its branch, so keep half-built work
  behind a flag or out of the way rather than holding the branch back.
- Merge with **"Create a merge commit"**, not squash. Your branch then shares
  history with `main` and simply carries on; you never reset it and never
  force-push. Do not delete your branch after the merge.
- **The one exception:** a change to `web/src/contracts/` gets its own short
  branch from `main`, named `contract/<what>`, and its own pull request. All
  three of us review it and it merges the same day, so it must not wait for
  anyone's week of work. Squash it and delete the branch when it merges. A
  hotfix for something broken on `main` works the same way: `fix/<what>`.

## Pull requests

- Title lists the tasks it contains: `SEC-15 SEC-16 wall and filters`. Put
  one line per task in the description so the board links to the code.
- Touch only your lane's folders. If the diff shows another lane's folder,
  take that change out and ask that lane's owner to make it.
- A PR that touches `web/src/contracts/` carries the `contract` label, changes
  nothing else except docs and fixtures, and is reviewed by all three lanes.
- CI must be green: crawler type-check, web type-check, web build.
- UI changes include a screenshot at 375px wide, taken first, and one at
  desktop width. Mobile comes first in this project.
- Another person reviews before merge. Reviews happen within one working day.

## The board

Every piece of work is a task in the private Next Level space **SEC** before
it starts. Claim it while you work on it, complete it when the PR merges, and
put the PR link in a comment. If you discover work, add a task; do not carry
it in your head.

## Rules that protect the others

- **Do not run the crawler against third-party stores** (`npm run harvest`,
  `validate`, `capture`). Only Lane A does, from one machine. Shopify throttles
  by IP across all of its stores and a second crawler from the same network
  ruins both runs. Your own test store or `config/own-sites.txt` is fine.
- **Do not deploy to production.** Ben deploys until block images live in
  object storage; a deploy from another machine would ship a site with no
  images.
- **Only Lane B writes database migrations.** Numbered files, never edited
  after they merge.
- **Add dependencies only to your own package** (`/`, `web/`, `platform/`).
  A dependency the other web lane needs goes through a PR they review.

## Style

TypeScript, strict. Two-space indent. In the web app follow the Next Level
design language already in `web/src/app/globals.css`: warm neutrals, orange
only on primary actions, focus and selection, hairline borders, 150 ms
transitions, no page-load choreography, no pure black or white. No em-dashes
in user-facing copy.
