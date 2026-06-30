# Changelog

All notable changes to padmonk are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Full rewrite of the runtime from a flat, framework-free, no-build extension into
a bundled, modular, type-safe codebase. No behavioral regressions intended — the
gamepad layout, default bindings, mapping math, and storage protocol are
preserved (with the diagonal-speed fix below as the one intentional divergence).

### Added

- 64 Vitest unit tests covering the pure `src/core/` modules (config, combos,
  labels, registry, mapper, gamepad state/api, storage).
- GitHub Actions CI: format-check → typecheck → test → build, uploading the
  built `dist/` as an artifact.
- File import/export of profiles (download/upload `.json`) in the options page,
  alongside the existing copy/paste textarea.
- Remap conflict warning: binding an input already assigned elsewhere surfaces a
  non-blocking notice instead of silently reassigning.
- Configurable toggle and show-binds combos (defaults `F8` / `F9`) replacing the
  former hardcoded keys.
- Shadow-DOM HUD and binds overlay so injected UI styles are isolated from the
  host page (and dodge page CSP for inline styles).
- Self-hosted, bundled UI font path (`fontUrl` wired bridge → MAIN world) with a
  graceful fallback stack.
- Multiple named control profiles: each profile carries its own bindings plus
  sensitivity, smoothing, aim min/curve, invert-Y, and lock-pointer settings.
- Per-game default profiles: padmonk auto-loads the right profile for each game,
  keyed by MS Store product id.
- In-overlay profile switcher with a "save as default for this game" action and
  an auto-load toast when a game's default profile is applied.
- Game → profile mapping table in the options page, with reset to the global
  default per game.
- Two-page Advanced Settings (Settings + Mapping) with staged saves (binds, aim,
  and globals are drafted and saved explicitly).
- Conflict-safe rebinding: every control is rebindable (including the left stick /
  WASD); reusing an input already bound in the same profile asks to confirm, and a
  collision with a global shortcut is hard-blocked.
- Multi-profile import/export bundles (export all / import all) alongside the
  existing single-profile export.
- What's-new page shown on meaningful (minor/major) version updates.

### Changed

- Full migration to TypeScript (strict) + Vite with `@crxjs/vite-plugin`, Svelte 5
  for all UI, and Tailwind v4 with a shared theme palette (no inline hex).
- Modular architecture: pure `src/core/`, isolated/MAIN-world `src/content/`,
  Svelte `src/ui/` (popup, options, HUD, overlay).
- Registry-driven configuration: a single control registry
  (`src/core/controller-actions.ts`) is the source of truth for default
  bindings, the options page sections, the binds overlay, and the README table.
- Install from source now requires a build step; load the `dist/` build output
  as an unpacked extension rather than the repo root.
- Packaging moved from `scripts/pack.sh` to `npm run zip` (builds, then zips the
  `dist/` output to `padmonk-<version>.zip`).
- Storage source-of-truth moved from the flat `config` key to a `profiles` store;
  an existing `config` install auto-migrates into a "Default" profile on first
  read, after which the legacy `config` key is removed.
- Per-tab profile resolution via `chrome.storage.session`, so each tab resolves
  its profile independently.
- Popup is now tab-aware.
- Overlay renamed to "padmonk Controls"; the old "Configure" entry is now
  "Advanced".

### Fixed

- Diagonal left-stick overspeed: per-axis clamping let diagonals reach magnitude
  ~1.41 (~41% faster than cardinal movement). Replaced with a radial clamp so the
  stick vector magnitude is capped at 1.
- `prettyInput` drift: the MAIN-world side lacked `Mouse3`/`Mouse4` labels that
  the options page had; unified into a single `labels.ts`.
- Removed the dead/unreachable toggle-capture branch (`commitCapture`); toggle and
  show-binds are captured only as combos.
- Stopped hotlinking the Xbox CDN font; the UI font is now bundled/self-hosted and
  delivered through the bridge.
- Reduced per-frame allocation in the gamepad snapshot path by reusing cached
  buffers instead of allocating a new `Gamepad`, button wrappers, and axes array on
  every `getGamepads()` call.
- Left-stick directions (WASD) are now rebindable; they were previously locked by
  a fixed-group guard.

## [1.0.0]

- Initial release: virtual Xbox controller for Xbox Cloud Gaming via the Gamepad
  API, WASD → left stick, mouse → right stick aim, remapping, sensitivity /
  smoothing / aim-curve tuning, and local-only settings.
