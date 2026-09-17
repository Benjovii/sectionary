// Checks for the polite-crawler rules (SEC-6). Run: npm run polite-check
//   1. robots.txt parsing on a fixed sample (no network)
//   2. the block list, including subdomains
//   3. a live check against myzoobox.com's real robots.txt, treated as a
//      third-party site for the test (own-sites bypass disabled)
import { BOT_NAME, BOT_TOKEN, Politeness, botUserAgent, DESKTOP_BASE_UA, robotsParser } from './polite.js';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}

// 1. Parsing
const sample = `User-agent: *
Disallow: /cart
Disallow: /checkout
Disallow: /account
Disallow: /collections/*sort_by*
Crawl-delay: 2

User-agent: SectionaryBot
Disallow: /private/
`;
const r = robotsParser('https://example-store.com/robots.txt', sample);
check('sample: /products/x allowed for our bot', r.isAllowed('https://example-store.com/products/x', BOT_NAME) === true);
check('sample: /private/ disallowed for our bot (specific group wins)', r.isAllowed('https://example-store.com/private/a', BOT_NAME) === false);
check('sample: /cart disallowed for everyone else', r.isAllowed('https://example-store.com/cart', 'Mozilla/5.0') === false);
check('sample: wildcard rule /collections/*sort_by*', r.isAllowed('https://example-store.com/collections/all?sort_by=price', '*') === false);
check('UA token carries the bot name', botUserAgent(DESKTOP_BASE_UA).endsWith(BOT_TOKEN) && BOT_TOKEN.startsWith('SectionaryBot/'));

// 2. Block list
const p = new Politeness({ blocklist: ['blocked-shop.example'], ownSites: ['myzoobox.com'] });
check('blocklist: exact host', p.isBlocked('blocked-shop.example'));
check('blocklist: subdomain', p.isBlocked('shop.blocked-shop.example'));
check('blocklist: www stripped', p.isBlocked('www.blocked-shop.example'));
check('blocklist: other host not blocked', !p.isBlocked('open-shop.example'));
check('own site: recognised', p.isOwn('www.myzoobox.com'));
check('blocklist beats own-site', (await new Politeness({ blocklist: ['myzoobox.com'], ownSites: ['myzoobox.com'] }).allowed('https://myzoobox.com/')).ok === false);

// 3. Live robots.txt on a real Shopify store, treated as third-party
const live = new Politeness();
const results: Record<string, string> = {};
for (const u of ['https://myzoobox.com/', 'https://myzoobox.com/collections/edventures', 'https://myzoobox.com/products/zoo-club', 'https://myzoobox.com/cart', 'https://myzoobox.com/checkout', 'https://myzoobox.com/account']) {
  const v = await live.allowed(u);
  results[new URL(u).pathname] = v.ok ? 'allowed' : v.reason;
}
console.log('live myzoobox.com verdicts:', JSON.stringify(results));
check('live: home allowed', results['/'] === 'allowed');
check('live: product allowed', results['/products/zoo-club'] === 'allowed');
check('live: /checkout disallowed by the store robots.txt', results['/checkout'] === 'robots');
check('live: /account disallowed by the store robots.txt', results['/account'] === 'robots');
console.log(`      (/cart is ${results['/cart']} on this store; Shopify lets merchants edit robots.txt, so it varies)`);

// 4. Pacing: two waits on one host must be at least ~1 s apart
const t0 = Date.now();
await live.wait('pace-test.example');
await live.wait('pace-test.example');
await live.wait('pace-test.example');
const elapsed = Date.now() - t0;
check('pacing: 3 slots on one host take >= 2 s', elapsed >= 1900, `${elapsed} ms`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll polite-crawler checks passed.');
process.exit(failures ? 1 : 0);
