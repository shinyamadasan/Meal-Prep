# Meal Prep Planner — Project

> North star. What this is and why. Read on first/onboarding sessions. Changes rarely.

## What it is
A **Kitchen Operating System** for home meal-preppers: a single-page web app that manages the
full pantry lifecycle — **buy → cook → store → use → restock** — not just a recipe box.

## Who it's for
Filipino home cooks who batch-cook and meal-prep. Content is localized: peso pricing, wet-market
("palengke") store references, Filipino recipe and ingredient names.

## Core value loop
1. Browse/manage recipes (with nutrition, cost, photos, serving scaling).
2. Plan a 7-day week (breakfast / lunch / dinner / snacks).
3. Auto-generate a categorized, priced grocery list from the plan.
4. Mark recipes cooked → ingredients deducted from pantry, batch tracked with expiry.
5. Dashboard surfaces what to cook now, what's expiring, and what to restock.

## What makes it different
- **Offline-first** — fully usable with no account and no internet.
- **"What can I cook right now?"** engine — matches pantry inventory to recipes in 3 tiers.
- **Filipino-first from the database up** — not generic Western assumptions.
- **Zero-friction start** — Kitchen Setup Wizard + ~26 sample recipes = working plan in under a minute, no account.

## Non-goals (deliberately not building)
- No framework / no build step (see [DECISIONS.md](DECISIONS.md) D-001).
- No manual dark-mode toggle (see ROADMAP "Do Not Work On").
- No community feed / family sharing as live features (orphaned; see [FEATURES.md](FEATURES.md)).
- No native mobile app — it's a PWA.

## Stack & deploy
Plain HTML/CSS/JS SPA · Firebase Auth + Firestore · Chart.js · Lucide icons · Web Speech API.
Hosted on **GitHub Pages**, auto-deploys from `main`. Live: https://shinyamadasan.github.io/Meal-Prep/
