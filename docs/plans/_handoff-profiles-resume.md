# Resume handoff — Profiles feature (Phases 1–5 DONE, Phase 6 remaining)

Branch: **feature/profiles** (off main). Plan: `docs/plans/profiles-and-game-defaults.md`.
Coordinator pattern: drive subagents, parallelize disjoint files, commit at each
checkpoint, run code-review + elegance-auditor subagents after every phase and
fix their concerns before moving on.

## Status: Phases 1–5 shipped + audited + cleaned. **242 tests green, typecheck 0

build emits whatsnew.** 13 commits on feature/profiles (see `git log main..HEAD`).
NOT merged to main. NOT released.

## What exists now (trust, but verify before editing)

- **Core**: `src/core/profiles.ts` — ProfilesState/Profile/Globals/SeenGame/TabProfile/
  BindIssue + pure helpers (normalize/project/resolve/CRUD/migrate/validateBindPlan/
  inProfileConflict/updateProfile). `src/core/profile.ts` — single-profile wire format
  (configToProfile/profileToConfig, v2 display-encoded) PLUS bundle format
  (profilesToBundle/bundleFromImport, BUNDLE_VERSION=1, kind 'padmonk-bundle';
  import strips global-collision binds + throws on non-bundle). Shared helpers:
  `encodeAim`/`decodeAimFields` (profile.ts), `prettifySlug` (core/labels.ts).
- **Storage**: `src/shared/profiles-storage.ts` — durable `profiles` key (local-first/
  sync-backup/400ms debounce) + `storage.session` per-tab helpers + legacy `config`
  auto-migrate & key removal. Old `src/shared/storage.ts` RETIRED (deleted).
- **page-match.ts**: `gameRefFromPath`, `PRODUCT_ID_RE`, `gameNameFromTitle`.
- **WASD bug**: fixed (`FIXED_GROUP_TITLES` empty in controller-actions.ts).
- **Bridge/inject** (Phase 2): bridge owns per-tab resolution (whoami→tabId,
  gameRefFromPath, resolveProfileId, writeTabProfile, seen-games upsert, toast on
  nav into a game-default). `resolveAndPost` serialized via promise chain.
  Extended payload to MAIN carries profiles/activeProfileId/productId/slug/gameName/
  contextDefaultProfileId. inject threads them + onSelectProfile/onSaveAsDefault seams.
- **Overlay** (Phase 3): `src/ui/binds-overlay/ProfileSelect.svelte` (ARIA combobox
  keyboard nav), save-as-default ★ button (shows when active≠contextDefault),
  `Toast.svelte` (auto-load, mounted always), header condensed, "Controls" rename
  (overlay_title="padmonk Controls", overlay_configure="Advanced"). shadow.ts has
  mountToast + OverlayProps. SW: whoami responder + tabs.onRemoved cleanup +
  setSessionAccessLevel.
- **Options** (Phase 4): `Options.svelte` = two-page shell, hash-routed #/settings +
  #/mapping, BOTH pages kept mounted (toggle `hidden`) so drafts survive tab switch.
  `SettingsPage.svelte` (~940 lines) = STAGED saves (draftGlobals + draftProfile,
  manual dirty flags), Save Global / Save Profile each gated by validateBindPlan;
  edit-time conflict engine (global-collision → GlobalShortcutModal hard-block;
  in-profile reuse → ConflictDialog confirm). `ProfileTabs.svelte` (tabs + inline
  native-input rename + add + overflow Duplicate/Delete, canDelete prop).
  `ConflictDialog.svelte`, `GlobalShortcutModal.svelte`, `ModalBackdrop.svelte`
  (shared scrim). Profile CRUD is durable-immediate; binds/aim/globals staged.
  Import/export: single active profile + full bundle (Export all / Import profiles).
- **Mapping** (Phase 5): `MappingPage.svelte` — seenGames⋈gameDefaults table, profile
  `<select>` ((Global default) sentinel='' ), reset ↺. `src/whatsnew/` page (Rate→
  redirects.esskayesss.dev/padmonk-ext?utm_campaign=rate, Sponsor/Coffee), SW
  onInstalled gating (isMeaningful minor/major bump, once per version via
  `lastWhatsNewVersion` in storage.local). vite.config rollup input for whatsnew.

## Phase 6 — REMAINING (plan §12.6)

"Polish: resolution/migration/multi-tab/conflict tests, locale propagation,
CHANGELOG/README, manual QA on both Xbox surfaces."
Concrete tasks:

1. **Test gaps**: add integration-ish tests for multi-tab resolution + the bridge
   protocol where feasible (bridge is chrome-heavy — focus on pure pieces already
   covered; consider tests for any untested resolveProfileId/migrate edges).
2. **Locale propagation**: changing language in Global settings should propagate
   live to overlay/HUD/popup (globals.locale → onProfilesChanged → bridge re-posts).
   Verify end-to-end; the shell header still tracks SAVED locale (known, acceptable).
3. **i18n debt**: 15 non-en locales carry ENGLISH PLACEHOLDERS for all new keys
   (profiles/overlay/options/mapping/whatsnew). Also `overlay_title`/`overlay_configure`
   en-rename NOT propagated to other locales (still old translations). Decide: ship
   English placeholders now + track, or do a translation pass. Pre-existing: pt-BR.json
   & zh-CN.json missing `lang_name_en` (1 key short — predates this work).
4. **CHANGELOG.md + README.md**: document the profiles feature (use the `changelog`
   skill if desired). Bump version if releasing (zip/release derives from tag).
5. **Manual QA**: load unpacked dist on <www.xbox.com/*/play>*and play.xbox.com/stream/*
   — verify profile switch from overlay, save-as-default + toast, popup "Tuning:" line,
   mapping page, migration from a legacy `config` install, what's-new on a minor bump.
6. Final full audit pass + merge decision.

## Known low-priority items deferred (from audits, not blockers)

- toggle==help combo equality not warned (validateBindPlan).
- Shell header locale previews SAVED not DRAFT locale (partial preview).
- Bundle round-trip drops createdAt/updatedAt (re-stamped on import; no ordering dep).

## Commands

- `npm test` (vitest, 242 tests) · `npm run typecheck` · `npm run build` (emits
  dist/src/whatsnew/index.html) · `npm run i18n` after any messages/en.json edit ·
  `npm run format`. i18n.test.ts enforces 16-locale KEY parity.
