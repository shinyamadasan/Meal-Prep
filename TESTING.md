# Testing Cheat Sheet 🧪

Quick reference for the automated button tests. (Tool: [Playwright](https://playwright.dev).)

---

## Run the tests

```bash
npm test                 # run everything
npm run test:smoke       # just the crash check (fast, broad)
npm run test:functional  # just the "did it actually work" checks
```

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

## Files in this system

| File | What it is |
|---|---|
| `tests/button-smoke.spec.js` | Clicks every button, catches crashes |
| `tests/buttons-functional.spec.js` | Asserts buttons do their job |
| `package.json` → `scripts` | The `npm test` shortcuts |
| `.gitignore` | Keeps test junk (`test-results/`) out of git |
| `TESTING.md` | This cheat sheet |
