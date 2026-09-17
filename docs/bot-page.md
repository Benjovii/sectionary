# SectionaryBot (copy for the /bot page)

**Who we are.** SectionaryBot is the crawler behind Sectionary, a reference
library of real website and online-store designs, built by Blackbird.

**What it does.** It visits public pages of online stores the way a browser
does, once, and takes screenshots of those pages so designers can study how
stores are built. It captures at most a handful of pages per store (home,
one or two collections, one or two products) at desktop and phone width, no
more than one page per second, and identifies itself in every request as
`SectionaryBot/<version>` with a link to this page.

**What it does not do.** It never signs in, never adds anything to a cart or
places an order, never captures account, checkout or search pages, never
collects personal data, and never copies your code, images or files. The only
things stored are our own screenshots plus public facts about the page (its
address, the platform it runs on, the apps it loads).

**It respects robots.txt.** Add this to yours and it will stop:

```
User-agent: SectionaryBot
Disallow: /
```

**Opt out or ask for removal.** Send the store address to [contact address,
set when the domain is bought] or use the form on this page. We add the store
to a block list our crawler checks before every run and remove its screenshots
within 48 hours.

**Attribution.** Every screenshot in Sectionary names the store and links to
the page it came from.
