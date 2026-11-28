// First-time-user self-test for prototypes/ux-consolidation/index.html.
// Clicks visible labels only. Usage: node selftest.js <path-to-index.html> <audit-dir>
// Needs Playwright (set PLAYWRIGHT_PATH to a node_modules/playwright folder if it is not resolvable).
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const fs = require('fs');
const FILE = path.resolve(process.argv[2]);
const SHOTS = process.argv[3] ? path.resolve(process.argv[3]) : null;
const URL = 'file:///' + FILE.replace(/\\/g, '/');

const CONFIGS = [
  { name: '390x844 light', w: 390, h: 844, scheme: 'light', shots: true },
  { name: '390x844 dark', w: 390, h: 844, scheme: 'dark' },
  { name: '360x780 light', w: 360, h: 780, scheme: 'light' },
  { name: '360x780 dark', w: 360, h: 780, scheme: 'dark' }
];

// Runs in the page: contrast of every visible text node + tap-target sizes.
function measure() {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let bg = parse(getComputedStyle(document.body).backgroundColor); if (bg[3] < 1) bg = [255, 255, 255, 1]; for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg); return bg; };
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; if (e.hidden) return false; } const vw = innerWidth, vh = innerHeight; return r.bottom > 0 && r.top < vh * 6 && r.right > 0 && r.left < vw; };
  const sel = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')) + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28) + '"';
  const text = [];
  document.querySelectorAll('body *').forEach(el => {
    if (['SCRIPT', 'STYLE', 'svg', 'path', 'circle', 'rect'].includes(el.tagName)) return;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own || !visible(el)) return;
    const fg = parse(getComputedStyle(el).color); const bg = bgOf(el);
    text.push({ el: sel(el), ratio: +ratio(over(fg, bg), bg).toFixed(2) });
  });
  // Non-text UI: badge fill vs nav, checkbox outline vs surface.
  const ui = [];
  document.querySelectorAll('.badge, .check').forEach(el => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    const fill = el.classList.contains('check') ? parse(cs.borderTopColor) : parse(cs.backgroundColor);
    const around = bgOf(el.parentElement);
    ui.push({ el: sel(el), ratio: +ratio(over(fill, around), around).toFixed(2) });
  });
  const taps = [];
  document.querySelectorAll('button, a[href], input:not([type=checkbox]):not([type=hidden]), select, textarea, summary, label').forEach(el => {
    if (el.tagName === 'LABEL' && !el.querySelector('input[type=checkbox]')) return;
    if (el.tagName === 'BUTTON' && el.closest('label')) return;
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    taps.push({ el: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
  });
  return { text, ui, taps, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
}

(async () => {
  const browser = await chromium.launch();
  const summary = [];
  for (const cfg of CONFIGS) {
    const ctx = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, colorScheme: cfg.scheme, hasTouch: true, isMobile: true, deviceScaleFactor: cfg.shots ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [], requests = [], jobs = [], m = { text: [], ui: [], taps: [] }, overflow = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (!r.url().startsWith('file:')) requests.push(r.url()); });
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    page.setDefaultTimeout(5000);
    await page.goto(URL);
    const btn = (name, exact = true) => page.getByRole('button', { name, exact });
    const nav = name => page.locator('nav').getByRole('button', { name: new RegExp('^' + name + '( \\d+)?$') });
    const sheet = page.locator('#sheet');
    const toastText = () => page.locator('#toast-msg').textContent();
    const shot = async n => { if (cfg.shots && SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
    const snap = async label => {
      const r = await page.evaluate(measure);
      r.text.forEach(t => m.text.push({ ...t, at: label }));
      r.ui.forEach(t => m.ui.push({ ...t, at: label }));
      r.taps.forEach(t => m.taps.push({ ...t, at: label }));
      if (r.scrollW > r.clientW) overflow.push(label + ' ' + r.scrollW + '>' + r.clientW);
    };
    const closeSheet = async () => { if (await sheet.evaluate(s => s.classList.contains('open'))) { await sheet.getByRole('button', { name: 'Close', exact: true }).click(); } };
    const job = async (name, taps, fn) => {
      try { await fn(); jobs.push({ name, ok: true, taps }); console.error(cfg.name, 'PASS', name); }
      catch (e) { const msg = String(e).split('\n').slice(0, 3).join(' '); jobs.push({ name, ok: false, err: msg }); console.error(cfg.name, 'FAIL', name, msg); await closeSheet().catch(() => {}); }
    };
    const expectText = async (loc, re) => { const t = await loc.textContent(); if (!re.test(t)) throw new Error('expected ' + re + ' got "' + t.slice(0, 80) + '"'); };
    const reset = async () => { await page.getByRole('button', { name: 'Settings, sync and backups' }).click(); await btn(/Reset prototype data/, false).click(); };

    await snap('home'); await shot('proto-01-home');

    await job('1 What can I eat now', 1, async () => {
      await page.locator('#eat-now').getByRole('button', { name: 'Eat 1', exact: false }).first().click();
      await expectText(page.locator('#toast-msg'), /Enjoy!/);
      await snap('home+toast');
    });

    await job('2 Cook something quick', 4, async () => {
      await nav('Cook').click();
      await snap('cook-quick'); await shot('proto-02-cook-quick');
      await page.locator('#recipe-browser').getByRole('button', { name: /^Tuna Rice Bowl/ }).click();
      await snap('recipe-sheet'); await shot('proto-03-recipe-sheet');
      await btn('I cooked this').click();
      await btn('Save').click();
      await expectText(page.locator('#toast-msg'), /Logged|portions saved/);
    });

    await job('3 Plan a meal-prep batch (from Home)', 4, async () => {
      await nav('Home').click();
      await page.getByRole('button', { name: /^Meal prep/ }).click();
      await btn('+ Add').click();
      await sheet.getByRole('button', { name: /Chicken Adobo/ }).click();
      await btn('Done').click();
      await expectText(page.locator('main'), /Chicken Adobo/);
      await snap('meal-prep'); await shot('proto-04-meal-prep');
      await btn('Start prep day').click();
      await snap('prep-day'); await shot('proto-05-prep-day');
      await btn(/^Done: \d+ portions to Kitchen/, false).first().click();
      await expectText(page.locator('#toast-msg'), /portions in Kitchen/);
      await closeSheet();
    });

    await job('4 I just shopped', 2, async () => {
      await nav('Shop').click();
      await snap('shop'); await shot('proto-06-shop');
      await btn('Bought Milk').click();
      await expectText(page.locator('#toast-msg'), /→ Kitchen/);
      await btn('Bought something else?').click();
      await page.getByLabel('One item per line. Amount and date are optional.').fill('Yogurt 2');
      await btn('Add to Kitchen').click();
      await expectText(page.locator('#toast-msg'), /1 item added/);
    });

    await job('5 We\'re out of X (egg ranks Eggs first)', 3, async () => {
      await nav('Home').click();
      await btn('We\'re out of…').click();
      await page.getByLabel('Find the item you ran out of').fill('egg');
      const first = await page.locator('#out-list .menu-row:not([hidden])').first().getAttribute('data-name');
      if (first !== 'Eggs') throw new Error('first match was ' + first);
      await snap('out-of'); await shot('proto-08-out-of');
      await page.locator('#out-list').getByRole('button', { name: /^Eggs/ }).click();
      await expectText(page.locator('#toast-msg'), /Out of Eggs · added to Shop/);
    });

    await job('6 Make a sauce / prepped ingredient', 4, async () => {
      await nav('Cook').click();
      await btn('Sauces & prep').click();
      await btn('Made a batch of Chili-Garlic Oil').click();
      await btn('Save to Kitchen').click();
      await expectText(page.locator('#toast-msg'), /saved to Kitchen › Prepped/);
      await btn('Made Boiled eggs').click();
      await btn('Save to Kitchen').click();
      await nav('Kitchen').click();
      await btn(/^Prepped/, false).click();
      await expectText(page.locator('main'), /Boiled eggs/);
      await snap('kitchen-prepped'); await shot('proto-07-kitchen');
    });

    await job('7 Find a flavor', 1, async () => {
      await nav('Cook').click();
      await page.getByLabel('Search recipes and flavors').fill('chili');
      await expectText(page.locator('main'), /Flavors \(\d\)[\s\S]*Chili-Garlic Oil/);
      await snap('search'); await shot('proto-10-search');
      await page.getByLabel('Search recipes and flavors').fill('');
    });

    await job('8 Shop without a plan', 2, async () => {
      await nav('Shop').click();
      await btn('+ Cabbage').click();
      await expectText(page.locator('#toast-msg'), /Cabbage added to Shop/);
      if (await page.getByRole('button', { name: '+ Bread' }).count() > 1) throw new Error('duplicate Bread quick pick');
    });

    await reset();
    await job('9 Flavor authoring: add, edit, delete, undo, style filter, starters', 4, async () => {
      await nav('Cook').click();
      await btn('Sauces & prep').click();
      await snap('flavor-library'); await shot('proto-09-flavors');
      await btn('+ Add your own flavor').click();
      await btn('Save flavor').click();
      if (await page.locator('#fl-err').isHidden()) throw new Error('empty name accepted');
      await page.getByLabel('Name').fill('Peanut Sauce');
      await sheet.getByText('Chicken', { exact: true }).click();
      await page.getByLabel('Ingredients (one per line)').fill('Peanut butter\nSoy sauce\nCalamansi');
      await snap('flavor-editor'); await shot('proto-15-flavor-editor');
      await btn('Save flavor').click();
      await expectText(page.locator('#toast-msg'), /Peanut Sauce added/);
      await expectText(page.locator('#sheet-title'), /Peanut Sauce/);
      await snap('flavor-sheet');
      await btn('Edit').click();
      await page.getByLabel('Name').fill('Peanut-Calamansi Sauce');
      await btn('Save flavor').click();
      await expectText(page.locator('#sheet-title'), /Peanut-Calamansi Sauce/);
      await btn('Delete').click();
      await btn('Delete flavor').click();
      await expectText(page.locator('#toast-msg'), /deleted/);
      if (await page.locator('#flavor-library').getByText('Peanut-Calamansi Sauce').count()) throw new Error('still listed after delete');
      await page.locator('#toast-undo').click();
      await expectText(page.locator('#flavor-library'), /Peanut-Calamansi Sauce/);
      await page.locator('#flavor-library').getByRole('button', { name: 'Freezer-friendly', exact: true }).click();
      const rows = await page.locator('#flavor-library .row .row-meta').allTextContents();
      if (!rows.length || rows.some(t => !/Freezer-friendly/.test(t))) throw new Error('style filter leaked: ' + rows.join(' | '));
      await page.locator('#flavor-library').getByRole('button', { name: 'Any', exact: true }).first().click();
      // Starter prompt: delete a starter (Garlic Butter), then add the rest; deleted one stays out.
      await page.locator('#flavor-library').getByRole('button', { name: /^Garlic Butter/ }).click();
      await btn('Delete').click(); await btn('Delete flavor').click();
      const prompt = await page.locator('#starter-flavors').textContent();
      if (/Garlic Butter/.test(prompt)) throw new Error('deleted starter re-offered');
      await btn('Add them').click();
      if (await page.locator('#starter-flavors').count()) throw new Error('prompt did not retire');
      await expectText(page.locator('#flavor-library'), /Sweet Chili Glaze/);
    });

    await job('10 Favorites', 2, async () => {
      await btn('Quick cook').click();
      await btn('Favorite Garlic Fried Rice').click();
      await page.locator('#recipe-browser').getByRole('button', { name: /♥ Favorites/ }).click();
      const names = await page.locator('#recipe-browser .row-title').allTextContents();
      if (!names.includes('Garlic Fried Rice') || !names.includes('Tuna Rice Bowl') || names.includes('Eggplant Omelette')) throw new Error('favorites list: ' + names.join(', '));
      await snap('favorites'); await shot('proto-16-favorites');
      await page.locator('#recipe-browser').getByRole('button', { name: /♥ Favorites/ }).click();
    });

    await job('11 Method chips (D-060) + filters', 2, async () => {
      for (const l of ['Lowest effort', 'Rice cooker', 'Oven', 'Air Fryer', 'Instant Pot', 'No-cook', 'Pan', 'Batch-friendly'])
        if (!(await page.locator('#recipe-browser').getByRole('button', { name: new RegExp('^' + l + ' \\d') }).isVisible())) throw new Error(l + ' chip not visible in Quick cook');
      await page.locator('#recipe-browser').getByRole('button', { name: /^Rice cooker 0/ }).click();
      await expectText(page.locator('#recipe-browser'), /No rice cooker recipes under 30 min yet — open a recipe, tick Rice cooker under Cooking method/);
      await shot('proto-17-method-empty');
      await btn('All recipes').click();
      await page.locator('#recipe-browser').getByRole('button', { name: /^Rice cooker 1/ }).click();
      await expectText(page.locator('#recipe-browser'), /Rice Cooker Chicken & Rice/);
      await page.locator('#recipe-browser').getByRole('button', { name: /^All \d/ }).click();
      await page.locator('#recipe-browser').getByRole('button', { name: /^Filters/ }).click();
      await sheet.getByRole('button', { name: /^Breakfast \d/ }).click();
      await sheet.getByRole('button', { name: /^High fiber/ }).click();
      await snap('filter-sheet'); await shot('proto-18-filters');
      await sheet.getByRole('button', { name: /^Show 1 recipe$/ }).click();
      await expectText(page.locator('#recipe-browser'), /Overnight Oats/);
      await btn('Remove filter Breakfast').click(); await btn('Remove filter High fiber (>5 g)').click();
      await snap('all-recipes');
    });

    await job('12 Undo restores only its own change', 3, async () => {
      await btn('Meal prep').click();
      await btn('Remove Mung Bean Stew from plan').click();
      await btn('More servings').first().click(); // Rice Cooker batch 4 → 5 (not undoable)
      await page.locator('#toast-undo').click();
      const t = await page.locator('main').textContent();
      if (!/Mung Bean Stew/.test(t)) throw new Error('batch not restored');
      const riceServ = await page.locator('[aria-label="Servings for Rice Cooker Chicken & Rice"] span').textContent();
      if (riceServ !== '5') throw new Error('later servings change was reverted: ' + riceServ);
    });

    await job('13 Serving scaler in recipe sheet', 2, async () => {
      await btn('All recipes').click();
      await page.locator('#recipe-browser').getByRole('button', { name: /^Chicken Adobo/ }).click();
      await sheet.getByRole('button', { name: 'More servings' }).click();
      await expectText(page.locator('#detail-ings'), /1¼ kg/);
      await expectText(page.locator('#detail-ings'), /to taste|1¼ tsp/);
      await closeSheet();
    });

    await job('14 Cook history (Settings › History)', 2, async () => {
      await page.getByRole('button', { name: 'Settings, sync and backups' }).click();
      await snap('settings'); await shot('proto-11-settings');
      await btn(/^Cook history/, false).click();
      await expectText(sheet, /Egg & Tomato Rice/);
      await closeSheet();
    });

    await job('15 Remove expired (Kitchen ⋯)', 3, async () => {
      await nav('Kitchen').click();
      await btn('More kitchen tools').click();
      await btn(/^Remove expired \(1\)/, false).click();
      await expectText(page.locator('#toast-msg'), /Removed 1 expired item/);
      await page.locator('#toast-undo').click();
      await btn(/to check/, false).click();
      await expectText(page.locator('main'), /Pechay/);
      await snap('kitchen-review');
      await btn('Show all').click();
      await btn(/^Ingredients/, false).click();
      await snap('kitchen-ingredients');
    });

    await job('16 Shop "Not anymore?"', 3, async () => {
      await nav('Shop').click();
      await page.getByText(/Already in your kitchen/).click();
      await btn('Garlic: not anymore?').click();
      await btn('It\'s gone · add to list').click();
      await expectText(page.locator('#toast-msg'), /Garlic corrected · Garlic on your list/);
      await snap('shop-after');
    });

    // Extra screens for measurement only.
    await nav('Home').click(); await snap('home-final');
    if (cfg.name === '360x780 light') await shot('proto-12-home-360-light');
    await btn('We\'re out of…').click(); await snap('out-sheet-full'); await closeSheet();
    await nav('Cook').click(); await btn('Instant').click(); await snap('cook-instant');
    await nav('Kitchen').click(); await btn(/^Ready/, false).click(); await snap('kitchen-ready');
    if (cfg.scheme === 'dark' && cfg.w === 390 && SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'proto-13-kitchen-dark.png') });
    }
    if (cfg.scheme === 'dark' && cfg.w === 360 && SHOTS) { await nav('Home').click(); await page.screenshot({ path: path.join(SHOTS, 'proto-12-home-360-dark.png') }); }

    const minText = m.text.reduce((a, b) => (b.ratio < a.ratio ? b : a), { ratio: 99 });
    const minUi = m.ui.reduce((a, b) => (b.ratio < a.ratio ? b : a), { ratio: 99 });
    const minTap = m.taps.reduce((a, b) => (Math.min(b.w, b.h) < Math.min(a.w, a.h) ? b : a), { w: 999, h: 999 });
    const uniq = arr => [...new Map(arr.map(x => [x.el, x])).values()];
    summary.push({
      config: cfg.name,
      jobs: jobs.map(j => (j.ok ? 'PASS ' : 'FAIL ') + j.name + (j.taps && j.ok ? ` (${j.taps} taps)` : '') + (j.err ? ' — ' + j.err : '')),
      consoleErrors: errors, networkRequests: requests, horizontalOverflow: overflow,
      textSamples: m.text.length, textBelow45: uniq(m.text.filter(t => t.ratio < 4.5)), minTextContrast: minText,
      uiSamples: m.ui.length, uiBelow3: uniq(m.ui.filter(t => t.ratio < 3)), minUiContrast: minUi,
      tapSamples: m.taps.length, tapsBelow44: uniq(m.taps.filter(t => t.h < 44 || t.w < 44)), minTap
    });
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(summary, null, 2));
})();
