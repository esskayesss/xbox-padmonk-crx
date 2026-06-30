# Resume handoff — Profiles feature (Phases 1–5 DONE, Phase 6 remaining)

Branch: **feature/profiles** (off main). Plan: `docs/plans/profiles-and-game-defaults.md`.
Coordinator pattern: drive subagents, parallelize disjoint files, commit at each
checkpoint, run code-review + elegance-auditor subagents after every phase and
fix their concerns before moving on.

## Status: Phases 1–5 shipped + audited + cleaned. \*\*242 tests green, typecheck 0

build emits whatsnew.\*\* 13 commits on feature/profiles (see `git log main..HEAD`).
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

## Phase 6 — STATUS

Mostly DONE. Remaining = the user's hands-on QA + version bump + push (user-owned).

1. **Test gaps** — ASSESSED, no action. Existing coverage already thorough:
   resolveProfileId precedence, migrate (structure/no-loss/defensive), conflict
   (global-collision/unmapped/inProfileConflict), storage round-trips + session
   tab-key parsing all covered. Multi-tab isolation is covered at the storage layer;
   the bridge orchestration is chrome-heavy → left to manual QA. Did NOT manufacture
   low-value tests.
2. **Locale propagation** — VERIFIED working live (not a bug). Flow: SettingsPage
   saves globals.locale → `onProfilesChanged` (bridge.ts:389) → `scheduleResolve` →
   `resolveAndPost` → `projectProfileConfig` carries locale → posts config → inject.ts
   msg handler sets `config` + `refreshUi()` → overlay/HUD/toast `.update()` with new
   locale (props reactive). Popup reads fresh per open. Shell header previews SAVED
   locale (known, acceptable).
3. **i18n** — DONE. All 53 feature keys (51 added + overlay_title/overlay_configure
   renames) translated into ALL 15 non-en locales (commit f10cd13). Placeholder
   integrity + brand-literal "padmonk" verified across 15×53. No pre-existing
   pt-BR/zh-CN gap after all — parity 0 everywhere. `npm run i18n` + i18n.test green.
4. **CHANGELOG + README** — DONE (commit, under [Unreleased], no version bump).
   Profiles/per-game-defaults/conflict-safe rebinding documented.
5. **Manual QA** — USER-OWNED (needs real Xbox auth + a game). See checklist below.
6. **Merge/push** — USER-OWNED. Decision: stay on feature/profiles, do NOT merge to
   main, do NOT push to remote. User will push after local testing. Version still
   1.0.0 under [Unreleased]; bump + tag at release time.

## Manual QA checklist (user, load unpacked `dist/` after `npm run build`)

Surfaces: `https://www.xbox.com/*/play*`, `https://play.xbox.com/stream/*`.

- [ ] Migration: an existing install with a legacy `config` key opens to a "Default"
      profile; legacy key removed; no settings lost.
- [ ] Overlay (toggle F8) renamed "padmonk Controls"; profile switcher present;
      switching profile applies live; "Advanced" opens options.
- [ ] Save-as-default ★ (shows when active≠context default) → toast on next load of
      that game; auto-load toast "Loaded {profile} for {game}" on navigating into a
      game with a default.
- [ ] Popup is tab-aware; shows "Tuning: {profile}".
- [ ] Options: two tabs (Settings / Game mapping); staged saves (dirty markers,
      Save Global / Save Profile); switching tabs preserves an unsaved draft.
- [ ] Rebinding: every control incl. WASD/left-stick rebindable; in-profile reuse →
      confirm dialog; binding a global-shortcut key → hard-block modal.
- [ ] Mapping page lists played games; profile select + reset to global default work.
- [ ] Import/export: single profile AND full bundle (Export all / Import profiles);
      importing a bundle with a global-collision strips that bind.
- [ ] What's-new tab opens on a minor/major version bump (not patch), once per version.
- [ ] Locale switch in Global settings re-localizes the in-game overlay/HUD live.
- [ ] Multi-tab: two game tabs resolve/switch profiles independently.

## Deferred refactors (whole-feature audit, post-QA — pure maintainability, no behavior change)

Surfaced by the birdseye review; intentionally NOT done pre-QA to avoid risk on
untested chrome-wiring. Safe follow-ups:

- **Type the `__padmonk` message protocol** — ~9 bare string-literal kinds matched
  independently in bridge/inject/SW/popup; extract `src/content/messages.ts` with a
  discriminated union + kind constants. Highest silent-drift risk.
- **Per-profile field octet helper** — `{bindings,sensitivity,smoothing,aimMin,
  aimCurve,invertY,lockPointerOnClick}` is hand-enumerated ~11× (normalizeProfileFields,
  defaultProfile, createProfile, updateProfile, projectProfileConfig, migrateLegacyConfig,
  BundleProfile, profilesToBundle, draftToConfig, applyConfigToDraft, saveProfile).
  Add a `PROFILE_FIELDS` tuple + `pickProfileFields` + a shared `configInputFrom`
  projector (collapses draftToConfig/applyConfigToDraft into projectProfileConfig).
- **Extract `ImportExportPanel.svelte`** from SettingsPage (~940 lines) — the single+
  bundle import/export slab is cohesive and independent of the staged-save engine.
- **Unify Profile construction** — defaultProfile ≈ createProfile('Default');
  migrateLegacyConfig inlines a full build instead of reusing createProfile.

## Known low-priority items deferred (from audits, not blockers)

- toggle==help combo equality not warned (validateBindPlan).
- Shell header locale previews SAVED not DRAFT locale (partial preview).
- Bundle round-trip drops createdAt/updatedAt (re-stamped on import; no ordering dep).

## Commands

- `npm test` (vitest, 242 tests) · `npm run typecheck` · `npm run build` (emits
  dist/src/whatsnew/index.html) · `npm run i18n` after any messages/en.json edit ·
  `npm run format`. i18n.test.ts enforces 16-locale KEY parity.
