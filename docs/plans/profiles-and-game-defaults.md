# Plan — Bind Profiles, Per‑Game Defaults & Conflict‑Safe Rebinding

Status: draft v3 (review rounds 1–2 + MV3 research) · Owner: esskayesss · Multi‑phase

## 0. Decisions locked in this revision

- **Drop the legacy `config` key entirely.** Source of truth becomes the
  `profiles` store; per‑tab resolution moves to `chrome.storage.session`.
  Service‑worker, popup, and bridge refactor onto the new stores.
- **Popup is tab‑aware**, edits the _active tab's resolved profile_, and shows
  **one line naming that profile** ("Tuning: ⟨name⟩"). No other popup UI change.
- **Options Settings page uses explicit, staged saves** (Save Global / Save
  Profile) — never autosave, because Options edits propagate live to running
  game tabs. Popup stays live autosave (aim/behavior only — clamped, safe).
- **Auto‑migrate** the old single `config` into a "Default" profile on update.
- **What's‑new page on meaningful updates** with Rate + Sponsor CTAs (gated so it
  never nags on patches), to address the 250‑users / 2‑reviews gap.
- Overlay rename: see §8.3 (recommendation + default).

### Research basis (MV3, documentation‑backed)

- `chrome.storage.session` is in‑memory, **not** persisted to disk, 10 MB quota,
  `onChanged` fires across contexts; content‑script access requires
  `setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })`.
  → [storage](https://developer.chrome.com/docs/extensions/reference/api/storage),
  [StorageArea](https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea)
- Service workers are ephemeral — **never** hold per‑tab state in module‑scope
  globals; persist to storage.
  → [SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
  [migrate to SW](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers)
- Popup→active‑tab pattern: `tabs.query({active:true,currentWindow:true})` then
  read per‑tab state (storage.session) or `tabs.sendMessage`.
  → [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs),
  [messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- `onInstalled` reasons `install|update|chrome_update|shared_module_update`;
  `details.previousVersion` only on `update`; gate what's‑new by stored
  last‑shown version; reserve forced tabs for install/major.
  → [runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- Review CTA links to the **store listing page itself** (not the nested
  `/reviews` tab) via the existing `redirects.esskayesss.dev/padmonk-ext`
  redirect; in‑product review prompts allowed **only** non‑incentivized &
  non‑spammy.
  → [program policies](https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse)

## 1. Goal

Ship a profile system for padmonk:

- **Multiple named profiles**, each carrying its own binds + aim/behavior.
- **Per‑game defaults** keyed by the permanent product id; the right profile
  auto‑loads per tab with no switching/ping‑pong.
- **Switch the active profile from the overlay** via a rich custom dropselect,
  with a context‑aware **save‑as‑default** icon.
- **Two‑page Advanced Settings**: (1) Global settings + profile tabs; (2)
  Game→Profile mapping.
- **Conflict‑safe rebinding**: every bind rebindable (fixes the WASD/LStick bug);
  reassignment never silent.
- **Update awareness**: auto‑migration + a gated what's‑new page driving reviews.

No new permissions/host matches; the manifest gains only the (already‑present)
`storage` use. The MAIN‑world mapper/render path stays lean.

## 2. Xbox URL schema (researched) + name capture

Stable cross‑surface key = **Microsoft Store "Big ID" (product id)** — 12‑char
uppercase alphanumeric, ≥1 digit, no hyphen (`9NCJSXWZTP88`, `C17GQF31D617`).
Slug is localized → label only.

| Surface       | Route                              | id pos |
| ------------- | ---------------------------------- | ------ |
| Legacy detail | `/<loc>/play/games/<slug>/<id>`    | last   |
| Legacy launch | `/<loc>/play/launch/<id>/<slug>`   | first  |
| New           | `play.xbox.com/stream/<id>/<slug>` | first  |

Detection is **position‑agnostic** (scan segments, match the Big‑ID shape; slugs
are lowercase‑hyphen and can't match):

```ts
// src/content/page-match.ts (additive; isActiveGamePath unchanged)
const PRODUCT_ID_RE = /^(?=[0-9A-Z]{12}$)(?=.*[0-9])[0-9A-Z]{12}$/;
export interface GameRef {
	productId: string;
	slug: string;
}
export function gameRefFromPath(pathname: string): GameRef | null {
	/* scan + match */
}
```

**Name capture:** when a game opens, inject parses `document.title`
("Play ⟨Game⟩ | Xbox Cloud Gaming…" → "⟨Game⟩"), falling back to a prettified
slug. The name is tied to the product id in the **seen‑games registry** (§3) so
the mapping page (§7.2) shows real titles.

## 3. Data model

### 3.1 Per‑profile vs global

- **Per‑profile:** `bindings`, `sensitivity`, `smoothing`, `aimMin`, `aimCurve`,
  `invertY`, `lockPointerOnClick`.
- **Global:** `enabled`, `locale`, `toggleCombo`, `helpCombo` ("Global binds").

### 3.2 Durable store — key `profiles` (`src/core/profiles.ts` types)

```ts
export interface Profile {
	id: string;
	name: string;
	bindings: Bindings;
	sensitivity: number;
	smoothing: number;
	aimMin: number;
	aimCurve: number;
	invertY: boolean;
	lockPointerOnClick: boolean;
	createdAt: number;
	updatedAt: number;
}
export interface Globals {
	enabled: boolean;
	locale: Locale;
	toggleCombo: Combo;
	helpCombo: Combo;
}
export interface SeenGame {
	name: string;
	slug: string;
	lastSeen: number;
}
export interface ProfilesState {
	version: number; // schema marker, start 1
	profiles: Profile[]; // >= 1 always
	globalDefaultProfileId: string; // fallback when no game default
	gameDefaults: Record<string, string>; // productId -> profileId
	seenGames: Record<string, SeenGame>; // productId -> label registry
	globals: Globals;
}
```

### 3.3 Ephemeral per‑tab store — `chrome.storage.session`

The MV3‑correct home for per‑tab resolution (validated above). One entry per tab,
written by that tab's bridge, readable by the popup and service worker:

```ts
// key: `tab:${tabId}`  (cleaned up on chrome.tabs.onRemoved)
interface TabProfile {
	productId: string | null;
	slug: string | null;
	profileId: string;
}
```

`sessionOverride` is implicit: on fresh load the bridge writes the resolved
default; on an overlay switch it overwrites with the chosen profile. Because
`storage.session` is in‑memory and cleared on reload/restart, "override sticky
until reload" falls out naturally. The service worker calls
`storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })`
once on startup/install so content scripts can write it.

### 3.4 Pure helpers (unit‑tested, no `chrome.*`)

```ts
normalizeProfilesState(raw): ProfilesState
projectProfileConfig(state, profileId): Config        // globals + profile -> Config (for the mapper)
resolveProfileId(state, productId|null, sessionOverride|null): string  // §5
create/add/rename/duplicate/deleteProfile(...)
setGlobalDefault / setGameDefault / clearGameDefault / upsertSeenGame(...)
migrateLegacyConfig(rawConfig): ProfilesState         // flat Config -> globals + one "Default"
validateBindPlan(state, draftGlobals, draftProfile): BindIssue[]   // §6
```

Invariants: ≥1 profile; `globalDefaultProfileId` + all `gameDefaults` reference
existing profiles (prune dangling); names trimmed/non‑empty/de‑duped/single‑line/
bounded; numerics clamped via `AIM_LIMITS`; bindings via `normalizeBindings`.
`deleteProfile` guards last‑profile and reassigns dangling defaults.

## 4. Storage layer (`src/shared/profiles-storage.ts`) — replaces the `config` API

`storage.ts` today owns the single `config` key with a local‑first / sync‑backup /
migrate‑on‑read discipline and a 400 ms sync debounce. We **retire** `readConfig`/
`writeConfig`/`onConfigChanged` and replace them, reusing the same primitives
(area get/set, debounce, lastError guards, first‑run locale seeding):

- **`readProfilesState()`** — durable read with migration:
  1. `profiles` (local → sync fallback, migrate to local) → normalize.
  2. else legacy `config` (local → sync) → `migrateLegacyConfig` → persist
     `profiles`, then **remove the legacy `config` key** from both areas.
  3. else first run → one Default profile from `DEFAULT_CONFIG`
     (+ `detectUiLocale` seeding, as today).
- **Mutators** write `profiles` (local immediate, sync debounced). No projection
  key to maintain — in‑game tabs get their config from their own bridge (§5).
- **`onProfilesChanged(cb)`** over `storage.onChanged['profiles']`.
- **Per‑tab session helpers**: `readTabProfile(tabId)`, `writeTabProfile(tabId,…)`,
  `clearTabProfile(tabId)`, `setSessionAccessLevel()`.

Consumers refactor:

- **Service worker** reads `globals.enabled` from `readProfilesState()` for the
  icon and listens to `onChanged['profiles']` (was `changes.config`).
- **Popup** (§9) reads the active tab's profile via `storage.session` + the
  `profiles` store, and writes the chosen profile.
- **Bridge** reads `profiles`, resolves per tab, writes `storage.session`, posts
  the resolved config to MAIN.

## 5. Multi‑tab: lazy per‑tab injection (confirmed) — now via `storage.session`

Your model, validated and made concrete: **all profiles + defaults live in the
durable `profiles` store; each tab's active profile + resolved binds live in
`chrome.storage.session` keyed by tabId.** No tab writes shared "active" state
during play → nothing to ping‑pong.

- **Broadcast bus = `chrome.storage.onChanged`** (documented to fire in every
  content script, the popup, and the service worker). When Options saves globals
  or a profile, every tab's bridge wakes, re‑resolves, re‑posts. No custom bus.
- Per‑tab precedence in `resolveProfileId`: session override (this tab's overlay
  pick) → `gameDefaults[productId]` → `globalDefaultProfileId` → `profiles[0]`.
- Overlay switch = session‑local (writes only `storage.session['tab:'+id]`) →
  zero cross‑tab effect. The save‑as‑default icon is the only overlay action that
  writes durable state (`gameDefaults` or `globalDefaultProfileId`).
- The **extension now owns an accessible tab→profile map** exactly as you
  intuited — it's `storage.session`, written by the bridge whenever it resolves
  or the user switches, and the popup reads it directly. (We don't need a
  separate game‑id→tab map: `tabs.query({active:true})` + the session entry gives
  the foreground tab's profile directly.)

## 6. Conflict‑safe rebinding (fixes the WASD/LStick bug)

### 6.1 Make every bind rebindable

Empty `FIXED_GROUP_TITLES` (drop `leftStick`) in `controller-actions.ts`. Root
cause confirmed: LStick was the only fixed action group, so once WASD was stolen
by another group it couldn't be re‑added. Right‑stick stays an **info** group
(mouse‑driven, no bindable action). `allBindsConfigured` already flags any action
left without an input.

### 6.2 The conflict engine (no silent reassignment)

An **input id maps to exactly one action** (reuse = conflict; the same action
reachable from several inputs is fine). Assigning `inputId` → new action:

1. **In‑profile reuse** — `inputId` already bound to a _different_ action in the
   same profile → **confirmation dialog** ("⟨Key⟩ is bound to ⟨current⟩. Unbind
   and use for ⟨new⟩?"). Confirm reassigns; cancel aborts.
2. **Global‑shortcut collision** — `inputId` (keyboard code) equals a global
   combo's `code` (`toggleCombo`/`helpCombo`). Conservative rule: collide iff
   `inputId === combo.code` (ignore modifiers — prevents the press‑fires‑both
   double‑trigger). Mouse/Wheel inputs can't be combos. → **hard‑block modal**
   ("⟨Key⟩ is a Global shortcut. Free it in Global settings first."). No proceed.

`validateBindPlan(state, draftGlobals, draftProfile)` returns typed `BindIssue[]`
(`kind: 'in-profile' | 'global-collision' | 'unmapped'`). It is the **single
validator behind both save buttons** (§7.1): Save Global validates draftGlobals
against every profile; Save Profile validates that draft against current globals.

## 7. Advanced Settings — two pages, staged saves

One `options_ui` HTML entry; in‑page top‑level tabs ("Settings" / "Game mapping")
with hash routing (`#/settings`, `#/mapping`) — no manifest change.

### 7.1 Page 1 — Settings (explicit, staged)

```
┌ GLOBAL SETTINGS ───────────────────────────────────────────┐
│ Master enable · Language · Toggle shortcut · Help shortcut  │
│                                          [ Save Global ]    │
└─────────────────────────────────────────────────────────────┘
┌ PROFILES (horizontally scrollable tabs) ───────────────────┐
│ [ FPS ] [ Racing ] [ Default + ]   ← click activates       │
│ ── active tab ─────────────────────────────────────────── │
│  Binds grid (all rebindable, conflict‑checked)             │
│  Aim & behavior (sensitivity/smoothing/deadzone/curve,     │
│                  invert‑Y, lock‑pointer)                    │
│                                          [ Save Profile ]   │
└─────────────────────────────────────────────────────────────┘
```

- **Why staged, not autosave (your Q2, settled):** Options edits broadcast live
  to running game tabs via `onChanged`. Autosaving a half‑finished rebind would
  disrupt someone's active game mid‑edit, and the conflict engine needs a draft
  to validate _before_ commit. So Page 1 stages edits and commits on an explicit
  **Save Global** / **Save Profile**, each gated by `validateBindPlan`. A mode
  that flips autosave→explicit only when faulty is more surprising than a
  consistent explicit save, and doesn't fix the live‑propagation hazard.
  Unbound actions surface a non‑blocking warning (save allowed — users may
  intentionally leave a bind empty; the overlay already shows "unmapped").
  Navigating away while dirty prompts.
- **Profile tab rename (your Q5 → Option B):** the tab header looks editable, but
  a click swaps the label for a real `<input>` styled to match the tab; commit on
  Enter/blur, Escape reverts. Native input = free selection/paste‑as‑text/IME and
  trivial validation (non‑empty, de‑dupe, trim, bounded), without `contenteditable`
  footguns. The trailing **`+`** adds a profile (blank or duplicate‑current).
- Delete lives in the tab overflow (guarded; reassigns dangling defaults).
- Live tuning of aim does **not** live here — that's the popup's job (§9), where
  the user is watching the game.

### 7.2 Page 2 — Game → Profile mapping

Table from `seenGames` ⋈ `gameDefaults`:

```
Game                Profile (dropdown)        Reset
Starfield           [ FPS ▾ ]                 ↺
Forza Horizon 5     [ Racing ▾ ]              ↺
Halo Infinite       [ (Global default) ▾ ]    ↺
```

Dropdown sets `gameDefaults[productId]`; **reset icon** removes the mapping
(reverts to global default). Rows are games actually played (registry via
`current-game`), shown by captured name. Empty state: "Play a game to see it
here."

## 8. Overlay — switch + save‑as‑default

### 8.1 Current header (answer to "what's there?")

Right side today: two **info legend chips** (Toggle = F8, Close = F9) + one
**button** ("Configure keybinds ↗"). The two chips are pure info.

### 8.2 New header

```
… title/online …      [ ⮟ ⟨name⟩: FPS ]  [ 💾 ]   F8 toggle · F9 close   [ Advanced ↗ ]
                        custom dropselect  save     compact hint
```

- **Custom dropselect** (not native `<select>`): pad‑token styled, lists all
  profiles, active highlighted, keyboard‑navigable (`role=listbox`), floating
  panel inside the shadow root. Pick → bridge `set-active-profile` (session‑local).
- **Save‑as‑default icon** shows only when the active profile ≠ the context's
  current default. Context = the current game (sets `gameDefaults[productId]`) or,
  off a game, the global default (`globalDefaultProfileId`). Tooltip names the
  context; hides after saving. Only overlay action that writes durable state.
- **Auto‑load toast**: on navigation into a game whose default differs, flash
  "Loaded ⟨profile⟩ for ⟨game⟩" (~2 s, MAIN‑world only).
- Condense the two legend chips into one compact "F8 toggle · F9 close" hint to
  make room. Keep **Advanced ↗** (opens Options). Create/rename/delete stay in
  Options.

### 8.3 Rename (your Q3) — suggestion + default

Keep "bind/binding" as the _unit_ term; rename the _overlay/feature_ to something
friendlier than "keybinds". Recommendation, in order:

1. **"Controls"** (default) — universally clear for a 250‑user base; "Toggle
   controls (F8)", "Your controls", pairs cleanly with profiles.
2. **"Loadout"** — gamer flavor that synergizes with profiles ("switch loadout"),
   but semantically loose (loadout ≈ gear). Good if you want personality.
3. **"Layout"** — literally a control layout; neutral, accurate.

I'll thread **"Controls"** unless you pick another, and keep message **keys**
stable (change values only) so the rename is a copy change, not a key migration.

## 9. Popup — tab‑aware, one‑line profile label (your Q1)

Keep the popup's "perfectly balanced" layout; add exactly **one line** naming the
profile being tuned. Mechanics:

- On open: `tabs.query({active:true,currentWindow:true})` → `readTabProfile(tabId)`
  from `storage.session`. If present, tune that profile; else fall back to the
  **global default profile**.
- Header gets one line: **"Tuning: ⟨profile name⟩"** (or "Tuning: ⟨Default⟩
  (global)" on fallback).
- The popup edits `enabled` (→ `globals`) and `invertY`/`lockPointerOnClick`/aim
  (→ the resolved profile), then writes `profiles`. The change broadcasts; the
  active game tab re‑injects so the user _feels_ the aim change live. Popup stays
  **autosave** (these fields are clamped — never faulty — so no Save button or
  conflict surface is needed).
- Live‑refresh: subscribe to `onProfilesChanged` + `storage.session` changes so
  the label/values track external edits, as the popup does today.

## 10. Updates — migration + what's‑new + reviews

### 10.1 Auto‑migration

`readProfilesState()` migrates a legacy single `config` into one **"Default"**
profile (globals split out), sets it as the global default, persists `profiles`,
and removes the old `config` key (§4). Pure `migrateLegacyConfig` tested against
the existing `normalizeConfig` fixtures — no binding/aim loss.

### 10.2 What's‑new page (gated)

New bundled page `src/whatsnew/` (extension page like options/popup; added to the
Vite multi‑page input). In the service worker:

```ts
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason === 'install') { /* seed lastWhatsNewVersion = current */ }
  if (reason === 'update' && isMeaningful(previousVersion, current)
      && current !== lastShown) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('whatsnew.html') });
    await store lastWhatsNewVersion = current;  // never re‑show for this version
  }
});
```

Gating: only on a minor/major bump (not patches), and only once per version
(stored `lastWhatsNewVersion`). Docs/policy: forced tabs are fine for
install/major, spammy on every patch — so we gate hard.

### 10.3 Reviews + sponsor (the 2‑reviews problem)

The what's‑new page carries prominent, **non‑incentivized** CTAs:

- **Rate padmonk ★** → the existing store‑listing redirect
  `https://redirects.esskayesss.dev/padmonk-ext` (the same link the README/landing
  page use to install) with a review‑specific UTM, e.g.
  `?utm_source=padmonk-ext&utm_medium=whatsnew&utm_campaign=rate`. Links to the
  **listing page itself**, not the nested `/reviews` tab — users review from
  there. Policy‑safe: honest, user‑initiated, no incentive.
- **Sponsor ❤ / Coffee ☕** → existing redirect URLs.
- Copy: "Enjoying padmonk? An honest review helps a ton." Keep it one tasteful
  block; no nagging, no popup nag (popup stays clean per your call).

## 11. Files

**New:** `src/core/profiles.ts`, `src/shared/profiles-storage.ts`,
`src/ui/binds-overlay/ProfileSelect.svelte`, `src/options/SettingsPage.svelte`,
`src/options/MappingPage.svelte`, `src/options/ProfileTabs.svelte`, conflict
dialog/modal components, `src/whatsnew/` (page + entry), tests
(`profiles.test.ts`, `profiles-storage.test.ts`, `game-id.test.ts`,
`conflict.test.ts`, `migrate.test.ts`).

**Modified:** `page-match.ts`, `bridge.ts`, `inject.ts`, `BindsOverlay.svelte`,
`shadow.ts`, `Options.svelte`, `Popup.svelte` (tab‑aware + label),
`controller-actions.ts` (empty `FIXED_GROUP_TITLES`), `storage.ts` →
`profiles-storage.ts` (retire config API), `service-worker.ts` (enabled from
globals, `setAccessLevel`, onInstalled what's‑new), `core/profile.ts` (export/
import bundles, back‑compat), `vite`/build config (what's‑new entry),
`messages/en.json` (+15 locales), `CHANGELOG.md`, `README.md`.

**Unchanged:** `manifest.config.ts` (no perms/hosts), mapper/gamepad core, HUD.

## 12. Phasing

1. **Core + storage:** `profiles.ts`, `gameRefFromPath`, `profiles-storage.ts`
   (durable + session helpers + `setAccessLevel`), `migrateLegacyConfig` (+ remove
   legacy key), `validateBindPlan`, empty `FIXED_GROUP_TITLES`. Refactor SW +
   popup + bridge off `config`. Fully tested. LStick becomes rebindable; popup
   becomes tab‑aware. _(Parallelizable: core+tests in one worktree, SW/popup/
   bridge reroute in another.)_
2. **Bridge + inject:** protocol, per‑tab resolution → `storage.session`,
   `current-game`/seen‑games, resolved‑config posting, toast hook.
3. **Overlay UX:** `ProfileSelect` + save‑as‑default + toast + header condense +
   rename copy + i18n.
4. **Options Page 1:** two‑page shell, Global section, profile tabs (click‑to‑edit
   rename), staged saves + conflict dialog/modal + i18n.
5. **Options Page 2 + updates:** mapping table + reset; what's‑new page + review/
   sponsor CTAs; onInstalled gating; import/export bundles.
6. **Polish:** resolution/migration/multi‑tab/conflict tests, locale propagation,
   CHANGELOG/README, manual QA on both Xbox surfaces.

## 13. Risks & mitigations

- **Multi‑tab thrash** → per‑tab `storage.session` resolution; only definitions/
  defaults shared; `onChanged` broadcast.
- **SW ephemerality** → no module‑scope per‑tab Map; per‑tab state in
  `storage.session`, enabled/icon recomputed from storage on events (docs‑aligned).
- **Migration loss** → pure, tested `migrateLegacyConfig`; legacy key removed only
  after successful persist.
- **`storage.session` content‑script access** → `setAccessLevel` on SW startup +
  install; guard reads when absent (vitest/MAIN world).
- **Conflict UX gaps** → one validator feeds both save buttons + overlay.
- **What's‑new annoyance / store policy** → gate by version bump + once‑per‑
  version; CTAs non‑incentivized.
- **Big‑ID false positives** → strict regex; lowercase‑hyphen slugs can't match.

## 14. Acceptance criteria

- Two+ profiles; switch from the overlay dropselect → that tab's binds/aim change
  live; other tabs unaffected (no ping‑pong).
- In a game, save‑as‑default links the active profile to that product id;
  reopening auto‑loads it with a toast. Off a game, it sets the global default.
- Popup shows "Tuning: ⟨active‑tab profile⟩" and its aim edits land on that
  profile, felt live in the game tab.
- Page 2 lists played games by real name; dropdown reassigns; reset reverts.
- Rebind WASD→DPad then back to LStick works; in‑profile reuse prompts; global‑
  shortcut key is blocked with guidance; both save buttons enforce one validator.
- Legacy single‑config installs migrate to one "Default" profile, no loss; legacy
  `config` key removed afterwards.
- A meaningful update opens the what's‑new page once, with working Rate/Sponsor
  CTAs; a patch update does not.
- All existing + new tests pass.

---

### Note on subagents

Planning stayed single‑threaded (full context already held; the deliverable is one
judgment‑heavy doc). Implementation parallelizes well — Phase 1 splits into a
core+tests worktree and a SW/popup/bridge‑reroute worktree; later UI phases can
draft components in parallel once the Phase‑1/2 contracts (types, bridge protocol)
are frozen.
