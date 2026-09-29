// Checks detectWall() against the wording of real walls (human checks, access
// denied pages, geo-blocks) and against normal pages that must not match.
// Local HTML only, no network:  npm run wall-check
import { chromium } from 'playwright';
import { detectWall } from './page-script.js';

const filler = '<p>' + 'Beautiful socks for every occasion, made with combed cotton. '.repeat(40) + '</p>';
const cases: [string, string, string | null][] = [
  ['PerimeterX (loft.com)', '<h1>Please verify you are a human</h1><button>PRESS &amp; HOLD</button><p>Access to this page has been denied because we believe you are using automation tools to browse the website.</p>', 'human-check'],
  ['Cloudflare interstitial', '<title>Just a moment...</title><h1>example.com</h1><p>Checking if the site connection is secure</p>', 'human-check'],
  ['Cloudflare turnstile', '<h1>store.com</h1><p>Verify you are human by completing the action below.</p><p>store.com needs to review the security of your connection before proceeding.</p>', 'human-check'],
  ['Akamai', '<h1>Access Denied</h1><p>You don\'t have permission to access "http://www.store.com/" on this server.</p><p>Reference #18.2d3a1002</p>', 'access-denied'],
  ['Imperva', '<p>Request unsuccessful. Incapsula incident ID: 123-456</p>', 'access-denied'],
  ['Distil', '<h1>Pardon Our Interruption</h1><p>As you were browsing something about your browser made us think you were a bot.</p>', 'access-denied'],
  ['Geo-block (stance.eu.com)', '<h1>Restricted Access</h1><p>Sorry,you cannot visit our store from your current location.</p>', 'geo-block'],
  ['Geo-block variant', '<p>We are sorry, this site is not available in your country.</p>', 'geo-block'],
  ['px-captcha element only', '<div id="px-captcha"></div><p>One moment</p>', 'human-check'],
  ['Application error page (mytheresa.com)', '<h1>MYTHERESA</h1><h2>Something went wrong</h2><p>Please try again in a moment. Report the issue by clicking the button below.</p><input placeholder="your@email.com"><button>REPORT ISSUE</button><p>Reference: 3CE:1e4a1202.1790123456</p>', 'error-page'],
  ['Location gate (canyon.com)', '<h1>CANYON</h1><h2>Choose your location and language</h2><p>Suggestion based on your current location</p><ul><li>United States, English</li><li>Canada, English, Francais</li><li>Mexico, Espanol</li></ul>', 'location-gate'],
  ['NEGATIVE long store page with "something went wrong" in help text', `<h1>Help</h1><p>If something went wrong with your order, contact us.</p>${filler}`, null],
  ['NEGATIVE store with a country selector in the footer', `<h1>Timeless bags</h1><p>Handmade in Italy. Choose your country in the footer to see local prices.</p>${filler}`, null],
  ['NEGATIVE short home page with a hidden reCAPTCHA frame (newsletter form)', '<h1>FERIA OUTLET</h1><p>UP TO 60% OFF. 3 cuotas sin interes.</p><form><input placeholder="email"><button>Suscribirme</button></form><iframe src="https://www.google.com/recaptcha/api2/bframe?hl=es" style="width:0;height:0;visibility:hidden;position:absolute"></iframe>', null],
  ['reCAPTCHA challenge shown at full size', '<p>One more step</p><iframe src="https://www.google.com/recaptcha/api2/bframe?hl=en" style="width:400px;height:580px;display:block"></iframe>', 'human-check'],
  ['NEGATIVE normal long store page mentioning the phrase', `<h1>Help</h1><p>If you see access denied, clear your cookies.</p>${filler}`, null],
  ['NEGATIVE empty cart', '<h1>Your cart is empty</h1><a href="/collections/all">Continue shopping</a>', null],
  ['NEGATIVE short landing page', '<h1>Timelessly beautiful</h1><p>Discover the original edit.</p><a>Shop now</a>', null],
  ['NEGATIVE shipping note', '<h1>Shipping</h1><p>We ship worldwide. Free returns within 30 days in your region.</p>', null],
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // Same shim as the crawler: functions sent into the page still call tsx's __name helper.
  await ctx.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  const page = await ctx.newPage();
  let bad = 0;
  for (const [name, html, want] of cases) {
    await page.setContent(`<!doctype html><html><head></head><body>${html}</body></html>`, { waitUntil: 'domcontentloaded' });
    const got = await page.evaluate(detectWall);
    const kind = got ? got.kind : null;
    const ok = kind === want;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(55)} -> ${kind}${ok ? '' : `  (wanted ${want})`}`);
  }
  await browser.close();
  console.log(bad ? `${bad} FAILED` : `all ${cases.length} wall cases pass`);
  process.exit(bad ? 1 : 0);
}

main();
