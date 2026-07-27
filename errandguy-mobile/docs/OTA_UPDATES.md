# In-App OTA Updates (EAS Update)

ErrandGuy ships JavaScript + asset updates over the air with **EAS Update** via
`expo-updates`. Users get fixes and tweaks **inside the app** — no App Store /
Play Store review — with an optional **forced** update for critical fixes.

- EAS project: `1684a4bc-4b59-47f4-a87e-3b3262438098`
- Update URL (in `app.config.js`): `https://u.expo.dev/1684a4bc-4b59-47f4-a87e-3b3262438098`
- Runtime version policy: `appVersion` (an update only lands on builds whose
  native version matches the update's).

---

## What OTA can and cannot ship

**Can (over the air):** JS/TS code, React components, styles, images and other
JS-bundled assets, most config that lives in JS.

**Cannot (needs a new native build + store submission):**
- Adding/removing/upgrading a native module (anything under `expo install` that
  has native code, e.g. a new `expo-*` package).
- Changes to `app.config.js`/`app.json` **native** config (permissions, plugins,
  icons, splash, bundle id, entitlements).
- Bumping the Expo SDK or React Native version.
- **Bumping `version` in `app.json`** — because `runtimeVersion.policy` is
  `appVersion`, changing the version starts a *new* runtime that existing
  installs cannot receive an OTA for. Ship a new build for that.

Rule of thumb: if `git diff` only touches `src/**` and JS assets, OTA is safe.
If it touches native config or `package.json` native deps, build instead.

---

## Channels ↔ branches

Each EAS build profile is bound to a channel (`eas.json`); you publish updates
to a **branch** and point the channel at it.

| Build profile | Channel       | Publish command target |
| ------------- | ------------- | ---------------------- |
| `development` | `development` | `--branch development` |
| `preview`     | `preview`     | `--branch preview`     |
| `production`  | `production`  | `--branch production`  |

(A channel can be re-pointed to a different branch with
`eas channel:edit <channel> --branch <branch>` for staged rollouts.)

---

## Publish a normal update

```bash
# Target the channel your build is on. For your preview build:
eas update --branch preview --message "Fix booking confirm button"

# Production:
eas update --branch production --message "Tracking screen polish"
```

Installed apps pick it up on the **next cold launch** (the in-app launch check
downloads it silently and applies it on the following launch), or immediately
when the user taps **Profile → Check for updates → Restart**.

## Publish a CRITICAL (forced) update

A critical update is force-applied: the app shows a blocking "Update required"
sheet and restarts into the new bundle. It's driven by an `ota.critical` flag
baked into the update manifest via the `EXPO_OTA_CRITICAL` env var (see
`app.config.js`):

```bash
EXPO_OTA_CRITICAL=1 eas update --branch production --message "Critical payment hotfix"
```

Use sparingly — only for security/money-safety hotfixes. Omit the env var (or
set it to anything but `1`) for normal, non-blocking updates.

## Roll back a bad update

```bash
# Option A: publish a rollback marker so clients revert to the embedded build.
eas update:rollback --branch production

# Option B: re-publish the previous known-good commit.
git checkout <good-commit> -- .
eas update --branch production --message "Roll back to <good-commit>"
```

---

## How it behaves in the app

Implemented in:
- `src/hooks/useOtaUpdate.ts` — `checkForOtaUpdate({ silent })` core routine +
  `useOtaLaunchCheck()` launch hook.
- `src/stores/updateStore.ts` — update lifecycle state.
- `src/components/ui/OtaUpdateGate.tsx` — the blocking sheet for critical updates
  (mounted in `src/app/_layout.tsx`).
- Profile → **Check for updates** and **App version** rows
  (`src/app/(customer)/(tabs)/profile.tsx`, `src/app/(runner)/(tabs)/profile.tsx`).
- Toggle `APP_CONFIG.OTA_CHECK_ON_LAUNCH` in `src/constants/config.ts`.

| Trigger | Behavior |
| ------- | -------- |
| Cold launch (auto) | Silent check → download → applies next launch. Non-critical shows an optional "Restart" toast; critical shows the blocking gate. |
| Profile → Check for updates | Checks now; "You're on the latest version" if none, or downloads + offers "Restart now". |
| Critical update available | `OtaUpdateGate` blocks the UI until the user restarts into the update. |
| Dev / Expo Go | No-op (guarded by `__DEV__` + `Updates.isEnabled`). |

The **App version** row shows the native version, plus a short update id suffix
(e.g. `1.0.0 · 3f2a9c1b`) when a JS OTA bundle is running — handy for QA to
confirm which bundle is live.

---

## Testing OTA on your preview build

1. Build & install the preview APK: `eas build -p android --profile preview`,
   then install it on a device (not Expo Go).
2. Make a small visible JS change (e.g. tweak a label).
3. Publish: `eas update --branch preview --message "OTA test"`.
4. Fully close and reopen the app twice: launch 1 downloads it, launch 2 shows
   the change. Or use **Profile → Check for updates → Restart now** to apply
   immediately.
5. Test the forced path:
   `EXPO_OTA_CRITICAL=1 eas update --branch preview --message "critical test"` →
   the blocking "Update required" sheet should appear.

> First-time setup: run `eas update:configure` once if EAS asks; it's already
> wired in `app.config.js` (`updates.url`, `runtimeVersion`) and `eas.json`
> (per-profile `channel`).
