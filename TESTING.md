# Testing Cheat Sheet 🧪

Quick reference for the automated button tests. (Tool: [Playwright](https://playwright.dev).)

---

## Run the tests

```bash
npm test                 # the branch gate -- same as test:local
npm run test:local       # this checkout, offline, deterministic
npm run test:prod        # the DEPLOYED site (only meaningful after a deploy)
npm run test:all         # both, in one run
npm run test:smoke       # just the crash check (fast, broad)
npm run test:functional  # just the "did it actually work" checks
```

**The split matters (D-065).** `test:local` loads `index.html` from your checkout over
`file://`, so it tests the code you are about to push and never touches the network.
`test:prod` fetches the live GitHub Pages site, so it can only tell you about what is
already deployed -- it cannot validate a branch, and it goes red when the network hiccups.
Mixing them into one number is why several "failures" turned out to be neither.

**First time on a new computer only:**
```bash
npm install
npx playwright install
```

See a nice visual report after a run:
```bash
npx playwright show-report
```

---

## The two test types (this is the important bit)

| | Smoke test | Functional test |
|---|---|---|
| **File** | `tests/button-smoke.spec.js` | `tests/buttons-functional.spec.js` |
| **Asks** | "Does clicking anything **crash**?" | "Did the button **actually do its job**?" |
| **Catches** | Errors, broken/dead buttons, crashed tabs | "It ran but did nothing" bugs |
| **Misses** | Silent no-ops (e.g. Print that prints nothing) | Buttons it doesn't have a test for |
| **Coverage** | Every visible button (~200 clicks) | Key flows, asserted one by one |

> 🔑 **Why you need both:** a smoke test is a *smoke detector* — it screams when something's on fire (a crash). A functional test is a *taste test* — it checks the result is actually right. The Print bug slipped past smoke because nothing crashed; only a functional test ("did the printable page get built?") catches that.

---

## What the functional tests check

- **Tabs** — every nav tab opens its panel
- **Modals** — Help, Add Recipe, Paste Recipe, Nutrition Goals open *and* close
- **Data menu** — opens; Export actually downloads a `.json`
- **Pantry** — add item to a section · staple Low/OK/Full pill cycles · bought↔expires toggle · **staple set to Low appears on grocery list**
- **Grocery** — add custom item · **Print builds the printable page** · Copy · Clear (with confirm)

---

## When to run them

- **After changing `app.js`, `index.html`, or `style.css`** — especially anything with buttons.
- **Before you commit/push** a change you're unsure about.
- They run against the **live site** (`shinyamadasan.github.io/Meal-Prep`), so push first, wait ~1 min for GitHub Pages to deploy, then test.

---

## Reading the result

```
15 passed (59.6s)        ✅ everything works
1 failed                 ❌ something broke — it prints which button + why
```

A failure shows the test name and what it expected vs. what happened. The button
that broke is named in the test (e.g. `Grocery list › Print builds...`).

---

## Adding a new functional test (copy–paste template)

In `tests/buttons-functional.spec.js`:

```js
test('My new thing works', async ({ page }) => {
  await loadApp(page);              // opens the app, skips the help popup
  await openTab(page, 'grocery');   // switch tab if needed

  await page.getByRole('button', { name: 'My Button' }).click();

  // Assert the OUTCOME you expect:
  await expect(page.locator('#some-element')).toBeVisible();
});
```

Then run `npm run test:functional` to check it.

---

## Auto-run on every push (GitHub Actions)

Tests run **automatically** on GitHub whenever you push a change to `app.js`,
`index.html`, `style.css`, or the tests. You don't have to do anything.

- **Where to watch it:** repo → **Actions** tab → "Button tests".
- ✅ green check = all buttons still work. ❌ red X = something broke (click in to
  see which test + why; a report is attached on failure).
- It runs `test:local` FIRST (fast, offline -- a real regression shows up in about a
  minute), then waits ~90s for GitHub Pages to redeploy your push, then runs
  `test:prod` against the freshly deployed site.
- **Cost:** free (public repo) — and **no AI tokens**, it's just GitHub running
  `npm test` on its own servers.
- You can also trigger it by hand: Actions tab → "Button tests" → "Run workflow".

---

## Files in this system

| File | What it is |
|---|---|
| `tests/button-smoke.spec.js` | Clicks every button, catches crashes |
| `tests/buttons-functional.spec.js` | Asserts buttons do their job |
| `package.json` → `scripts` | The `npm test` shortcuts |
| `playwright.config.js` | Defines the `local` and `prod` projects (which specs each gate runs) |
| `tests/suite-classification.spec.js` | Fails if a spec is filed in the wrong gate |
| `tests/app-ready.js` | Shared "app finished initialising" wait for the local specs |
| `.github/workflows/test.yml` | Auto-runs the tests on every push |
| `.gitignore` | Keeps test junk (`test-results/`) out of git |
| `TESTING.md` | This cheat sheet |
