# Handoff — Profiles feature (resume point)

**Read first:** `docs/plans/profiles-and-game-defaults.md` (v3) — the full plan.
This file is the resume cheat-sheet so a fresh/compacted session doesn't
re-research. Status: **plan approved, no code written yet. Awaiting go for Phase 1.**

## State

- User approved the v3 plan. We are in **plan mode** — do not write feature code
  until the user says go.
- One open confirmation: overlay rename = **"Controls"** (default) unless user
  picks "Loadout"/"Layout". Keep message **keys** stable; change values only.

## Locked decisions (don't re-litigate)

1. Drop the legacy `config` storage key entirely. Source of truth = new `profiles`
   key. Per-tab resolution = `chrome.storage.session` (key `tab:${tabId}`).
2. Per-profile: `bindings, sensitivity, smoothing, aimMin, aimCurve, invertY,
lockPointerOnClick`. Global: `enabled, locale, toggleCombo, helpCombo`.
3. Game key = Microsoft Store **Big ID** (`/^(?=[0-9A-Z]{12}$)(?=.*[0-9])[0-9A-Z]{12}$/`),
   extracted position-agnostically. Slug = label. Capture game **name** from
   `document.title` → `seenGames` registry.
4. Multi-tab: each tab's bridge resolves `sessionOverride → gameDefaults[productId]
→ globalDefaultProfileId → profiles[0]`, writes `storage.session`, posts
   resolved config to MAIN. `storage.onChanged` is the cross-tab broadcast. Overlay
   switch = session-local (no durable write).
5. WASD bug fix: empty `FIXED_GROUP_TITLES` in `controller-actions.ts`.
6. Conflict engine `validateBindPlan`: in-profile reuse → confirm dialog;
   global-combo collision (`inputId === combo.code`) → hard-block modal; unbound →
   warning. Single validator behind both save buttons.
7. Options = two in-page tabs (`#/settings`, `#/mapping`), **staged saves** (Save
   Global / Save Profile), never autosave (Options propagates live to game tabs).
   Profile rename = click-to-edit styled native `<input>` (NOT contenteditable).
8. Popup = tab-aware via `storage.session` + one line "Tuning: ⟨profile⟩"; stays
   live autosave (aim/invert/lock only).
9. Auto-migrate old `config` → one "Default" profile, then remove legacy key.
10. What's-new page `src/whatsnew/` opened by `onInstalled` only on minor/major
    bump, once per version (stored `lastWhatsNewVersion`). Rate CTA →
    `https://redirects.esskayesss.dev/padmonk-ext?utm_source=padmonk-ext&utm_medium=whatsnew&utm_campaign=rate`
    (store **listing** page, not /reviews). Sponsor/Coffee = existing redirects.

## Verified codebase facts (already researched — trust these)

- **Storage:** `src/shared/storage.ts` — `readConfig`/`writeConfig`/`onConfigChanged`,
  key `'config'`, local-first + sync-backup (400ms debounce), `rawGet`/`rawSet`,
  `detectUiLocale()`, all reads via `normalizeConfig`. We retire this API into
  `src/shared/profiles-storage.ts`, reusing the primitives.
- **Service worker:** `src/background/service-worker.ts` — sets toolbar icon from
  `config.enabled`; listens `chrome.storage.onChanged` for `changes.config`;
  handles `onInstalled`/`onStartup`; relays `__padmonk:'open-options'`. Refactor:
  read `globals.enabled`; call `storage.session.setAccessLevel({accessLevel:
'TRUSTED_AND_UNTRUSTED_CONTEXTS'})` on startup+install; add what's-new gating.
- **Popup:** `src/popup/Popup.svelte` — edits `enabled`(global) +
  `invertY`/`lockPointerOnClick`/aim(per-profile) via readConfig/writeConfig; uses
  `AIM_CONTROLS`, `comboLabel`, `m`/`translate`. "Command deck" motif.
- **Registry:** `src/core/controller-actions.ts` — `CONTROLLER_ACTIONS`,
  `GROUP_TITLES`, `FIXED_GROUP_TITLES = new Set([GROUP_TITLES.leftStick])` ← THE BUG.
  `INFO_GROUPS` = rightStick (mouse-driven, no items). `buildDefaultBindings()`,
  `groupsForOptions(locale)`, `allBindsConfigured()`, `actionKey()`, `actionEq()`.
  One inputId → one action.
- **Combos:** `src/core/combos.ts` — `Combo {code,ctrl,alt,shift,meta}`,
  `comboFromEvent/comboLabel/comboMatches`. Keyboard-only.
- **Existing `src/core/profile.ts`** = export/import WIRE FORMAT (display vs raw aim,
  version marker). NOT user profiles. New module is `profiles.ts` (plural) — do not
  conflate. Options downloads `'padmonk-profile.json'` (Options.svelte:236).
- **Page match:** `src/content/page-match.ts` has `isActiveGamePath()` (keep);
  add `gameRefFromPath()`. Tests in `tests/page-match.test.ts`.
- **Aim:** `src/core/aim-settings.ts` — `AIM_CONTROLS`, `AimSettingKey =
'sensitivity'|'smoothing'|'aimMin'|'aimCurve'`, `aimConfigValue`,
  `aimDisplayValue/Fill`. Numeric clamps via `AIM_LIMITS`.
- **Architecture:** ISOLATED `src/content/bridge.ts` = only chrome.\* access; posts
  config + asset URLs via postMessage to MAIN `src/content/inject.ts` coordinator
  (1s URL poll already exists). Overlay `src/ui/binds-overlay/BindsOverlay.svelte`
  is read-only display today; `src/ui/shadow.ts` has `OverlayProps`. Editing happens
  in `src/options/Options.svelte`.
- **i18n:** author `messages/en.json` (source) → Paraglide compile; 16 locales total;
  `npm run i18n` + `gen:locales`/`gen-locales.mjs` regenerate `_locales` + manifest
  strings. Overlay title key = `overlay_title`, options title = `opt_title`. Use
  `m.key({}, {locale})` or `t(key, locale)`.
- **Manifest:** `manifest.config.ts` — only `storage` permission; covers both Xbox
  surfaces + testers. NO new perms/hosts needed. Build = Vite multi-page (add
  whatsnew entry).
- **Build/release:** `scripts/zip.mjs` → `padmonk-<version>.zip`; GH release workflow
  derives `PADMONK_VERSION` from tag.

## Phase 1 task list (start here on go)

1. `src/core/profiles.ts` — types (`Profile`, `Globals`, `SeenGame`,
   `ProfilesState`, `TabProfile`, `BindIssue`) + pure helpers:
   `normalizeProfilesState`, `projectProfileConfig`, `resolveProfileId`,
   `create/add/rename/duplicate/deleteProfile`, `setGlobalDefault/setGameDefault/
clearGameDefault/upsertSeenGame`, `migrateLegacyConfig`, `validateBindPlan`.
2. `gameRefFromPath` + `PRODUCT_ID_RE` in `page-match.ts`.
3. `src/shared/profiles-storage.ts` — durable read/migrate/write/subscribe +
   session helpers (`readTabProfile/writeTabProfile/clearTabProfile/
setSessionAccessLevel`). Retire `config` API; remove legacy key post-migrate.
4. Empty `FIXED_GROUP_TITLES`.
5. Refactor `service-worker.ts` + `Popup.svelte` + `bridge.ts` off `config`.
6. Tests: `tests/profiles.test.ts`, `profiles-storage.test.ts`, `game-id.test.ts`,
   `conflict.test.ts`, `migrate.test.ts`. Run existing suite — must stay green.

Phase 1 is parallelizable: core+tests in one worktree, SW/popup/bridge reroute in
another (freeze the `profiles.ts` type/contract first).

## Commands

- Tests: check `package.json` scripts (likely `npm test` / vitest).
- Typecheck + format before declaring done. i18n regen after message edits.
