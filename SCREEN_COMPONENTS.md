# ErrandGuy — Screen Structure Reference

A detailed, per-screen structural reference for the **ErrandGuy** mobile app (`errandguy-mobile`, Expo Router / React Native / TypeScript). Regenerated from the **current** source (post design-improvement pass + **Phase 3/4** growth/native features) on **2026-07-10**. Phase 3/4 additions are tagged `← Phase 3` / `Phase 4` inline: referral, promos, live support threads, notification swipe-archive/delete, wallet/earnings export, server-synced shopping checklist, demand heatmap, share-trip, Face ID unlock, and voice-guided navigation.

Unlike a flat component list, every screen below is documented with its real **layout tree**, its **states** (loading / empty / error / variants), its **interactions & haptics**, its **data sources**, and its **navigation targets**.

## How to read a screen block

Each screen follows the same template:

- **File · Purpose** — the route file and a one-line summary.
- **Layout structure** — an ASCII tree of the *actual* component hierarchy, outermost → innermost. Indentation is nesting; `?` marks a conditionally-rendered node; `A | B` marks branch alternatives; `[ … ]` notes key props/labels; `(→ route)` notes a tap target; `× N` marks a repeated/mapped node.
- **States** — what renders while **Loading**, when **Empty**, on **Error**, and any other conditional **Variants**.
- **Interactions & haptics** — taps, gestures, slide-to-confirm, pull-to-refresh, and which `expo-haptics` fire (`selection` / `impact` / `notification`).
- **Data** — `useQuery` keys, zustand stores, services, and realtime channels.
- **Navigation** — where actions route.

> **Routing:** Expo Router file-based groups — `(auth)`, `(customer)`, `(runner)`; `(tabs)` is each role's bottom-tab navigator; `[id]` / `[bookingId]` are dynamic routes.
> **Shared primitives** referenced throughout (GradientHeader, ExpandableSheet, BottomActionBar, ErrorState, EmptyState, SuccessCheck, SlideToConfirm, Skeleton, ConfirmModal, …) are catalogued in the [Component Library](#appendix--reusable-component-library) appendix.

## Contents

- [1. Auth Flow](#1-auth-flow) — welcome, role select, login, register, OTP, forgot-password, permissions
- [2. Customer — Core (tabs + help)](#2-customer-flow--core-tabs--help) — home, activity, notifications, profile, help
- [3. Customer — Booking funnel](#3-customer-flow--booking-funnel) — type → details → schedule → review → searching
- [4. Customer — Tracking, Wallet, Chat, Account](#4-customer-flow--tracking-wallet-chat-account) — tracking, rate, wallet, chat, addresses, contacts, payment, **referral · promos · support**
- [5. Runner — Core (tabs)](#5-runner-flow--core-tabs) — dashboard, earnings, history, profile
- [6. Runner — Job workspace](#6-runner-flow--job-workspace) — onboarding, notifications, active errand, navigate, payout, chat, **demand (busy areas)**
- [7. Runner — Settings](#7-runner-flow--settings) — profile, documents, vehicle, working areas, preferred types, notifications, help, terms
- [8. Shared / System](#8-shared--system) — app entry, root layout, global overlays
- [Appendix — Reusable Component Library](#appendix--reusable-component-library)

---

## 1. Auth Flow

### 1.1 Welcome — `/(auth)/welcome`
**File:** `src/app/(auth)/welcome.tsx`  ·  **Purpose:** 3-slide onboarding carousel on a soft gradient canvas; entry point that gates onto permissions/login.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (root)
├─ LinearGradient (absoluteFill)  [HERO_GRADIENT: primaryLight → surface, vertical]
└─ SafeAreaView (edges: top)
   ├─ FlatList (horizontal · pagingEnabled · ref for scrollToIndex)
   │  └─ renderItem → OnboardingSlide  [image · title · description · active]
   │        └─ MotiView (fade + translateY entrance when active; static under Reduce Motion)
   └─ View "footer"
      ├─ View "pagerStatus"  [accessible · liveRegion=polite · label "Slide X of 3"]
      │  ├─ pageIndicator (dots · active dot widens to pill in primary)
      │  └─ pageCounter "1 / 3"
      ├─ View "actionRow"
      │  ├─ Pressable "Skip" (ghost)
      │  └─ Button (fullWidth)  ? "Next" | "Get Started" (isLast)
      └─ View "loginRow" → Pressable "Already have an account? Log in"
```

**States:**
- **Loading:** none — static slide content.
- **Empty:** n/a
- **Error:** n/a
- **Variants:** `activeIndex` tracked via `onViewableItemsChanged` (50% threshold); last slide swaps the primary CTA label to "Get Started"; OnboardingSlide entrance animation gated on `active === index` and disabled under `useReducedMotion`.

**Interactions & haptics:** Swipe/page the FlatList; Next advances via `scrollToIndex` (or finishes on last slide). `Haptics.selectionAsync()` fires on Skip, Next, and the "Log in" link tap. No pull-to-refresh.

**Data:** No queries/stores. Writes `@onboarding_seen = 'true'` to AsyncStorage on Skip and on final Next. Slide copy is a local `slides` array; images are local `require`d PNGs (ONBOARDING-1/2/3).

**Navigation:** Skip → `/(auth)/permissions`; Next on last slide → `/(auth)/permissions`; "Log in" → `/(auth)/login` (all `router.push`).

---

### 1.2 Role Select — `/(auth)/role-select`
**File:** `src/app/(auth)/role-select.tsx`  ·  **Purpose:** Choose customer vs runner role and persist it, then route into the correct app section.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (bg-background, px-6)
├─ View (flex-1, centered)
│  ├─ Text eyebrow "One last step"
│  ├─ Text heading "How will you use ErrandGuy?"
│  ├─ Text subtitle "Choose your role. You can switch anytime."
│  └─ View (role cards, gap 14)
│     └─ roles.map → Pressable "card"  [role=radio · state.selected/checked]  (× Customer, Errand Runner)
│        ├─ View "radio"  ? Check icon (when selected)
│        ├─ View "cardHeader" → iconChip (Package | Bike) + title + subtitle
│        └─ View "features" → featureRow × 3 (Check + label)
└─ View (footer) → Button "Continue"  [disabled until a role picked · loading]
```

**States:**
- **Loading:** Button `loading` spinner during `updateProfile` call; no full-screen skeleton.
- **Empty:** n/a (fixed 2 roles).
- **Error:** `toast.error(message)` on failure (server message or generic fallback).
- **Variants:** `selectedRole` toggles card selected styling (primary border + primaryLight fill + filled radio); Continue disabled while `selectedRole === null`.

**Interactions & haptics:** Tap a card → `Haptics.selectionAsync()` + sets `selectedRole`. Continue → `Haptics.notificationAsync(Success)` on success, `notificationAsync(Error)` on failure.

**Data:** `useAuth().updateProfile` (local store), `userService.updateProfile({ role })` (server), `toast` store.

**Navigation:** On success `router.replace` — runner → `/(runner)/onboarding`; customer → `/(customer)/(tabs)`.

---

### 1.3 Login — `/(auth)/login`
**File:** `src/app/(auth)/login.tsx`  ·  **Purpose:** Sign in with phone/email + password; greets a remembered user by name/avatar.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (edges: top, bottom)
├─ StatusBar (dark-content)
├─ KeyboardAvoidingView
│  └─ ScrollView (keyboardShouldPersistTaps=handled)
│     ├─ Pressable back button  ? (only when !onboardingSeen)
│     ├─ View (brand + heading)
│     │  ├─ AuthBrandMark (56)
│     │  └─ ? rememberedProfile:
│     │       ├─ row: Avatar(lg) + "Welcome back, {firstName}" + "Sign in to continue your errand."
│     │       ├─ Pressable "Not you? Use another account"
│     │       └─ ? canBiometricUnlock → Button "Unlock with Face ID" (ScanFace · secondary · auto-presents once on mount)   ← Phase 4
│     │     | default:
│     │       └─ "Welcome back" + subtitle
│     ├─ Controller identifier → Input "Phone or Email"  [dynamic keyboard/autocomplete · autoFocus if no remembered id]
│     ├─ Controller password → Input "Password"  [secure · autoFocus if remembered id present]
│     ├─ row: Pressable "Remember me" (checkbox) · Pressable "Forgot password?"
│     ├─ ? biometricAvailable & !locked → Pressable "Unlock with Face ID next time" (opt-in checkbox)   ← Phase 4
│     ├─ Button "Log in"  [loading]
│     ├─ Divider "or continue with"
│     ├─ row: SocialLoginButton google · SocialLoginButton facebook
│     └─ row: "New here?" + Pressable "Create account"
└─ LogoutSplash (overlay · visible while loading · primaryDark bg + logo)
```

**States:**
- **Loading:** `Button loading` + full-screen `LogoutSplash` overlay (primaryDark, tinted logo) while `loading`.
- **Empty:** n/a
- **Error:** No toast for 422 field errors — server validation maps onto `identifier`/`password` inline via `setError`. Otherwise `toast.error` with a message mapped by status (no status → offline copy; 401 incorrect creds; 405 unavailable; 429 rate-limit; ≥500 server; 422 fallback). `Haptics.notificationAsync(Error)`.
- **Variants:** `rememberedProfile` (identifier + firstName present) swaps the header to the personalized greeting block with avatar + "Not you?" reset; identifier-only still pre-fills the field. Identifier input dynamically switches keyboardType/autoComplete/textContentType based on whether the value looks like a phone.
- **Biometric unlock (Phase 4):** When a token was persisted for a biometric-opted-in user, cold start withholds auth from state (`biometricLockPending`) while keeping the token in `secureStorage`, converting auto-login into a locked start. If the device supports biometrics (`canBiometricUnlock`) the "Unlock with Face ID" button renders in the remembered-profile block and the system prompt auto-presents once on mount; success validates the persisted token via `getProfile` then `completeBiometricUnlock(user)`; a 401/403 clears the session and falls back to password. Degrades safely in Expo Go (native module absent → button hidden, password login applies).

**Interactions & haptics:** Submit → `Haptics.notificationAsync(Success)` on success, `(Error)` on failure. Remember-me toggle → `selectionAsync()`. "Not you? Use another account" → `selectionAsync()` + clears remembered creds + resets form + unchecks remember + `clearBiometricSession()`. Face ID opt-in checkbox toggle → `selectionAsync()` (persists `biometricEnabled` only with Remember-me + hardware available). Social buttons show a "being finalized" `toast.info`. No pull-to-refresh.

**Data:** `useAuth().login`; `useAuthStore` selectors — `onboardingSeen`, `rememberedCredentials`, `setRememberedCredentials`, plus Phase-4 `biometricLockPending`/`setBiometricEnabled`/`completeBiometricUnlock`/`clearBiometricSession`; `useBiometricUnlock()` hook (expo-local-authentication); `preloadCoreImages()` (fired once on mount); `toast`. react-hook-form (`identifier`, `password`); `isPhone`/`isEmail` regex validators. On success with Remember-me, persists identifier + non-secret firstName/avatarUrl.

**Navigation:** Back → `router.back()` or fallback `router.replace('/(auth)/welcome')`; "Forgot password?" → `/(auth)/forgot-password`; "Create account" → `/(auth)/register`; on successful login no explicit navigate — the root layout redirects once user+token are set.

---

### 1.4 Register — `/(auth)/register`
**File:** `src/app/(auth)/register.tsx`  ·  **Purpose:** Create an account (avatar, name, phone, email, password, optional default address) with live validation, then verify by OTP.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (bg-background)
├─ StatusBar (dark-content)
├─ KeyboardAvoidingView
│  └─ ScrollView (keyboardShouldPersistTaps=handled)
│     ├─ View "heroBlock" (curved bottom) → SafeAreaView(top)
│     │     └─ back Pressable · eyebrow "Get started" · "Create your account." · subtitle
│     └─ View "form card" (lifts over hero, rounded top, marginTop -22)
│        ├─ Pressable avatar upload  ? Image(picked) | Camera icon  + "Add Photo"
│        ├─ Controller full_name → Input
│        ├─ Controller phone → Input  [phone-pad · PH pattern]
│        ├─ Controller email → Input
│        ├─ Controller password → Input + PasswordStrengthIndicator (bars + 5 requirement rows)
│        ├─ Controller confirm_password → Input  [matches password]
│        ├─ Controller default_address → Input "Default Address (Optional)"
│        ├─ ? addressResults.length > 0 → dropdown (map → Pressable place rows)
│        ├─ Input "Referral Code (Optional)"  [uppercased · maxLength 12]   ← Phase 3
│        ├─ Pressable terms checkbox  [links: Terms of Service · Privacy Policy → LegalModal]
│        ├─ Button "Create Account"  [disabled until termsAccepted · loading]
│        └─ row: "Have an account?" + TouchableOpacity "Login"
└─ LegalModal (visible when legalDoc set · document terms|privacy)
```

**States:**
- **Loading:** `Button loading` spinner during account creation / uploads.
- **Empty:** n/a (address dropdown simply hidden when no results).
- **Error:** Server 422-style field errors map inline onto `phone`/`email`/`full_name`/`password` via `setError`; otherwise `toast.error` mapped by status (offline / 429 / ≥500 / fallback). Missing terms → `toast.error`. Avatar upload failure is non-blocking → `toast.warning`. OTP-send failure → `toast.info` and skip to role-select. `Haptics.notificationAsync(Error)` on submit failure.
- **Variants:** form mode `onTouched` + reValidate `onChange` → live validation after first blur. PasswordStrengthIndicator renders only when password non-empty (Weak/Fair/Good/Strong bars). Address autocomplete only fires when query ≥2 chars and differs from the already-picked place.

**Interactions & haptics:** Avatar tap → `Haptics.impactAsync(Light)` + `pickImage`. Address result tap → `selectionAsync()` + fills field + dismisses keyboard. Terms toggle → `selectionAsync()`. Submit → `notificationAsync(Success)` on success, `(Error)` on failure.

**Data:** `useAuth().register`; `useImagePicker`; `useDebounce(addressValue, 400)`; `geocodingService.search` (HERE) → `PlaceFeature[]`; on success (fire-and-forget) `userService.addAddress` (from selected geocode) + `userService.uploadAvatar` + `userService.applyReferral(code)` when a referral code was entered (Phase 3 — the register endpoint itself does not accept a code, so it is applied post-register and never blocks onboarding on failure); `authService.sendOTP`; `toast`. react-hook-form with per-field rules (PH phone regex, email regex, password complexity, confirm match).

**Navigation:** Back → `router.back()` or fallback `router.replace('/(auth)/login')`. On success with phone → `router.replace('/(auth)/verify-otp')` with params `{ phone, purpose: 'register-verify' }`; OTP-send failure or no phone → `router.replace('/(auth)/role-select')`; "Login" link → `/(auth)/login`.

---

### 1.5 Verify OTP — `/(auth)/verify-otp`
**File:** `src/app/(auth)/verify-otp.tsx`  ·  **Purpose:** Enter the 6-digit code sent to the user's phone/email; auto-submits and shakes on error.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (bg-background)
├─ Pressable back button
└─ View (px-6)
   ├─ Text eyebrow "Verification"
   ├─ Text heading "Verify your number." | "Verify your email."
   ├─ Text subtitle "We sent a 6-digit code to {maskedIdentifier}"
   ├─ OTPInput  [6 cells · error → red cells + shake + Error haptic]
   ├─ View (resend area)  ? "Resend code in {mm:ss}" | Pressable "Didn't receive it? Resend"
   ├─ ? attemptsRemaining < 5 → Text "{n} attempts remaining" | "Too many attempts. Please request a new code."
   └─ Button "Verify"  [disabled if code<6 or attempts=0 · loading]
```

**States:**
- **Loading:** `Button loading` during verify.
- **Empty:** n/a
- **Error:** Inline on the OTP cells — sets `otpError`, which turns cells red, triggers the shake animation, and fires the Error haptic (all inside `OTPInput`); clears code. `attemptsRemaining` (from server `attempts_remaining`) shown as a red counter when `< 5`. Resend failure → `toast.error`.
- **Variants:** Countdown active (`!isExpired`) shows "Resend code in {formatted}"; expired shows the Resend link. Attempts exhausted (0) disables Verify and the resend copy changes. Heading/masking differs for phone vs email (`maskedIdentifier`).

**Interactions & haptics:** Auto-submits when `code.length === 6` (guarded against re-firing when attempts exhausted). Typing clears the inline error. Verify success → `Haptics.notificationAsync(Success)`. Resend → `selectionAsync()` + restarts 300s countdown + resets attempts + `toast.success`. `OTPInput` fires `selectionAsync()` per digit and the Error haptic when `error` lands.

**Data:** params `{ phone?, email?, purpose? }` via `useLocalSearchParams`; `authService.verifyOTP` / `sendOTP`; `useAuthStore` `setUser`/`setToken`; `useCountdown(300, true)`; `toast`.

**Navigation:** Back → `router.back()` or fallback `router.replace('/(auth)/login')`. On success: `purpose === 'register-verify'` → `router.replace('/(auth)/role-select')`; login flow sets user+token and lets the root layout redirect.

---

### 1.6 Forgot Password — `/(auth)/forgot-password`
**File:** `src/app/(auth)/forgot-password.tsx`  ·  **Purpose:** Request a password-reset email; swaps to a success confirmation once sent.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (bg-background)
├─ Pressable back button
└─ ? sent:
     View (centered)
     ├─ SuccessCheck (88)
     ├─ "Check your email" + body
     └─ Button "Back to Login"
   | default:
     KeyboardAvoidingView
     ├─ "Reset password" + subtitle
     ├─ Controller email → Input "Email"
     ├─ Button "Send Reset Link"  [loading]
     └─ row: "Remember your password?" + TouchableOpacity "Login"
```

**States:**
- **Loading:** `Button loading` while calling `forgotPassword`.
- **Empty:** n/a
- **Error:** `toast.error` mapped by status (offline / 429 / ≥500 / server email-error fallback). `Haptics.notificationAsync(Error)`.
- **Variants:** `sent` boolean toggles the whole body between the form and the `SuccessCheck` confirmation view.

**Interactions & haptics:** Submit sets `sent=true` on success; the success haptic comes from `SuccessCheck` mounting (not fired here to avoid double-buzz). Error haptic on failure. Email validated by regex.

**Data:** `authService.forgotPassword(email)`; `toast`; react-hook-form (`email`).

**Navigation:** Back → `router.back()` or fallback `router.replace('/(auth)/login')`; "Back to Login" and the "Login" link → `router.replace('/(auth)/login')`.

---

### 1.7 Location Permission — `/(auth)/permissions`
**File:** `src/app/(auth)/permissions.tsx`  ·  **Purpose:** Request foreground location access, handling the full grant/deny/denied-forever lifecycle.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (bg-background, px-28)
├─ View "content" (centered)
│  ├─ Image location-permission.png (decorative · a11y hidden)
│  ├─ Text "Allow location access"
│  ├─ View "whyList"  → whyRow × 3  [Check chip + reason]  (Find nearby runners · Calculate accurate ETAs · Precise pickup & drop-off)
│  ├─ ? granted → grantedInline pill  [CheckCircle + "Location access enabled" · liveRegion]
│  └─ ? (!granted && !canAskAgain) → blockedInline notice  [Settings icon + Settings→Permissions→Location copy · liveRegion]
└─ View "footer"
   ├─ Button (dynamic)  ? "Continue" (granted) | "Open Settings to enable" (!canAskAgain) | "Allow Location"
   └─ ? !granted → Pressable "Not now"
```

**States:**
- **Loading:** none (native permission call is quick; no spinner).
- **Empty:** n/a
- **Error:** Native-call failure → `toast.error("Couldn't check location access…")`; `refreshStatus` failures are swallowed (treated as not-granted, never crashes).
- **Variants:** three permission states drive UI — `granted` (success pill + Continue), denied-but-can-ask (Allow Location re-requests the OS dialog), denied-forever `!canAskAgain` (blocked notice + "Open Settings to enable" deep-links via `Linking.openSettings()`). "Not now" skip hidden once granted.

**Interactions & haptics:** Allow button: if granted → advance; if `!canAskAgain` → open OS Settings; else `requestForegroundPermissionsAsync()`. `Haptics.notificationAsync(Success)` on a fresh grant — both from the direct request and from the `AppState` "active" re-check when returning from Settings (uses `grantedRef` to detect the false→true transition).

**Data:** `expo-location` `getForegroundPermissionsAsync` / `requestForegroundPermissionsAsync`; `AppState` listener; `toast`. No queries/stores beyond local state (`granted`, `canAskAgain`, `grantedRef`).

**Navigation:** `goNext` → `router.push('/(auth)/contacts-permission')` (from Continue when granted, from Allow on fresh grant, and from "Not now").

---

### 1.8 Contacts Permission — `/(auth)/contacts-permission`
**File:** `src/app/(auth)/contacts-permission.tsx`  ·  **Purpose:** Request contacts access (same lifecycle handling as location), degrading gracefully when the native module is absent.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (bg-background, px-28)
├─ View "content" (centered)
│  ├─ Image contact-permission.png (decorative · a11y hidden)
│  ├─ Text "Access your contacts"
│  ├─ View "whyList"  → whyRow × 3  [Check chip + reason]  (Add recipients faster · Set up trusted contacts for safety · No typing long phone numbers)
│  ├─ ? granted → grantedInline pill  [CheckCircle + "Contacts access enabled" · liveRegion]
│  └─ ? (!granted && !canAskAgain) → blockedInline notice  [Settings icon + Settings→Permissions→Contacts copy · liveRegion]
└─ View "footer"
   ├─ Button (dynamic)  ? "Continue" (granted or no native module) | "Open Settings to enable" (!canAskAgain) | "Allow Contacts"
   └─ ? !granted → Pressable "Not now"
```

**States:**
- **Loading:** none.
- **Empty:** n/a
- **Error:** Request failure → `toast.error("Couldn't open contacts. You can add recipients manually.")`; `refreshStatus` failures swallowed.
- **Variants:** `expo-contacts` is loaded via a guarded `require` and may be `null` (e.g. Expo Go) — the button reads "Continue" and Allow simply advances instead of stranding a dead button. Same granted / can-ask / denied-forever branches as the location screen.

**Interactions & haptics:** Allow: granted → advance; no native module → advance; `!canAskAgain` → `Linking.openSettings()`; else `Contacts.requestPermissionsAsync()`. On a fresh grant `Haptics.notificationAsync(Success)` (stays on screen showing the success pill; user taps Continue). Same `AppState` "active" re-check + success haptic on false→true transition via `grantedRef`.

**Data:** `expo-contacts` (nullable) `getPermissionsAsync` / `requestPermissionsAsync`; `AppState` listener; `toast`. Local state only.

**Navigation:** `goNext` → `router.push('/(auth)/login')` (from Continue, fresh grant, no-module fallback, and "Not now").

---

### Auth layout note
**File:** `src/app/(auth)/_layout.tsx` — A single Expo Router `Stack` with `headerShown: false` and `animation: STACK_ANIMATION`. `STACK_ANIMATION` is platform-aware (`src/constants/navigation.ts`): `slide_from_right` on Android (avoids the iOS-card edge-shadow "ghost panel"), `ios_from_right` on iOS. All eight auth screens above render headerless inside this stack; each screen supplies its own back affordance (custom `ChevronLeft` Pressable) rather than a nav-bar back button.
## 2. Customer Flow — Core (tabs + help)

### 2.0 Customer Tab Bar — `(customer)/(tabs)/_layout.tsx`
**File:** `src/app/(customer)/(tabs)/_layout.tsx`  ·  **Purpose:** Floating pill bottom-nav shell for the four customer tabs, with an overlaid quick-book FAB rendered as a sibling.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1)
├─ Tabs  [screenOptions: headerShown:false · animation:'shift' · freezeOnBlur · lazy · showLabel:false · hideOnKeyboard]
│        (tabBarStyle = floating capsule: position absolute, left/right side-margins,
│         bottom = max(inset,gap)+gap/2, borderRadius 999, height BAR_HEIGHT, iOS soft shadow / Android elevation 12)
│  ├─ Tabs.Screen "index"          → TabBarItem name="home"          (offsetX −6)
│  ├─ Tabs.Screen "activity"       → TabBarItem name="receipt"       (offsetX −22)
│  ├─ Tabs.Screen "notifications"  → TabBarItem name="notifications" (offsetX +22, badgeCount={unreadCount})
│  └─ Tabs.Screen "profile"        → TabBarItem name="person"        (offsetX +6)
└─ QuickBookFAB (overlay, tabBarHeight=BAR_HEIGHT)  → centred disc floating above the pill's mid-gap
```

**States:**
- **Loading:** none (layout shell).
- **Empty:** n/a.
- **Error:** n/a.
- **Variants:** Alerts tab icon shows a numeric badge only when `unreadCount > 0`. QuickBookFAB auto-hides itself on booking-funnel/tracking/chat/navigate/errand/wallet-top-up routes (see FAB detail below).

**Interactions & haptics:** Tab switching uses react-navigation `animation:'shift'`; per-tab-icon press feedback lives inside `TabBarItem` (out of this file). Off-screen tabs are frozen (`freezeOnBlur`) and lazily mounted on first focus.

**Data:** `useNotificationStore((s)=>s.unreadCount)` for the Alerts badge; `useSafeAreaInsets()` for the bottom float gap.

**Navigation:** Four tab routes (index / activity / notifications / profile). FAB pushes `/(customer)/book/type`.

**Component — QuickBookFAB** (`src/components/ui/QuickBookFAB.tsx`):
```
Animated.View (position absolute, left:'50%', translateX −SIZE/2, bottom = pill bottom + tabBarHeight − SIZE/2 − 6)
                (transform: press-scale spring + first-mount bob translateY 10→0; opacity 0→1)
└─ Pressable (SIZE=mScale(52), circular, android_ripple borderless)
   ├─ LinearGradient (brand gradientEnd→Mid→Start fill)
   ├─ View innerHighlight (1px top sheen)
   └─ Plus icon (mScale(22), textInverse)
```
- Despite its docstring mentioning a "fan-out menu," the CURRENT implementation is a single button: `onPress` fires `Haptics.impactAsync(Medium)` then `router.push(href)` (default `/(customer)/book/type`). No fan-out.
- First-mount bob animation runs once after a 400ms delay (suppressed when `useReducedMotion()` is true or when not visible). Press-in/out drive a scale spring (0.92 ↔ 1), also suppressed under reduced motion.
- Auto-hidden when `pathname` includes any of `/book/`, `/tracking/`, `/chat/`, `/navigate/`, `/errand/`, `/wallet/top-up` (overridable via `visible` prop).

---

### 2.1 Customer Home — `(customer)/(tabs)/index.tsx`
**File:** `src/app/(customer)/(tabs)/index.tsx`  ·  **Purpose:** Ride-hailing-style home: brand hero, destination prompt, contextual quick actions, live active errand, featured service tiles, and recent errands.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
initialLoading ?  SafeAreaView(top) › HomeSkeleton
              |  View (flex-1 bg-background)
   ├─ StatusBar dark-content
   └─ ScrollView (RefreshControl, paddingBottom TAB_CONTENT_BOTTOM_INSET)
      ├─ mapHero (height 300, static brand gradient — NO live map)
      │  ├─ Pressable(absoluteFill) → startBooking()  [LinearGradient brand + bottom fade-to-canvas]
      │  └─ SafeAreaView(top) › row: [Avatar chip → profile] [greeting pill "Good <x>, <firstName>"] [Bell chip → notifications  · unread dot ?]
      ├─ Destination card (floats up −44) → startBooking()
      │     ├─ pickup row (green ring + "Pickup location")
      │     ├─ connector
      │     └─ dropoff row ("What can we help you with today?" + chevron bubble ArrowRight)
      ├─ Quick actions  (horizontal ScrollView of pills)
      │     [Repeat last ? (if lastBooking)] · Schedule · [Track ? (if activeBooking)] · Help
      ├─ activeBooking ?  View › ActiveBookingCard  (→ tracking/[id])
      ├─ Services section  ? (featuredTypes.length>0 || errandTypesQ.error)
      │     ├─ header "What can we help with?" + [See all ? (if types)]
      │     └─ featuredTypes.length===0 ?  ErrorState(compact "Couldn't load services", onRetry)
      │                                  |  ├─ frequentType ?  "Frequently booked · <name>" chip (TrendingUp)
      │                                  |  └─ tiles row (4 × 25% ErrandTypeIcon tinted + name) → startBooking(type.id)
      └─ Recent section
            recentBookings.length>0 ?  header "RECENT" + "See all"(→activity) ; up to 3 rows (name · status dot+label · relative time · amount) → tracking/[id]
            : recentBookingsQ.error ?  header + ErrorState(compact "Couldn't load your errands", onRetry)
            : (!loading && enabled && user.id) ?  header + guide text + "Book your first errand" link (→ startBooking)
            : null
```

**States:**
- **Loading:** `HomeSkeleton` (full-screen, inside SafeAreaView top). `initialLoading` = customer role AND (errand-types OR recent-bookings query loading) AND both currently empty.
- **Empty:** Recent section shows a guide block — "Your errands will show up here…" + underlined "Book your first errand" link (only when not loading, role customer, and `user.id` present).
- **Error:** Per-section, never full-screen. Services → `ErrorState compact` "Couldn't load services" + onRetry (`errandTypesQ.refresh`) when featured list empty. Recent → `ErrorState compact` "Couldn't load your errands" + onRetry (`recentBookingsQ.refresh`) when the recent query errored with nothing to show.
- **Variants:** Active errand card only when `activeBooking` present. Quick-action pills are contextual — "Repeat last" only if last booking has an errand type, "Track" only if there's an active booking; "Schedule" and "Help" always present. "Frequently booked" chip appears only when one errand type is booked ≥3× within the loaded recent window (computed client-side via `useMemo`, no extra fetch). Bell shows a small danger dot when `unreadCount > 0`.

**Interactions & haptics:** Map hero + destination card taps → `startBooking()`. `withLightImpact` wraps quick-action presses, the frequent-booked chip, and the "Book your first errand" link (fires `Haptics.impactAsync(Light)`). Pull-to-refresh runs all three queries in parallel. No selection/notification haptics on this screen.

**Data:** `useQuery` keys — `['errand-types']` (configService.getErrandTypes, STATIC ttl), `['bookings','recent',userId]` (bookingService.getBookings per_page 3), `['booking','active',userId]` (bookingService.getActiveBooking). Stores: `authStore` (user, role), `bookingStore` (activeBooking, setActiveBooking, clearDraft), `notificationStore` (unreadCount). An effect syncs the active-booking query into `bookingStore` (skipping the first unresolved undefined).

**Navigation:** `startBooking(typeId?)` clears draft then pushes `/(customer)/book/type` (with `preselected` param when a type is given). Avatar → profile tab; Bell → notifications tab; active card & recent rows → `/(customer)/tracking/[id]`; "See all" recent → activity tab; Help quick action → `/(customer)/help`; Track quick action → `/(customer)/tracking/[activeBooking.id]`.

**Component — ActiveBookingCard** (`src/components/customer/ActiveBookingCard.tsx`, also used elsewhere):
```
Pressable (white card, border, Elevation.md; press → Light impact + onPress)
├─ status row: [pulsing dot + STATUS_LABEL] ····· [amount chip]
├─ headline (phase-aware sentence, e.g. "Looking for a runner nearby…" / "<Name> is on the way")
├─ booking.runner ?  info row [Avatar · name + ★rating·trips · "Track" pill]
│                 |  info row [Search icon · pickup/dropoff addresses · "View" pill]
├─ progress track (4 segments, filled = phase index; accessibilityRole progressbar)
└─ stage labels: Match · Pickup · Transit · Done (CheckCircle2 when done)
```
- Phase derived from `PHASE_BY_STATUS`; segments filled from `FILLED_SEGMENTS`. Status dot **pulses** (scale 1→1.5, opacity 1→0.45, 900ms loop) only while `searching` AND `useReducedMotion()` is false; otherwise frozen static.

---

### 2.2 Customer Activity — `(customer)/(tabs)/activity.tsx`
**File:** `src/app/(customer)/(tabs)/activity.tsx`  ·  **Purpose:** Paginated booking history with client-side search, filter pills, date/status bucketing, and a detail bottom sheet.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
loading & empty ?  SafeAreaView(top) › ActivitySkeleton
               |  View (flex-1 bg-background)
   ├─ GradientHeader "Activity"  [trailing: MessageCircle + badge={chatUnread} → /(customer)/chat]
   ├─ Search row (underline TextInput "Search by errand type or booking no." + [clear X ? when text])
   ├─ Filter pills  [All · Active · Completed · Cancelled]  (selected = solid primary capsule, white text)
   ├─ SectionList (sticky headers; RefreshControl; onEndReached infinite scroll)
   │  ├─ section header (title + count)
   │  ├─ renderItem → RecentErrandItem  (→ setSelectedBooking → BookingDetailSheet)
   │  ├─ ListFooter ?  ActivityIndicator (loadingMore) | "That's everything" (!hasMore & has rows) | null
   │  └─ ListEmpty ?  ErrorState(full "Couldn't load your errands", onRetry)          [page1Q.error & no data]
   │                | EmptyState(SearchX "No matches", "Clear search")                 [search matched none]
   │                | EmptyState(ClipboardList "No errands yet", "Book an Errand")     [genuinely empty]
   │                | null
   └─ BookingDetailSheet (modal, isVisible = !!selectedBooking)
```

**States:**
- **Loading:** `ActivitySkeleton` (full-screen inside SafeAreaView top) while first page loading with zero bookings.
- **Empty:** `EmptyState` icon `ClipboardList`, title "No errands yet", description "Book your first errand to get started", CTA "Book an Errand" → `/(customer)/book/type`.
- **Error:** `ErrorState` (full, not compact) "Couldn't load your errands" + onRetry (`page1Q.refresh`) when the first page errored with no cached data. Pagination failures (`onEndReached`) surface a `toast.error('Failed to load more.')` instead.
- **Variants:** Search zero-result → `EmptyState` icon `SearchX`, "No matches", description quotes the query, CTA "Clear search". Filter pills bucket the list: `active` filter groups into **In progress / On the way / Looking for runner**; all other filters bucket by date **Today / Yesterday / This Week / Earlier**. Footer shows a spinner while loading more, "That's everything" when exhausted. NOTE: filtering is now server-side (`status` param passed to `getBookings`); the file still defines `ACTIVE_STATUSES`/`COMPLETED_STATUSES`/`CANCELLED_STATUSES`/`matchesFilter`, but they are effectively dead — `matchesFilter` is no longer called; only the `active` bucket grouping reads `b.status` directly.

**Interactions & haptics:** Filter pill tap → `Haptics.selectionAsync()` then `setFilter`. Search field + inline clear X are pure state (no haptic). Pull-to-refresh resets pagination and refreshes page 1. Infinite scroll at 0.3 threshold appends pages into local `extraPages`. Tapping a row opens `BookingDetailSheet` (no navigation until the sheet routes). Header trailing icon → chat.

**Data:** `useQuery(['bookings','activity',filter,userId])` → `bookingService.getBookings({page:1, per_page:15, status})`; local pagination state (`extraPages`, `page`, `hasMore`, `loadingMore`). Stores: `authStore` (userId), `chatStore` (unreadCount for header badge). Client-side search over loaded rows matches errand-type name or booking number.

**Navigation:** Header trailing → `/(customer)/chat`. Empty CTA → `/(customer)/book/type`. Row → BookingDetailSheet, which itself routes to `/(customer)/tracking/[id]`.

**Component — RecentErrandItem** (`src/components/customer/RecentErrandItem.tsx`, `memo`):
```
Card (onPress, padding sm)
├─ header row: ErrandTypeIcon(tinted) · [name + status dot+label·relative time] · [amount + ChevronRight]
└─ (pickup||dropoff) ?  route timeline (green bead → hairline connector → dark square bead), each address 1 line
```

**Component — BookingDetailSheet** (`src/components/customer/BookingDetailSheet.tsx`):
```
BottomSheet (snapPoints [0.85])  — returns null when booking is null
└─ ScrollView
   ├─ hero: status chip (tinted) · errand-type name · big total (Inter tabular-nums)
   ├─ meta strip: [# booking_number] [Calendar full-date · time]
   ├─ Route: pickup (green dot) → connector → drop-off (dark square)
   ├─ Payment: PriceBreakdown (Base / Distance / Convenience / Surcharge / Promo Discount? if >0)
   └─ Actions:
       ├─ isLive ?  Button "Track this errand" (Navigation icon) → handleTrack
       ├─ status==='completed' ?  Button "Book again" (RefreshCw, loading=rebooking) → handleRebook
       └─ "View full details ›" pressable → tracking/[id]
```
- `isLive` = status in {pending, matched, accepted, in_progress}. `handleRebook` calls `bookingService.rebookErrand`, fires `Haptics.notificationAsync(Success)` then routes to `/(customer)/book/review`; on failure fires `Haptics.notificationAsync(Error)` + `toast.error`. `handleTrack` and "View full details" both route to `/(customer)/tracking/[id]`.

---

### 2.3 Customer Notifications — `(customer)/(tabs)/notifications.tsx`
**File:** `src/app/(customer)/(tabs)/notifications.tsx`  ·  **Purpose:** Paginated notification inbox with per-category filter chips, date bucketing, per-type iconography, and read/unread styling.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Notifications"  [trailing ? "Mark all read" text + "Clear all" Trash2 icon(danger) when notifications.length>0]   ← Phase 3: Clear all
├─ Category chips  [All · Bookings · Payments · Promos · More]  (selected = solid primary, white text)
└─ SectionList (sticky headers; RefreshControl; onEndReached infinite scroll)
   ├─ section header (bucket title + "N new" ? when unread in bucket)
   ├─ renderItem → Swipeable (swipe-left) → notification row (Pressable card)   ← Phase 3: swipe actions
   │     ├─ right actions: [Archive (surfaceMuted chip) · Delete (danger, Trash2)]  each 76pt
   │     ├─ type icon chip (soft tint per TYPE_META)
   │     └─ [eyebrow TYPE_LABEL · ·relative time · unread dot?] · title · body(2 lines)
   │     (unread rows: bg primaryLight + bold title; read rows: bg surface)
   ├─ ListFooter ?  ActivityIndicator (loadingMore) | "You're all caught up" (!hasMore & has rows) | null
   └─ ListEmpty ?  NotificationSkeletonRows (initialLoading)
                 | ErrorState(full "Couldn't load notifications", onRetry)          [notifQ.error & empty]
                 | EmptyState(Bell "Nothing here", secondary "Show all")            [category filtered empty]
                 | EmptyState(Bell "No notifications")                              [genuinely empty]
```

**States:**
- **Loading:** `NotificationSkeletonRows` (4 placeholder card rows with SkeletonCircle + 3 Skeleton bars) rendered via `ListEmptyComponent` while `initialLoading` (query loading AND store empty) — prevents the empty state flashing.
- **Empty:** `EmptyState` icon `Bell`, "No notifications", "You'll see updates about your errands here".
- **Error:** `ErrorState` (full) "Couldn't load notifications" + onRetry (`notifQ.refresh`) when the query errored with an empty store. Mark-all-read failure → `toast.error("Couldn't mark all as read. Please try again.")`. **Swipe archive/delete failure (Phase 3):** the row is optimistically removed from the store, then the service is called; on failure the pre-action snapshot is restored via `setNotifications` (which recomputes the unread badge) + `toast.error`. **Clear all failure:** the list is only emptied AFTER the server confirms, so a failed clear leaves the inbox intact + `toast.error`. Load-more and per-row mark-read failures fail silently (empty catch).
- **Variants:** Category chips (All / Bookings / Payments / Promos / More) narrow client-side via `matchesCategory` over `CATEGORY_TYPES`. Category-filtered-but-non-empty inbox → `EmptyState` "Nothing here" with a "Show all" secondary action resetting to `all`. Date buckets Today / Yesterday / This Week / Earlier. Footer "You're all caught up" when exhausted. Unread rows get the primaryLight wash + a small primary dot; section headers show "N new".

**Interactions & haptics:** Category chip tap → `Haptics.selectionAsync()` then `setCategory`. "Mark all read" → `Haptics.selectionAsync()` + API call + `markAllRead()`. Row tap marks read (optimistic via store) and navigates by type. **Swipe-left → Archive** (`selectionAsync`) or **Delete** (`notificationAsync(Warning)`): both optimistically `remove(id)` from the store, call the service, and roll back on failure (Phase 3). **"Clear all"** header action opens a destructive `ConfirmModal` (fires `notificationAsync(Warning)` on confirm) → `clearAll()` service + `clear()` store. Pull-to-refresh; infinite scroll at 0.4 threshold appends deduped pages (dedup against store IDs, handles Realtime-inserted rows).

**Data:** `useQuery(['notifications',userId])` → `notificationService.getNotifications({page:1,per_page:20})`, parsing Laravel paginator `last_page` for `hasMore`. Local pagination (`page`, `hasMore`, `loadingMore` + ref). Services (Phase 3): `deleteNotification` (`DELETE /notifications/{id}`), `archiveNotification` (`PUT /notifications/{id}/archive`), `clearAll` (`DELETE /notifications`). Stores: `notificationStore` (notifications, setNotifications, markRead, markAllRead, setUnreadCount, plus Phase-3 `remove(id)` — drops the row + decrements the badge only when it was unread, floored at 0 — and `clear()` — empties list + resets badge), `authStore` (userId). An effect syncs query data into the store and recomputes unread count.

**Navigation (by type):** `booking_update` → `/(customer)/tracking/[booking_id]`; `payment` → `/(customer)/wallet`; `chat` → `/(customer)/chat/[booking_id]`; `promo` → `/(customer)/(tabs)`; others → no-op.

---

### 2.4 Customer Profile — `(customer)/(tabs)/profile.tsx`
**File:** `src/app/(customer)/(tabs)/profile.tsx`  ·  **Purpose:** Account hub — identity, profile-completion meter, wallet summary, grouped account/payment/support menus, inline logout, and destructive delete-account flow.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Profile"  (no trailing)
├─ ScrollView (RefreshControl)
│  ├─ Identity row (Pressable → edit modal): Avatar lg · [full_name · email? · phone?] · ChevronRight
│  ├─ completion.percent<100 ?  Completion row (Pressable → edit modal)
│  │        [ "Profile N% complete" + Chevron ] · progress bar · [missing hints (first 2)]
│  ├─ Wallet strip (border-y): [Eyebrow "Wallet balance" + big balance → wallet] · [Wallet icon "Add money" → top-up]
│  ├─ renderSection "ACCOUNT"  → Card: Edit Profile(modal) · Saved Addresses · Trusted Contacts
│  ├─ renderSection "EARN & SAVE"  → Card: Invite friends(Gift → referral) · Promos & offers(Ticket → promos)   ← Phase 3
│  ├─ renderSection "PAYMENT"  → Card: Wallet (trailing balance) · Payment Methods
│  ├─ renderSection "SUPPORT"  → Card: Help & Support · Report an Issue
│  └─ footer: InlineLogoutLink (arm→confirm) · "Delete account" underline link
├─ Delete Account Modal (transparent slide, KeyboardAvoidingView)
│     └─ sheet: grabber · "Delete your account?" · warning · "Type DELETE" TextInput · Button(danger, disabled unless "DELETE") · Cancel
├─ EditProfileModal (visible=showEditModal)
└─ LogoutSplash (visible=loggingOut)
```

**States:**
- **Loading:** none — no skeleton. `refreshUser()` runs silently on focus (`useFocusEffect`) and on pull-to-refresh; failures swallowed by empty catch.
- **Empty:** n/a.
- **Error:** `refreshUser` catches silently. `handleDeleteAccount` failure → `toast.error('Failed to delete account. Please try again.')`.
- **Variants:** Completion row only renders when `completion.percent < 100`. Completion is computed client-side over five checks (avatar, email present, email verified, phone present, phone verified); `missing` hints skip "verify X" when X isn't set. Identity row shows email/phone lines only when present. Wallet menu row shows the balance as trailing text.

**Interactions & haptics:** Delete-account confirm → `Haptics.notificationAsync(Warning)` (only proceeds when typed text === "DELETE"). Logout handled by `InlineLogoutLink` (two-tap arm/confirm within a 3s window; on confirm calls `logout()` and shows `LogoutSplash`). Pull-to-refresh reloads the user record. Menu rows push routes; identity + completion rows open the edit modal.

**Data:** Stores `authStore` (user, setUser, updateProfile via modal); `useAuth` (logout). Services `userService.getProfile`, `userService.deleteAccount`. `formatCurrency` for balances. No `useQuery` here — profile freshness comes from the focus-effect fetch.

**Navigation:** Saved Addresses → `/(customer)/addresses`; Trusted Contacts → `/(customer)/trusted-contacts`; Invite friends → `/(customer)/referral` (Phase 3); Promos & offers → `/(customer)/promos` (Phase 3); Wallet → `/(customer)/wallet`; Add money → `/(customer)/wallet/top-up`; Payment Methods → `/(customer)/payment-methods`; Help & Support / Report an Issue → `/(customer)/help`. After delete: `logout()` then `router.replace('/(auth)/welcome')`.

**Component — EditProfileModal** (`src/components/customer/EditProfileModal.tsx`):
```
Modal (slide, transparent, statusBarTranslucent) › KeyboardAvoidingView
└─ dim layer › panel (height 92%)
   ├─ header: "Edit Profile" + X close
   └─ ScrollView
      ├─ Avatar xl (Pressable → ImagePickerModal) + "Change Photo"/"Uploading…"
      ├─ Input "Full Name"
      ├─ Input "Email" (email-address keyboard)
      └─ Button "Save Changes" (loading=saving)
   └─ ImagePickerModal (avatar upload)
```
- `handleSave` calls `userService.updateProfile` + `updateProfile()` store write; `toast.error` on failure. `handleAvatarUpload` posts multipart FormData via `userService.uploadAvatar`; `toast.error('Failed to upload avatar')` on failure; `uploadingAvatar` toggles the "Uploading…" label. No haptics.

---

### 2.5 Customer Help Center — `(customer)/help.tsx`
**File:** `src/app/(customer)/help.tsx`  ·  **Purpose:** Static FAQ accordion plus contact channels (email, hotline, issue report).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Help center"  [showBack, fallbackHref → /(customer)/(tabs)/profile]
└─ ScrollView (px-5)
   ├─ Eyebrow "Frequently asked"
   ├─ Card (FAQ accordion, 6 items, first expanded by default)
   │     item: Pressable(question + ChevronUp/Down) ; isOpen ?  answer text ; Hairline between
   ├─ Eyebrow "Still need help?"
   └─ Card (contact rows, Hairline-separated)
         ├─ Chat with support (Headphones chip)  → /(customer)/support   ← Phase 3 (live ticket threads)
         ├─ Email support (Mail chip)      → openMail(mailto:support@errandguy.ph)
         ├─ Hotline (Phone chip)           → openPhone(tel:+639171234567)
         └─ Report an issue (MessageCircle chip) → openMail(mailto:… prefilled subject+body)
```

**States:**
- **Loading:** none (fully static content).
- **Empty:** n/a.
- **Error:** No render-level error state. The mail/hotline rows go through the `openMail`/`openPhone` helpers, which wrap `Linking.openURL` in `.catch(() => toast.error("Couldn't open your …"))`, so a device with no mail/dialer app configured surfaces a toast instead of failing silently. (Previously these helpers were unwired dead code; now they are the row handlers.)
- **Variants:** One FAQ open at a time (`expanded` state, initialised to `0`).

**Interactions & haptics:** FAQ toggle → `Haptics.selectionAsync()` then expand/collapse. "Chat with support" row → `Haptics.selectionAsync()` + `router.push('/(customer)/support')` (Phase 3). Mail/hotline rows fire the guarded `openMail`/`openPhone` helpers (no haptics on those).

**Data:** Local `FAQS` constant (6 Q&A). `expanded` state. `toast` (used by the guarded open helpers).

**Navigation:** Header back → `/(customer)/(tabs)/profile` (fallback). Chat with support → `/(customer)/support`. External deep links: mailto/tel.
## 3. Customer Flow — Booking funnel

The 4-step funnel (`Type → Details → Schedule → Review`) is a `bookingStore` (zustand) draft that persists across screens; `setStep(n)` advances the store's step and each screen renders `<BookingStepIndicator currentStep={n}>` (numbered circles + connector lines, completed steps show `✓`, `accessibilityRole="progressbar"`). `confirm.tsx` is the post-submit matching screen (not part of the indicator). Every selector fires `Haptics.selectionAsync()` on pick.

### 3.1 Type Selection — `/(customer)/book/type`
**File:** `src/app/(customer)/book/type.tsx`  ·  **Purpose:** Pick which kind of errand to book (step 1 of 4).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (bg-background)
├─ GradientHeader "What do you need?"  [showBack · fallbackHref /(customer)/(tabs)]
│  └─ overline "New errand · Step 1"
├─ BookingStepIndicator currentStep=0
├─ ScrollView (RefreshControl → errandTypesQ.refresh)
│  ├─ loadingTypes & empty ?  6× skeleton tiles (2-col, 48% w, icon+3 bars)
│  │                       |  errand-type grid (flex-wrap, 2-col)
│  │     └─ Pressable tile ×N  [selected → solid primary fill + white content; else white card]
│  │        ├─ ErrandTypeIcon (variant ghost when selected, else tinted)
│  │        ├─ "Ride" tag ?  (only slug==='transportation')
│  │        ├─ type.name
│  │        ├─ type.description (2 lines)
│  │        └─ "From {base_fee}"
│  ├─ ErrorState ?  (!loading & empty & error) [title "Couldn't load errand types" · onRetry]
│  ├─ EmptyState ?  (!loading & empty & !error) [icon PackageSearch · "No errand types available" · action "Refresh"]
│  └─ spacer h-24
├─ BottomActionBar (divider=false)
│  └─ Button "Continue"  [disabled unless selectedId]
└─ ConfirmModal "Discard this booking?" ?  (visible when back pressed with draft data)
```

**States:**
- **Loading:** 6 bespoke skeleton tiles (2-column, 48% width, `height:148`, opacity 0.6 — icon block + 3 pill bars). Only shown when `errandTypesQ.loading && errandTypes.length===0`.
- **Empty:** `EmptyState` (icon `PackageSearch`, title "No errand types available", desc, action "Refresh" → `refresh()`) — fetch succeeded with zero rows.
- **Error:** dual-surfaced — a `toast.error('Failed to load errand types…')` fires via effect on `errandTypesQ.error`, PLUS an inline full `ErrorState` (title "Couldn't load errand types", `onRetry` → refresh) when nothing is cached.
- **Variants:** selected vs unselected tile (solid blue fill w/ inline-style white text vs white card); transportation tile shows a "Ride" tag.

**Interactions & haptics:** tile tap → `Haptics.selectionAsync()` + `setSelectedId`; pull-to-refresh (`RefreshControl`, shown only while refreshing with data present); `android_ripple` on tiles; press scales tile to 0.985. Back button: if `hasDraftData` (type/pickup/dropoff/description/photos present) opens `ConfirmModal`, else `leaveFlow()` (clears draft, back or replace home).

**Data:** `useBookingStore` (draftBooking, updateDraft, clearDraft, setStep); `useQuery(['errand-types'], configService.getErrandTypes)` SWR cache (`staleTime 1h`, `ttl STATIC`, shares key with home tile). `preselected` route param seeds initial selection once (ref-guarded). On Continue, if errand type changed it clears type-tied draft fields (vehicle/offer/pricing_mode/shopping_budget/item_value) but keeps addresses/contacts/photos.

**Navigation:** Continue → `setStep(1)` + `router.push('/(customer)/book/details')`. Back/discard → home or `router.back()`.

---

### 3.2 Task Details — `/(customer)/book/details`
**File:** `src/app/(customer)/book/details.tsx`  ·  **Purpose:** Set pickup/drop-off locations (map + search) and the per-errand-type detail fields (step 2, index 1).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (full-bleed map behind sheet)
├─ map pane (flex-1)
│  ├─ HereMapView ?  (only when mapOpen — opt-in, no tiles until "Map" tapped)
│  │  ├─ HereMarker pickup (PulseMarker primary) ?  (phase≠pickup & pickup set)
│  │  ├─ HereMarker dropoff (PulseMarker danger) ?  (phase==details & dropoff set)
│  │  └─ HerePolyline route (outline + fill) ?  (routeMapCoords present)
│  ├─ CenterPin overlay ?  (mapOpen & phase≠details) [lifts while isMoving]
│  ├─ Close-map (X) button ?  (mapOpen)
│  ├─ route-preview-failed chip ?  (mapOpen & details & routePreviewFailed) [dismissible]
│  ├─ SafeAreaView floating header
│  │  ├─ back button (ArrowLeft, phase-aware)
│  │  ├─ phase title "Set pickup" | "Set dropoff" | "Add details"
│  │  ├─ BookingStepIndicator (on translucent card) currentStep = pickup?0:1
│  │  └─ search bar ?  (phase≠details)
│  │     ├─ TextInput (placeholder from rule.pickup/dropoffLabel) + clear (X)
│  │     ├─ results dropdown ?  (showSearch & results>0) → rows → handleSearchSelect
│  │     ├─ "No places found"/"Search unavailable" ?  (searchDone & 0 results & query≥2)
│  │     └─ Recent list ?  (focused & query empty & recentPlaces>0)
│  ├─ no-map hint ?  (!mapOpen & phase≠details) [MapIcon + "Find your {label}"]
│  └─ My-location (Crosshair) button ?  (mapOpen & phase≠details)
├─ ExpandableSheet  [initial: details?'half':'peek'; snaps 0.35/0.60/0.93; footer = phase CTA]
│  ├─ phase≠details ?  Pickup/Dropoff card
│  │  ├─ card title "Set {label}"
│  │  ├─ address row (dot + resolved address / "Moving…" / hint)
│  │  └─ quick actions [Current (Navigation) · Saved (Bookmark) · Map (MapIcon, if !mapOpen)]
│  └─ phase==details ?  KeyboardAvoidingView Details form
│     ├─ route summary strip (pickup + dashed connector + dropoff, each "Change")
│     └─ ScrollView
│        ├─ helperNote ?  (rule.helperNote)
│        ├─ Input description ?  (rule.showDescription) [required per rule]
│        ├─ Input "Special Instructions (optional)"
│        ├─ PhotoGrid ?  (rule.showPhotos)
│        ├─ Input "Estimated Item Value" ?  (rule.showItemValue)
│        ├─ Input "Shopping Budget *" ?  (rule.requiresShoppingBudget)
│        ├─ pickup contact toggle + 2 Inputs ?  (rule.showPickupContact)
│        └─ dropoff contact toggle + 2 Inputs ?  (rule.showDropoffContact)
│  footer: phase≠details → Button "Confirm {label}"  |  details → (error text?) + Button "Continue"
├─ SavedAddressSheet (modal)
└─ ImagePickerModal (modal, "Add Item Photo")
```

**States:** three internal **phases** drive everything — `pickup` → `dropoff` → `details` (single-location errands skip dropoff).
- **Loading:** no full-screen loader. Map tiles load only when `mapOpen`. Address resolution shows "Moving…" in the address row while `isMoving`; search has no spinner (debounced).
- **Empty:** search "No places found for …" row (or Recent list when query empty); no-map hint fills the map area when map is closed.
- **Error:** search failure → inline "Search unavailable — check your connection" row + `setSearchFailed`; location failure → `toast.error`; route preview failure → dismissible dark chip "Couldn't preview route" (non-blocking). Validation errors (missing pickup/dropoff/description/shopping_budget) render as `errors` text above the Continue button / on the Inputs.
- **Variants:** `mapOpen` (map mounted, pin-drag) vs closed (search/current/saved only); per-errand-type `rule` toggles which fields render and single-location vs two-location flow; contact sections collapse/expand.

**Interactions & haptics:** quick-action buttons (Current / Saved / Map) fire `Haptics.selectionAsync()`; PhotoGrid add fires `impactAsync(Light)`, remove fires `notificationAsync(Warning)` (see 3.x note — internal to PhotoGrid). Map: pan updates center pin (lifts on move), region-change-complete reverse-geocodes (debounced 300ms). Search debounced 400ms, proximity-biased. "Change" links on route summary re-enter pickup/dropoff phase. Back is phase-aware (pickup→leave flow clearing coords; dropoff→pickup; details→dropoff/pickup). Contact phone inputs strip to digits/+ and cap 13 chars.

**Data:** `useBookingStore`; `useImagePicker`; `useDebounce`; `getErrandTypeRule(slug)` (memoized `rule`); `geocodingService` (`.search`, `.reverse`, `.getRecent`/`.addRecent`); `routeService.getRoute` (only when map open + details phase); `Location`/`getCurrentCoords`/`ensureLocationPermission`. A rule-cleanup effect prunes hidden-field draft values when errand type changes. HERE map is strictly opt-in to avoid tile billing.

**Navigation:** Continue → `setStep(2)` + `router.push('/(customer)/book/schedule')`. Back from pickup phase → `router.back()` / replace home. Saved-address "Manage" (inside SavedAddressSheet) → `/(customer)/addresses`.

---

### 3.3 Schedule — `/(customer)/book/schedule`
**File:** `src/app/(customer)/book/schedule.tsx`  ·  **Purpose:** Choose "Now" (immediate match) or a scheduled date/time (step 3, index 2).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (bg-background)
├─ GradientHeader "When?"  [showBack · fallbackHref /(customer)/(tabs)]
│  └─ overline "New errand · Step 3"
├─ BookingStepIndicator currentStep=2
├─ ScrollView
│  ├─ ScheduleToggle  [Now | Schedule]
│  ├─ scheduleType==='now' ?  info card (Info icon + "matched … immediately")
│  └─ scheduleType==='scheduled' ?  scheduling block
│     ├─ Quick-pick chips ?  (quickPicks.length>0) [Zap "Quick pick" · horizontal chips: In 1 hour / Tonight / Tomorrow 9AM / Tomorrow 12PM]
│     └─ DateTimePicker  (horizontal date strip + hour/minute wheels + summary card)
│  └─ spacer h-24
└─ BottomActionBar
   └─ Button "Continue"  [disabled if scheduled & no scheduled_at]
```

**States:**
- **Loading:** none (no async data — presets computed locally via `dayjs`).
- **Empty:** n/a. Quick-pick chip row is hidden if all presets are in the past (`quickPicks.length===0`).
- **Error:** n/a — the picker guards `scheduled_at > now+30min` and emits `undefined` (disabling Continue) rather than surfacing an error.
- **Variants:** `now` (info card) vs `scheduled` (quick picks + wheel picker).

**Interactions & haptics:** `ScheduleToggle` fires `Haptics.selectionAsync()` when switching to a different value; quick-pick chip tap fires `selectionAsync()` + seeds `scheduled_at`; inside `DateTimePicker` the date-chip tap fires `selectionAsync()` and each wheel tick (hour/minute snapping past a new value) fires `selectionAsync()` throttled by value-change. Selected chip = 2px primary border on tinted bg.

**Data:** `useBookingStore` (draftBooking, updateDraft, setStep). `buildQuickPicks(dayjs())` memoized once; `DateTimePicker` shows today+29 days (today only if >30min of headroom remains) and 24h/60m wheels.

**Navigation:** Continue → `setStep(3)` + `router.push('/(customer)/book/review')`.

---

### 3.4 Review & Confirm — `/(customer)/book/review`
**File:** `src/app/(customer)/book/review.tsx`  ·  **Purpose:** Show fare estimate, choose vehicle/pricing mode/offer, apply promo, pick payment, then submit the booking (step 4, index 3).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (bg-background)
├─ GradientHeader "Review & confirm"  [showBack · fallbackHref /(customer)/(tabs)]
│  └─ overline "New errand · Step 4"
├─ BookingStepIndicator currentStep=3
├─ ScrollView
│  ├─ Route Summary (pickup dot → hairline → drop-off square, typographic 2-line stack)
│  ├─ Distance & Time row ?  (estimate.distance_km set) [Route km · Clock ~ETA]
│  ├─ Pricing-mode underline tabs  [Fixed price | Make an offer]  (accessibilityRole tablist/tab)
│  ├─ pricingMode==='fixed' ?
│  │  ├─ VehicleTypeSelector ?  (!singleLocation & vehicleOptions>1)
│  │  └─ currentVehicleEstimate ?  PriceBreakdown (items + total)
│  │     |  estimateError ?  ErrorState (compact) [title "Couldn't calculate your fare" · onRetry=rerunEstimate]
│  │     |  else ?  fare skeleton (3 shimmer rows + total row, a11y "Calculating fare")
│  │  else (negotiate) ?  OfferSlider (amount input + slider + quick picks + suggested band)
│  ├─ PromoCodeInput
│  ├─ PaymentMethodSelector  [amount = fixed?totalAmount:offerPrice]
│  └─ spacer h-28
└─ BottomActionBar
   └─ Button  [fixed: "Confirm {total}" | "Fare unavailable"(error) | "Calculating fare…"; negotiate: "Send Offer {offer}"]
      loading=isSubmitting · disabled while fixed & (loading estimate or no estimate)
```

**States:**
- **Loading:** fare **skeleton** — 3 shimmer rows (opacity 0.6) + a total row, sized to match `PriceBreakdown`, labeled "Calculating fare" for a11y. `isEstimateLoading` also disables the CTA (shows "Calculating fare…").
- **Empty:** n/a.
- **Error:** RECENT FIX — estimate-failure path. `estimateError` renders a **compact `ErrorState`** ("Couldn't calculate your fare" / "Check your connection and try again." / `onRetry=rerunEstimate`) in place of the fare block, and fires `Haptics.notificationAsync(Error)` on the failed fetch. The CTA reads "Fare unavailable". This replaced the old bug where a failed estimate stranded the screen on a permanent disabled "Calculating fare…". Retry bumps `estimateAttempt` to re-run the guarded effect. Submit failures → `toast.error(err.message)`; pre-submit validation → `toast.warning(...)`.
- **Variants:** `fixed` (vehicle selector + breakdown) vs `negotiate` (OfferSlider, no vehicle selector); vehicle selector hidden for single-location errands or when only one allowed vehicle.

**Interactions & haptics:** pricing-mode tab tap fires `Haptics.selectionAsync()` (guards no-op re-tap) and seeds offer from `min_negotiate_fee` when switching to negotiate; `VehicleTypeSelector` and `OfferSlider` fire their own selection haptics (see 3.x). On successful submit: `Haptics.notificationAsync(Success)`. Estimate fetch is stale-race-guarded (`cancelled` flag). CTA shows `loading` spinner while submitting.

**Data:** `useBookingStore` (draftBooking, updateDraft, setStep, clearDraft, setActiveBooking); `getErrandTypeRule(slug)`; `bookingService.getEstimate` (effect on mount / coord changes / `estimateAttempt`) and `bookingService.createBooking`. Local ETA computed per-vehicle from `distance_km` + speed table. Payload maps sentinel `__`-prefixed payment ids to omitted `payment_method_id`.

**Navigation:** On submit success → `setActiveBooking(booking)`, `clearDraft()`, and if server returns `checkout_url` (online payment) opens the Xendit hosted checkout via `openCheckoutUrl(url, PAYMENT_RETURN_URL)`, then `router.replace('/(customer)/book/confirm?bookingId=…')`.

---

### 3.5 Searching / Confirm — `/(customer)/book/confirm`
**File:** `src/app/(customer)/book/confirm.tsx`  ·  **Purpose:** Post-submit matching screen — waits for a runner (countdown + pulse), then celebrates a match or offers retry/cancel.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1)
├─ LinearGradient backdrop (brand gradient — static, replaces old billed live map)
├─ PulseOverlay ?  (state==='searching') [3 expanding PulseRings + center dot]
├─ SafeAreaView overlay
│  ├─ spacer (flex-1, pushes card to bottom)
│  ├─ srOnly live region (accessibilityLiveRegion polite → STATE_ANNOUNCEMENTS)
│  └─ card (bottom sheet-style)
│     ├─ state==='searching' ?
│     │  ├─ "Looking for a runner nearby..."
│     │  ├─ rotating subtitle (SEARCHING_LINES, cycles ~5s)
│     │  ├─ "Your offer is visible to runners" ?  (pricing_mode==='negotiate')
│     │  ├─ countdown block  [accessibilityRole progressbar · mm:ss · label · progress track/fill]
│     │  ├─ "Booking: {number}" ?  (bookingNumber set)
│     │  └─ Button "Cancel Booking" (outline)
│     ├─ state==='matched' ?  SuccessCheck (celebrate, 88) + "Runner Found!" + "Redirecting to tracking..."
│     ├─ state==='no_runner' ?  XCircle(warning) + "No runners available" + escalating copy
│     │     + Button [retryStep 1:"Search again" 2:"Widen search area" 3:"Search a wider area"] ?  (retryStep≤3)
│     │     + Button "Go Home" (outline)
│     └─ state==='cancelled' ?  XCircle(danger) + "Booking Cancelled" + Button "Go Home"
└─ ConfirmModal "Cancel Booking" ?  (showCancelModal) [confirm "Yes, Cancel" · destructive · loading]
```

**States:** single `state` machine — `searching | matched | no_runner | cancelled`.
- **Loading:** the searching state IS the loading UI — animated `PulseOverlay` (reanimated rings) + a deadline-based countdown (fixed price 60s, negotiate 300s).
- **Empty:** n/a. Cold-launch guard: no `bookingId` → `toast.error('Booking session lost…')` + replace home.
- **Error / timeout:** countdown reaching 0 → `no_runner` (fires `Haptics.notificationAsync(Warning)`) with escalating widen-radius retry copy (retryStep 1→2→3); `retryMatch` failure → `toast.error`; cancel failure → `toast.error`.
- **Variants:** matched (RECENT — `SuccessCheck celebrate`, fires own success haptic on mount, then `setTimeout` 1200ms → tracking); cancelled (fires `impactAsync(Light)`); no_runner escalating messaging; negotiate vs fixed changes countdown length + adds "offer visible" line + progressbar label text.

**Interactions & haptics:** state-transition effect fires `notificationAsync(Warning)` on no_runner and `impactAsync(Light)` on cancelled (matched is intentionally silent — SuccessCheck self-haptics), plus `AccessibilityInfo.announceForAccessibility`. RECENT — rotating searching copy every 5s (interval torn down on leaving searching); countdown block carries `accessibilityRole="progressbar"` with `accessibilityValue {min,max,now,text}`. `useBackGuard` blocks Android back during search (2-tap-to-leave hint). Cancel → `ConfirmModal`.

**Data:** `useBookingStore` (activeBooking, setActiveBooking, draftBooking); `useBookingStatus(bookingId)` (Supabase Realtime — primary source of truth); `useForegroundInterval` runs the 1s countdown tick and a 30s safety-net poll (`bookingService.getBooking`, both paused when backgrounded); `AppState` listener re-syncs on foreground; `bookingService.cancelBooking` / `retryMatch`. `reactToStatus` maps `matched/accepted/heading_to_pickup → matched`, `cancelled`, `no_runner`.

**Navigation:** matched → `router.replace('/(customer)/tracking/{bookingId}')` after 1.2s; cancel confirm / Go Home / lost-session → `router.replace('/(customer)/(tabs)')`.

---

### 3.x Booking-funnel component notes

- **BookingStepIndicator** (`src/components/customer/`) — canonical 4-step indicator. Numbered circles (`Type/Details/Schedule/Review`), completed steps show `✓` glyph, active = filled primary + shadow, upcoming = bordered; connector line turns primary once completed. `accessibilityRole="progressbar"` with `accessibilityValue {min:1,max:4,now}`.
- **DateTimePicker** — horizontal date-chip strip (today+29 days, guarded to `now+30min`) + two `WheelPicker` wheels (hour 24h w/ AM·PM label, minute 60). Wheel scroll fires `Haptics.selectionAsync()` per new snapped value (throttled by value change); date-chip tap fires `selectionAsync()`. Emits `undefined` when combined time < `now+30min`. Summary card shows the resolved "Scheduled for …".
- **ScheduleToggle** — two large radio cards (Now / Schedule); `selectionAsync()` on change to a new value; `accessibilityState.selected`.
- **VehicleTypeSelector** — horizontal cards (walk/bicycle/motorcycle/car) with icon, label, tagline, price, ETA. Selected card = solid primary fill + white content + check badge; cheapest priced option shows a green "BEST" pill. Tap fires `Haptics.selectionAsync()`. Price bar shows a skeleton pill until `estimatedTotal>0`.
- **PaymentMethodSelector** — collapsed row (active method + `activeSub`, "Change") opening a `BottomSheet` (snap 0.6) listing saved methods then operator-enabled `STANDARD_OPTIONS` (wallet/gcash/maya/card/cash). Row tap fires `selectionAsync()`. Wallet row disabled + "Insufficient balance" when `walletBalance < amount`; auto-selects saved default or falls back to Cash. Data: `useQuery` for `['payment-methods']`, `['wallet','balance']`, `['available-methods']`. Loading = `ActivityIndicator` in the collapsed row.
- **PromoCodeInput** — bordered row with inline "Apply" pill. On success fires `notificationAsync(Success)` + `onApply(code, discount)`; on failure fires `notificationAsync(Error)` + inline error text (`accessibilityLiveRegion`). Applied state = green chip with code + remove (X). Loading = spinner inside Apply.
- **PhotoGrid** — "Item Photos (n/max)" with 80px thumbnails (expo-image) + dashed "Add" tile. Add fires `impactAsync(Light)`; remove (X badge) fires `notificationAsync(Warning)`.
- **OfferSlider** — editable ₱ amount TextInput + `@react-native-community/slider` (step 5) + 3 quick-pick chips around the recommended band + suggested-range card. Slider drag fires `selectionAsync()` per new step; quick-pick tap fires `selectionAsync()`. Slider max auto-grows to fit a typed amount above the ceiling; commit clamps to `min`.
- **SavedAddressSheet** — `BottomSheet` (snap 0.55) listing saved addresses (default first, star badge). States: `ActivityIndicator` (loading), empty state (MapPin + "No saved addresses yet" + "Add an address" CTA), or `FlatList` with a "Manage addresses" footer. Data: `useQuery(['user','addresses'], userService.getAddresses)` (enabled only after first open). Row tap → `onSelect(address)` + close; "Manage/Add" → `/(customer)/addresses` (deferred 120ms for close animation). No selection haptic in this component.
## 4. Customer Flow — Tracking, Wallet, Chat, Account

### 4.1 Live Tracking — `/(customer)/tracking/[id]`
**File:** `src/app/(customer)/tracking/[id].tsx`  ·  **Purpose:** Real-time "trip in progress" surface — status hero, opt-in live map, runner card, timeline, cancel/SOS.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
loading ? SafeAreaView > TrackingSkeleton
!booking && loadError ? SafeAreaView > ErrorState (full, onRetry=retryLoad)
!booking ? SafeAreaView > "Booking not found" + Button "Go Home"
View (root)
├─ absoluteFill map layer
│  ├─ !showMap ? LinearGradient (brand) + centered Pressable "View live map" [MapPin]
│  ├─ showMap ? HereMapView
│  │  ├─ HereMarker pickup "P"  ?
│  │  ├─ HereMarker dropoff "D"  ?
│  │  ├─ HereMarker runner (Bike + Animated pulse + km/h speed badge)  ?
│  │  └─ HerePolyline route-outline + route-fill  ? (routeMapCoords)
│  ├─ showMap ? Pressable "Hide map" [X]  (bottom-left)
│  ├─ realtime "live" pill (bottom-right) [Connecting… | Live | {km/h} · moving]  ? (runner_id)
│  └─ routeFetchState==='error' ? route-error chip "Couldn't load route" + Retry
├─ SafeAreaView (top, box-none) floating header
│  └─ row [back ArrowLeft · booking_number + STATUS_LABEL · ETA pill {min → pickup/drop-off}?]
├─ ExpandableSheet (initial="half")
│  ├─ renderHandle → JourneyBeads(status) + Live/Reconnecting dot? (runner_id)
│  ├─ footer → { Emergency SOS Button? (transport) | SOS-active banner? | Cancel Errand Button? (canCancel) }
│  └─ ScrollView
│     ├─ Hero  [eyebrow "Step N of M" · "Arriving in X min"|heroCopy.title · heroEtaLabel pill? · subtitle]
│     ├─ Transportation PIN card  ? (is_transportation && ride_pin)
│     ├─ Runner card  ? (runner_id)  [Avatar(verified) · name · RatingStars(readonly)+rating · phase pill]
│     │  └─ action row: Call [Phone] · Message [MessageCircle+unreadBadge?] · Share [Share2 · label "Shared" while in-flight] · Stop sharing (red text)? (trip_share_active)   ← Phase 3
│     ├─ Trip route  [StatusTimeline(timelineSteps)]   (always)
│     ├─ Trip details toggle ? (shopping budget | proof photos exist)
│     │  └─ detailsOpen ? Shopping summary card? + Proof photos card? (pickup/delivery/signature ExpoImage)
│     └─ shopping-paid notice ? (isShopping && picked_up_at && !cancellable)
├─ ConfirmModal (cancel — shows cancelPreview fee/reason)
└─ ConfirmModal (SOS)
```

**States:**
- **Loading:** `TrackingSkeleton` (only when no `cachedBooking` in store; cached snapshot renders instantly while `/bookings/{id}` revalidates).
- **Empty:** n/a (a booking always exists in the normal flow).
- **Error:** load failure → full-screen `ErrorState` "Couldn't load this errand" + `onRetry` (only when `loadError`, distinguished from a genuine 404 which falls to the "Booking not found" + Go Home dead-end). Route fetch failure → inline chip "Couldn't load route" + Retry (`retryRoute`, bypasses cache; second failure toasts). Action failures (cancel/SOS/call/share) → toast.
- **Variants:** status-driven `heroCopy` (pending / no_runner / matched / accepted / heading_to_pickup / arrived_at_pickup / picked_up / in_transit / arrived_at_dropoff / delivered|completed / cancelled); map opt-in `showMap`; realtime pill Connecting / Live / moving+km/h; `canCancel` gated (shopping bookings lock after `picked_up_at`); transportation-only SOS button + ride PIN; phase-aware route target (pickup vs dropoff).

**Interactions & haptics:** Forward status transitions (matched/accepted/arrived_at_pickup/arrived_at_dropoff) fire **Success notification haptic** + toast; first time runner is <250m from active pin fires **Medium impact haptic** + toast (once per phase, latched, re-arms >600m). `handleCancel` fires **Warning notification haptic** then opens ConfirmModal (fetches `cancelPreview`); `handleSOS` fires **Warning notification haptic** then opens SOS ConfirmModal. Call → `tel:` (masked-call TODO); **Share (Phase 3)** → `shareTrip`, reads the returned `link`, opens the OS share sheet via RN `Share.share({message,url})` (selection haptic; toast only on failure); **Stop sharing** → `revokeTrip` with an optimistic `trip_share_active` flip + rollback on error (Success notification haptic), shown only while `trip_share_active`. View live map / Hide map toggle; runner marker pulse animates only while speed>0. `useBackGuard` on live bookings ("tap back again to leave"). No pull-to-refresh — data stays fresh via realtime + adaptive `trackBooking` poll (20s healthy / 5s degraded).

**Data:** `useBookingStore` (setActiveBooking selector, cachedBooking, activeBooking watcher); `useChatStore` (refreshUnread, unreadByBooking[id]); `useLocationStore` (setRunnerLocation); `useRunnerTracking(id)` + `useBookingStatus(id)` (Supabase Realtime); `useEta(runner,target)`; `useForegroundInterval` (refreshUnread 30s; trackBooking poll); `bookingService` (getBooking, trackBooking, cancelPreview, cancelBooking, triggerSOS, shareTrip); `routeService` (getRoute, refreshRoute); local state (booking, statusLogs, loading, loadError, routeCoords, routeFetchState, showMap, detailsOpen, sos/cancel modals).

**Navigation:** back → `router.back()` else replace `/(customer)/(tabs)`; realtime `completed` → replace `/(customer)/rate/{id}`; confirmCancel → replace `/(customer)/(tabs)`; Message → push `/(customer)/chat/{id}`; Booking-not-found Go Home → replace tabs.

---

### 4.2 Rate Runner — `/(customer)/rate/[bookingId]`
**File:** `src/app/(customer)/rate/[bookingId].tsx`  ·  **Purpose:** Post-completion receipt + star rating with optional comment and quick-tags.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (top)
├─ ScrollView
│  ├─ Success header [CheckCircle · "Errand Completed!" · booking_number? · completed_at?]
│  ├─ Receipt  ? Card>Skeleton (loading) | Card>ErrorState(compact, onRetry) (error) | Card>PriceBreakdown (ready)
│  ├─ Rating Card
│  │  ├─ Avatar(xl) + "Rate {firstName}"
│  │  ├─ RatingStars (interactive, size 36, onChange=setRating)
│  │  ├─ QUICK_TAGS pills [Fast delivery · Friendly · Great communication · Careful with items]
│  │  └─ Input "Comment (optional)" (multiline, maxLength 500)
│  └─ Submit block: Button "Submit Review" (disabled rating===0) + Pressable "Skip"
└─ showSuccess ? success overlay [SuccessCheck(celebrate) · "Thanks for the feedback!"]
```

**States:**
- **Loading:** `bookingState==='loading'` → skeleton receipt inside Card (Skeleton label + 3 line rows + total row). Rating card stays fully usable.
- **Empty:** n/a.
- **Error:** `bookingState==='error'` → `ErrorState` **compact** inside Card "Couldn't load your receipt / You can still rate your runner below." + `onRetry=fetchBooking`. Submit failure → toast.
- **Variants:** `showSuccess` overlay (blocks touches, prevents double-submit); QUICK_TAG selected state derived from `comment.includes(tag)`. NOTE: the ₱20/50/100 **tip UI was removed** (API accepts only rating+comment).

**Interactions & haptics:** QUICK_TAG tap → **selection haptic** + appends phrase to comment (no-op if already present). RatingStars taps fire selection haptic (inside the component). Submit → `reviewBooking` → sets `showSuccess`; `SuccessCheck` fires its own **success haptic** and calls `onDone` → `setTimeout(finishAndGoHome, 450)`. Skip → finishAndGoHome.

**Data:** `useBookingStore` (setActiveBooking); `bookingService` (getBooking, reviewBooking); local state (booking, bookingState, rating, comment, isSubmitting, showSuccess). `priceItems` = base/distance/convenience/surcharge (+ promo discount if any).

**Navigation:** skip or post-submit → replace `/(customer)/(tabs)` (clears activeBooking).

---

### 4.3 Wallet — `/(customer)/wallet`
**File:** `src/app/(customer)/wallet/index.tsx`  ·  **Purpose:** Balance hero, payment-method rows, and date-bucketed transaction history with server-side type filter.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View
├─ GradientHeader "Wallet"  [back → /(customer)/(tabs)/profile · trailing "Download" (export CSV)]   ← Phase 3
├─ LinearGradient balance card
│  ├─ row [Wallet "Available Balance" · "PHP" chip]
│  ├─ balance ? white/15 placeholder (loading) | white-inset ErrorState(compact,onRetry) (error) | ₱balance (ready)
│  └─ actions [Pressable "Add money" → top-up · Pressable "Bookings" → activity tab]
├─ Payment methods section
│  └─ Card [ErrandGuy Wallet row + Check · Hairline · Pressable "Add payment method" → top-up]
├─ "Transactions" eyebrow
├─ filter chips [All · Top-ups · Payments · Refunds]   (server-side ?type=)
└─ SectionList (buckets Today/Yesterday/This Month/Earlier, sticky headers)
   ├─ renderItem → tx row [icon chip · display_description · relativeTime · ±amount · balance_after]
   ├─ RefreshControl
   └─ ListEmpty ? TransactionsSkeleton (initial) | ErrorState(onRetry) (failed) | EmptyState [Wallet]
```

**States:**
- **Loading:** balance → `white/15` placeholder box (only when balance null AND no cached data); transactions → `TransactionsSkeleton` (4 icon+line rows) in ListEmpty.
- **Empty:** `EmptyState` icon=Wallet "No transactions yet / Your wallet transaction history will appear here".
- **Error:** balance fetch failed w/ nothing cached → `ErrorState` **compact** (white inset on gradient) + retry; transactions failed → full `ErrorState` "Couldn't load transactions" + retry.
- **Variants:** type filter `null / top_up / payment / refund` (each its own cache key; only unfiltered list mirrors to store); positive types (top_up/refund/bonus) render green `+`, others `−`.

**Interactions & haptics:** filter chip tap → **selection haptic** + `setTxFilter` (no-op if already selected). Pull-to-refresh → `Promise.all(balanceQ.refresh, txQ.refresh)`. Add money / Add payment method rows → top-up. **Download (Phase 3)** → builds a CSV (Date · Description · Type · signed Amount · Balance) from the loaded transactions (written via `expo-file-system/legacy`, opaque-require guarded) and shares it via `expo-sharing.shareAsync` when available else RN `Share.share` — Light impact on tap, Success/Error notification haptics + toasts, guards an empty list and a missing native module.

**Data:** `useWalletStore` (balance, transactions, setBalance, setTransactions); `useAuthStore` (user.id); `useQuery` balanceQ `['wallet','balance',userId]` + txQ `['wallet','transactions',userId,filter]`; `paymentService` (getWalletBalance, getWalletTransactions({type})); date-bucketing memo.

**Navigation:** push `/(customer)/wallet/top-up`; push `/(customer)/(tabs)/activity`.

---

### 4.4 Add Money / Top-up — `/(customer)/wallet/top-up`
**File:** `src/app/(customer)/wallet/top-up.tsx`  ·  **Purpose:** Choose a top-up amount and open a Xendit hosted-checkout to fund the wallet.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View
├─ GradientHeader "Add Money"  [back → /(customer)/wallet]
├─ ScrollView
│  ├─ "Select Amount"
│  ├─ QUICK_AMOUNTS pills [₱100 · ₱200 · ₱500 · ₱1000]
│  ├─ Input "Or enter custom amount" (decimal-pad, sanitized) + "Min ₱50 · Max ₱50,000" hint
│  └─ secure-checkout note [ShieldCheck · "choose GCash, Maya, or card on Xendit"]
└─ BottomActionBar → Button "Add {amount}" (disabled if <MIN or >MAX, loading spinner)
```

**States:**
- **Loading:** CTA Button `loading` spinner while the invoice/checkout URL is created + sheet is open.
- **Empty:** n/a.
- **Error:** below-min / above-max → toast; no `checkout_url` → toast "Could not start checkout"; API failure → toast.
- **Variants:** quick-amount selected (primaryLight fill) vs custom-amount entered (mutually exclusive — selecting one clears the other).

**Interactions & haptics:** quick-amount tap → **selection haptic** (sets amount, clears custom). `handleTopUp` → `paymentService.topUpWallet({amount})` → `openCheckoutUrl(url, PAYMENT_RETURN_URL)` (in-app auto-returning sheet) → toast "balance will update once confirmed" → back or replace wallet. No optimistic credit (webhook-confirmed).

**Data:** `paymentService.topUpWallet`; `utils/browser` (openCheckoutUrl, PAYMENT_RETURN_URL); local state (amount, customAmount, loading); `sanitizeAmount` clamps to 2 decimals / strips leading zeros; MIN 50 / MAX 50,000 mirror server.

**Navigation:** on return → `router.back()` else replace `/(customer)/wallet`.

---

### 4.5 Chat Inbox — `/(customer)/chat`
**File:** `src/app/(customer)/chat/index.tsx` → renders `src/components/chat/ConversationList.tsx`  ·  **Purpose:** List of per-booking conversations, unread-first.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
ConversationList  (chatHrefPrefix="/(customer)/chat", fallbackHref=activity)
View
├─ GradientHeader "Messages"  [back → /(customer)/(tabs)/activity]
└─ FlatList (RefreshControl)
   ├─ renderRow → Card
   │  ├─ Avatar + unread badge?  (counterparty)
   │  └─ [name (bold if unread) · timeAgo] / subtitle (errand type · #booking) / preview row (Image?/Info? icon + text)
   └─ ListEmpty ? 5 skeleton conversation cards (loading) | ErrorState (error) | EmptyState [MessageCircle]
```

**States:**
- **Loading:** 5 skeleton rows shaped like conversation cards (SkeletonCircle + lines).
- **Empty:** `EmptyState` icon=MessageCircle "No conversations yet" (customer copy: "When you start an errand, your chat with the runner will appear here.").
- **Error:** `ErrorState` "Couldn't load messages" + `onRetry`.
- **Variants:** unread cluster sorted to top; unread rows bold name + primary timestamp + red count badge (9+ cap); preview prefixes "You: " for outgoing, shows "Photo"/"System update"/image+info icons.

**Interactions & haptics:** pull-to-refresh (`conversationsQ.refresh`); row tap → chat thread. No explicit haptics.

**Data:** `useQuery` `['chat','conversations',userId]` (staleTime 30s, TTL MEDIUM, disk-hydrated); `chatService.getConversations`; `useAuthStore` (user.id, role-from-prefix).

**Navigation:** push `` `${chatHrefPrefix}/${booking_id}` `` → `/(customer)/chat/{bookingId}`.

---

### 4.6 Chat Thread — `/(customer)/chat/[bookingId]`
**File:** `src/app/(customer)/chat/[bookingId].tsx`  ·  **Purpose:** Per-booking realtime message thread with typing indicator, unread divider, image send, and optimistic retry.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View
├─ GradientHeader {runnerName}  [back → activity · flush · trailing: Phone (disabled if no phone)]
└─ KeyboardAvoidingView
│  ├─ FlatList (inverted)
│  │  ├─ renderRow → day pill | "New messages" divider | system msg | image-only bubble | text bubble
│  │  │   └─ isMe ? delivery status row [Sending(Clock) | Failed·Tap to retry(AlertCircle+RotateCw) | Read(CheckCheck) | Sent(Check)]
│  │  ├─ ListFooter ? ActivityIndicator (loadingOlder)
│  │  └─ ListEmpty (scaleY:-1) ? spinner (initialLoading) | null (loadError) | "Say hello…"
│  ├─ loadError && no messages ? ErrorState(compact, onRetry=handleReload)
│  ├─ isTyping ? TypingIndicator (3 pulsing dots; static under Reduce Motion)
│  ├─ Quick messages horizontal ScrollView (CUSTOMER_QUICK_MESSAGES pills)
│  └─ Input row [Camera attach · TextInput(multiline) · Send button (spinner while sending)]
├─ ImagePickerModal
└─ ImageLightbox (previewUri)
```

**States:**
- **Loading:** initial fetch → `ActivityIndicator` in the (counter-flipped) ListEmpty slot.
- **Empty:** "Say hello — messages about this errand appear here."
- **Error:** first-load failure → `ErrorState` **compact** just above the composer (`handleReload`); the ListEmpty renders `null` in that case so it isn't doubled.
- **Variants:** `TypingIndicator` (per-booking, driven by `isTyping` broadcast); frozen "New messages" unread divider spliced above first unread from the other party; message bubble states pending(0.75 opacity)/failed(danger fill, tappable)/read/sent; image-only bubbles render bare (no chrome); system messages centered italic; day separators.

**Interactions & haptics:** Send tap → **Light impact**; send failure → **Error notification** + toast (restores input text). Camera attach tap → **Light impact**. Quick-message pill tap → **selection haptic** + send. Failed-message tap → **Light impact** retry; second failure → **Error notification** + toast. `onChangeText` → `sendTyping()` (throttled 2s broadcast). `markAsRead` fired on mount (only if unreadCount>0), on 1.2s-debounced incoming burst, and on app foreground. Image tap → ImageLightbox.

**Data:** `useChat(bookingId)` → messages, fetchMessages, sendMessage, sendMessageWithImage, retryMessage, markAsRead, loadOlder, hasMore, loadingOlder, unreadCount, isTyping, sendTyping. Under the hood (`src/hooks/useChat.ts`): `useChatStore` per-field selectors; disk cache hydrate + 100-msg trailing-debounced write; Supabase Realtime channel `chat:{bookingId}` (postgres_changes INSERT + `broadcast:typing` with TYPING_THROTTLE 2s / HOLD 3.5s) plus an 8s foreground polling fallback (noCache) that stops when backgrounded; optimistic temp-id sends that swap to canonical or flip to `failed`. Also `useAuthStore` (user), `useBookingStore` (activeBooking → runner name/phone when it matches bookingId), `useReducedMotion`, `chatService`.

**Navigation:** back → `/(customer)/(tabs)/activity`; trailing Phone → `tel:{runnerPhone}` (toast if unavailable).

---

### 4.7 Saved Addresses — `/(customer)/addresses`
**File:** `src/app/(customer)/addresses/index.tsx`  ·  **Purpose:** CRUD saved addresses with a map-pin + search picker and a one-tap default star.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View
├─ GradientHeader "Saved addresses"  [back → profile · trailing: "+ Add"/"Cancel" (resetForm)]
├─ loading ? AddressSkeleton (3 rows)
│  error ? ErrorState "Couldn't load your addresses" (onRetry=fetchAddresses)
└─ KeyboardAvoidingView > ScrollView (RefreshControl)
   ├─ showAdd ? Add/Edit form card
   │  ├─ HereMapView (180h) + center MapPin + search overlay (TextInput + results dropdown)
   │  ├─ address preview text
   │  ├─ label selector [Home · Work · Other] (+ custom-label Input if Other)
   │  └─ Button "Save Address"/"Update" (disabled while saving / no address)
   ├─ addresses.length===0 && !showAdd ? empty [LocationIllustration · "No saved addresses" · Button "Add an address"]
   └─ addresses.map → Card (onPress=edit)
      └─ [icon chip · label · address · is_default ? Default star-badge : tap-to-set-default Star] · Trash2
└─ ConfirmModal (delete)
```

**States:**
- **Loading:** `AddressSkeleton` (3 skeleton rows) — only when no cached query data.
- **Empty:** `LocationIllustration` + "No saved addresses / Save the places you go most for faster booking." + "Add an address" CTA (only when not adding).
- **Error:** `ErrorState` "Couldn't load your addresses" + retry (replaces the old bug where a failed fetch looked like an empty list).
- **Variants:** add/edit form open (`showAdd`/`editingId`); default address shows a filled Star "Default" pill, non-defaults show a tappable outline Star; label "other" reveals custom-label input; search results dropdown.

**Interactions & haptics:** label select → **selection haptic**; `handleSetDefault` → **selection haptic** then updateAddress + **Success notification haptic**; save success → **Success notification haptic**; `handleDelete` → **Warning notification haptic** + ConfirmModal. Map region change → 300ms-debounced reverse geocode; search → 400ms-debounced geocoding (proximity-biased). Pull-to-refresh; card tap → edit (star/delete taps `stopPropagation`).

**Data:** `useQuery` `['user','addresses',userId]` (staleTime 60s, TTL LONG); `userService` (getAddresses, addAddress, updateAddress, deleteAddress); `geocodingService` (reverse, search); `useDebounce`; `useAuthStore`; local form state.

**Navigation:** stays on screen (form toggles inline); back → profile.

---

### 4.8 Trusted Contacts — `/(customer)/trusted-contacts`
**File:** `src/app/(customer)/trusted-contacts/index.tsx`  ·  **Purpose:** Manage up to 5 SOS emergency contacts, set a primary, import from device contacts.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
loading ? SafeAreaView > ContactsSkeleton
View
├─ GradientHeader "Trusted Contacts"  [back → profile · trailing: {count}/5]
├─ info banner ("Primary (⭐) is called first during SOS. Tap the star to make primary.")
├─ FlatList (RefreshControl)
│  ├─ renderContact → row
│  │  ├─ [name · primary Star? (index 0) · relationship Badge] / [Phone · maskedPhone]
│  │  └─ actions: make-primary Star? (non-primary) · edit Pencil · delete Trash2
│  └─ ListEmpty ? ErrorState (loadError) | EmptyState [ContactIllustration]
├─ BottomActionBar → Button "Add Contact" (disabled at MAX 5)
├─ Modal (Add/Edit) [Import-from-contacts? · Name Input · Phone Input · relationship pills · Save]
└─ ConfirmModal (delete)
```

**States:**
- **Loading:** full-screen `ContactsSkeleton`.
- **Empty:** `EmptyState` (ContactIllustration) "No trusted contacts / Add people you trust to be notified during emergencies".
- **Error:** `ErrorState` "Couldn't load your contacts" + retry (in ListEmpty when `loadError`).
- **Variants:** primary = lowest priority (index 0) marked with a warning Star; MAX_CONTACTS=5 gates add; cache-first load (AsyncStorage `@trusted_contacts_cache`) then background sync; import-from-contacts button only when `expo-contacts` native module is present.

**Interactions & haptics:** `handleMakePrimary` → **selection haptic** then a two-write priority swap (with rollback of the first write on failure) → **Success/Error notification haptic** + toast on failure. Save → **Success notification haptic** (PH phone normalized + validated, else toast). `handleDelete` → **Warning notification haptic** + ConfirmModal. `handleImportFromContacts` → requests permission → `presentContactPickerAsync` → prefills name/phone + **selection haptic**. Pull-to-refresh (background fetch). NOTE: real "make primary" replaced the old fake drag-reorder.

**Data:** `userService` (getTrustedContacts, addTrustedContact, updateTrustedContact, deleteTrustedContact); `AsyncStorage` cache; optional `expo-contacts`; local state (contacts, loading, saving, refreshing, loadError, form fields, pendingDelete). RELATIONSHIPS = Parent/Spouse/Sibling/Friend/Other.

**Navigation:** back → profile; add/edit is a bottom-sheet Modal (no route change).

---

### 4.9 Payment Methods — `/(customer)/payment-methods`
**File:** `src/app/(customer)/payment-methods.tsx`  ·  **Purpose:** View/link/remove saved e-wallets and set a default, via Xendit linked accounts.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View
├─ GradientHeader "Payment Methods"  [back → /(customer)/(tabs)]
└─ ScrollView (RefreshControl)
   ├─ "Your linked accounts" eyebrow
   ├─ loading ? ActivityIndicator
   │  loadFailed ? ErrorState "Couldn't load your payment methods" (onRetry)
   │  methods.length===0 ? empty card [CreditCard · "No linked accounts yet"]
   │  : methods.map → row [icon · label · Default badge? · Linked/Pending status · set-default Star? · Trash2]
   ├─ "Link an e-wallet" eyebrow
   ├─ LINK_OPTIONS rows [GCash · Maya · GrabPay]  (Plus / spinner-while-busy)
   ├─ card note ("Choose Credit/Debit Card at checkout — saving cards coming soon")
   └─ Xendit security footer [ShieldCheck]
└─ ConfirmModal (remove)
```

**States:**
- **Loading:** `ActivityIndicator` (only when no cached query data).
- **Empty:** inline surface card "No linked accounts yet / Link an e-wallet below to pay in one tap next time."
- **Error:** `ErrorState` "Couldn't load your payment methods" + `onRetry`.
- **Variants:** per-method status `active` (green "Linked") vs `pending` (warning "Pending authorization…"); `is_default` badge (hidden while pending); linking-in-progress busy spinner + other rows dimmed/disabled.

**Interactions & haptics:** `handleLink` → `linkEwallet(channel)` → `openCheckoutUrl(action_url, PAYMENT_RETURN_URL)` (in-app sheet) → refresh + **Success notification haptic** + toast. `handleSetDefault` → `setDefaultMethod` + **Success notification haptic** (only for active non-default). Remove Trash2 tap → **Warning notification haptic** + ConfirmModal → `removePaymentMethod` + success toast. Pull-to-refresh.

**Data:** `useQuery` `['payment-methods',userId]` (staleTime 30s, TTL MEDIUM); `paymentService` (getPaymentMethods, linkEwallet, setDefaultMethod, removePaymentMethod); `utils/browser`; `useAuthStore`; local state (linking, removing, refreshing).

**Navigation:** back → `/(customer)/(tabs)`; opens Xendit authorize sheet in-app (returns via deep link).

---

### 4.10 Payment Complete — `/payment-complete`
**File:** `src/app/payment-complete.tsx`  ·  **Purpose:** Deep-link landing after a system-browser checkout return; shows success then role-based redirect.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (centered)
├─ SuccessCheck (72 — fires its own success haptic; deliberately no spinner)
├─ "Payment received"
└─ "Returning you to ErrandGuy… your balance updates once it's confirmed."
```

**States:**
- **Loading:** n/a (intentionally a success moment, not a loading one).
- **Empty:** n/a.
- **Error:** n/a (balances/booking status reconcile via the Xendit webhook regardless).
- **Variants:** redirect target branches on authenticated `role` (runner vs customer) so a runner isn't stranded in the customer navigator.

**Interactions & haptics:** `SuccessCheck` fires a **success haptic** on mount; a 1200ms timer auto-redirects (cleared on unmount).

**Data:** `useAuthStore` (role); `SuccessCheck`. Reached only when checkout ran in the system browser (fallback build without the `expo-web-browser` native module); the in-app sheet normally intercepts this URL itself.

**Navigation:** after 1.2s → replace `/(runner)/(tabs)` if `role==='runner'` else `/(customer)/(tabs)`.

---

### 4.11 Invite & Earn (Referral) — `/(customer)/referral`
**File:** `src/app/(customer)/referral.tsx`  ·  **Purpose:** Referral hub showing the user's own code with copy/share affordances, per-status reward stats (invited / qualified / earned), and a one-time "enter a friend's code" block that self-hides once a code has been redeemed.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Invite & Earn"  [showBack; fallbackHref (→ (customer)/(tabs)/profile)]
└─ ScrollView (RefreshControl; keyboardShouldPersistTaps="handled"; pb 40)
   ├─ loading ?  3× Skeleton (h180 hero · h92 stats · h120 code block)
   ├─ loadFailed ?  ErrorState [title "Couldn't load your referral info", onRetry → referralQ.refresh]
   └─ info ?  (px-5 column)
      ├─ Card (tone="tinted", padding lg) — hero
      │  ├─ Gift icon badge (primary circle)
      │  ├─ Text "Give a reward, get a reward" + subcopy
      │  ├─ Eyebrow "Your referral code"
      │  ├─ Pressable (→ handleCopy)  [code text letterSpacing 3 + Copy icon]
      │  └─ row: Button "Copy" (secondary, icon Copy → handleCopy) · Button "Share" (icon Share2 → handleShare)
      ├─ Eyebrow "Your rewards"
      ├─ Card (padding none, flex-row) — StatCell ×3 [Users "Invited" | BadgeCheck "Qualified" | Coins "Earned"] divided by w-px dividers
      └─ !alreadyReferred ?  Eyebrow "Have a code?" + Card (padding lg)
         ├─ subcopy
         ├─ Input [label "Referral code", autoCapitalize characters, uppercased onChange, maxLength 12, placeholder "e.g. ABC123"]
         └─ Button "Apply code" [fullWidth; loading=applying; disabled unless codeInput.trim()]
```

**States:**
- **Loading:** `referralQ.loading && !info` → three stacked `Skeleton` blocks (hero 180, stats 92, code 120) in a px-5 column.
- **Empty:** No dedicated empty state — with a successful response `info` is always populated (counts default to 0, code always present). If `info` is falsy and not loading/errored, renders `null`.
- **Error:** `referralQ.error && !info` → full `ErrorState` with retry. Mutation errors surface via `toast.error` (message from the 422, e.g. invalid / self / already-referred), not the ErrorState.
- **Variants:** `alreadyReferred` (from persisted flag or an "already"-matching apply error) removes the entire "Have a code?" block. "Invited" = pending+qualified+rewarded; "Qualified" = qualified+rewarded; "Earned" = `formatCurrency(total_earned)`. Share message is personalized with the user's first name when available.

**Interactions & haptics:**
- **Copy** (code Pressable or Copy button) → `Haptics.impactAsync(Light)`, `Clipboard.setStringAsync(referral_code)`, then `toast.success('Referral code copied')`.
- **Share** button → `Haptics.impactAsync(Medium)`, RN `Share.share({ message })` with the personalized invite + `share_link`; silently swallows dismissal/unavailable.
- **Apply code** → `userService.applyReferral(code)`; on success `Haptics.notificationAsync(Success)` + success toast, clears input, sets `alreadyReferred`, persists `referral_applied:<userId>='1'`; on failure `Haptics.notificationAsync(Error)` + error toast (and if message matches `/already/i`, also sets+persists the flag). Guarded against double-submit via `applying`.
- **Pull-to-refresh** → `referralQ.refresh()`.

**Data:**
- `useQuery(['user','referral', userId], userService.getReferral)` → `ReferralInfo` (`referral_code`, `share_link`, `counts{pending,qualified,rewarded}`, `total_earned`); `staleTime 30s`, `ttl CacheTTL.MEDIUM`. Service `GET /user/referral` (30s cache, silent).
- `userService.applyReferral(code)` → `POST /user/referral/apply`; on resolve invalidates `['user','referral']`.
- `useAuthStore` for `user.id` (→ query key + persist key) and `user.full_name` first name (→ share copy).
- `storage` (async KV): reads/writes per-user flag `referral_applied:<userId>` to persist redemption across sessions since the profile endpoint doesn't expose `referred_by`.
- `toast` store for copy/apply feedback.

**Navigation:** Header back → `(customer)/(tabs)/profile` via `fallbackHref`. No outbound navigation; all actions stay on-screen (clipboard, native share sheet, toasts).

---

### 4.12 Promos & Offers — `/(customer)/promos`
**File:** `src/app/(customer)/promos.tsx`  ·  **Purpose:** Read-only list of currently-redeemable promo codes as ticket-style cards, each showing the discount, terms (min spend / expiry), and a one-tap copy-to-clipboard button.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Promos & offers"  [showBack; fallbackHref → (customer)/(tabs)/profile]
└─ ScrollView (RefreshControl; contentContainerStyle = flexGrow:1 when empty | pb-40 otherwise)
   ├─ loading ?  Skeleton × 3  [height 128, radius 16]  (px-5)
   ├─ loadFailed ?  ErrorState("Couldn't load promos", onRetry → refresh)
   ├─ empty ?  EmptyState(icon Ticket, "No promos right now")
   └─ promos.map → Card (padding lg, mb-4)  × N
      ├─ header row: Ticket badge (bg-primaryLight) + formatDiscount(promo) + promo.description ?
      ├─ dashed "ticket" divider (border-t border-dashed) → code block
      │  ├─ "CODE" label + promo.code (letterSpacing 1.5, text-primary)
      │  └─ Pressable "Copy"  [Copy icon; bg-primaryLight pill; a11yLabel "Copy promo code {code}"] (→ clipboard)
      └─ terms row ? (promo.min_order != null || expiry)
         ├─ "Min. spend {formatCurrency(min_order)}" ?
         └─ "Expires {formatExpiry(valid_until)}" ?
```

**States:**
- **Loading:** `loading = promosQ.loading && !promosQ.data` (no cached data yet) → three 128px `Skeleton` cards.
- **Empty:** `promos.length === 0` and not loading → `EmptyState` with `Ticket` icon; container uses `flexGrow:1` to center it.
- **Error:** `loadFailed = !!promosQ.error && promos.length === 0` → `ErrorState` with retry that calls `promosQ.refresh()`. (Cached promos suppress the error state; refresh silently retries.)
- **Variants:** Discount label branches on `discount_type` — `percentage` → "N% off" (+ " (up to ₱X)" when `max_discount` set) vs. fixed → "₱X off". `description`, `min_order`, and `valid_until` each render only when present; invalid/unparseable `valid_until` yields no expiry line.

**Interactions & haptics:** Copy button → `Haptics.impactAsync(ImpactFeedbackStyle.Light)` (fire-and-forget, `.catch()` swallowed), then `Clipboard.setStringAsync(code)` and `toast.success("Copied {code}")`. Pull-to-refresh drives a local `refreshing` flag around `promosQ.refresh()` (no haptic).

**Data:** `useQuery<Promo[]>(['promos', userId], …)` where `userId` = `useAuthStore((s) => s.user?.id ?? 'anon')`; fetches `configService.getPromos()` (`GET /promos`, silent, 60s cache) reading `res.data.data`. Options: `staleTime 60_000`, `ttl CacheTTL.MEDIUM`. `toast` from `toastStore`; `formatCurrency` for peso amounts. No realtime channels.

**Navigation:** No outbound navigation from cards. Header back button pops the stack, falling back to `(customer)/(tabs)/profile` when there is no back entry.

---

### 4.13 Support Tickets — `/(customer)/support`
**File:** `src/app/(customer)/support/index.tsx`  ·  **Purpose:** Support-ticket inbox reachable by both roles (customers via Help; runners enter from their Help screen — `(customer)/_layout.tsx` lets the `support` subtree through for runners). Lists the caller's own tickets with a compose sheet for opening a new one.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Support"  [showBack; fallbackHref "/(customer)/help"]
├─ FlatList (data=tickets; RefreshControl pull-to-refresh; pb 120, flexGrow:1 when empty)
│  ├─ renderItem → ticket row (Pressable, → /(customer)/support/{id})
│  │   ├─ subject (montserrat-bold, 1 line) + Badge[status meta]  (ml-2)
│  │   ├─ preview ? latest_message.content (textSecondary, 1 line)
│  │   ├─ when ? formatRelativeTime(last_message_at ?? created_at)  (textMuted)
│  │   └─ ChevronRight (textMuted)
│  └─ ListEmptyComponent ?  TicketsSkeleton (initialLoading) | ErrorState(onRetry) | EmptyState(Headphones, action "New ticket")
├─ FAB "New ticket" ?  {tickets.length>0}  (absolute, Plus icon, bg-primary, above insets.bottom+20)
└─ Modal (compose sheet; slide, transparent, bottom sheet, KeyboardAvoidingView, maxHeight 92%)  ?  {composeOpen}
   ├─ header row: "New ticket" + close X (→ closeCompose, blocked while submitting)
   └─ ScrollView
      ├─ Input "Subject"  [maxLength 200, placeholder "What's this about?"]
      ├─ "Category" + chip row × CATEGORIES  [General · A booking · Payments · My account · Safety · Other]  (selected = bg-primary/white)
      ├─ "Message" TextInput  [multiline, maxLength 2000, minHeight 110]
      └─ Button "Create ticket"  [loading=submitting; disabled unless subject & message non-empty]
```

**States:**
- **Loading:** `initialLoading` (`ticketsQ.loading && !data`) → `TicketsSkeleton` (3 shimmer rows) as `ListEmptyComponent`.
- **Empty:** no tickets, not loading/failed → `EmptyState` (Headphones icon, "No support tickets yet", CTA "New ticket" opens compose). FAB is hidden in this state — the empty-state CTA is the sole entry point.
- **Error:** `failed` (`ticketsQ.error && !data`) → `ErrorState` "Couldn't load your tickets" with `onRetry → ticketsQ.refresh()`. Create failure → `toast.error` (server message or "Could not create ticket"), sheet stays open.
- **Variants:** Ticket Badge driven by `STATUS_META` — `open`→"Open" (soft), `pending`→"Awaiting reply" (warning), `resolved`→"Resolved" (success), `closed`→"Closed" (neutral). FAB shown only once list has content (`tickets.length>0`).

**Interactions & haptics:** Ticket row tap → `selectionAsync()`. Category chip → `selectionAsync()`. Empty-state CTA → `selectionAsync()`. FAB → `impactAsync(Light)`. Successful create → `notificationAsync(Success)`; create error → `notificationAsync(Error)`. All haptics `.catch(() => {})`. Submit guarded by `canSubmit` (subject & message trimmed non-empty) and `submitting`; on success closes sheet, resets fields, refreshes list, then pushes to the new ticket detail if `ticket.id` present.

**Data:** `useQuery(['support','tickets', userId], supportService.getTickets)` (`staleTime 15_000`, `ttl CacheTTL.MEDIUM`; underlying `GET /support/tickets` is `silent` with a 5s micro-cache). `userId` from `useAuthStore(s => s.user?.id ?? 'anon')`. Compose submits `supportService.createTicket({subject, category, message})` → `POST /support/tickets` (opens ticket + first message), which invalidates `['support','tickets']`. Toast via `stores/toastStore`. No realtime channel on this screen. Service also exposes `getTicket` (cursor-paged) and `postMessage` used by the detail screen.

**Navigation:** GradientHeader back → `/(customer)/help` fallback. Ticket row and successful create → `/(customer)/support/{id}`. No tab bar (pushed stack screen).

---

### 4.14 Support Thread — `/(customer)/support/[id]`
**File:** `src/app/(customer)/support/[id].tsx`  ·  **Purpose:** One support ticket's chat thread — inverted message list with day separators, cursor-paged "load older", optimistic composer send with rollback, and a live status Badge in the header.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader  [title = ticket.subject | "Support"; showBack; fallbackHref="/(customer)/support"; flush]
│  └─ trailing ?  Badge {label,variant from STATUS_META[ticket.status]}   (open→soft · pending→"Awaiting reply"/warning · resolved→success · closed→neutral)
└─ KeyboardAvoidingView (ios: padding, offset 90)
   ├─ FlatList (inverted; paddingVertical 12; onEndReached → loadOlder @ threshold 0.4)
   │  ├─ renderRow → day separator ?  (pill "bg-divider/60", formatChatDayLabel)   × per calendar-day boundary
   │  ├─ renderRow → system msg ?  (centered italic textSecondary, no bubble)
   │  ├─ renderRow → user msg (isMe: items-end, bg-primary, rounded-br-sm, white text; opacity 0.7 + "Sending…" when pending)
   │  ├─ renderRow → agent msg (items-start, bg-surface border-divider rounded-bl-sm; sender.full_name | "Support" label above)
   │  ├─ ListFooter ?  ActivityIndicator (loadingOlder)   ← renders at visual top under inverted list
   │  └─ ListEmpty ?  ActivityIndicator (initialLoading) | null (loadError) | "No messages yet." text   [scaleY:-1 to un-invert]
   ├─ ErrorState(compact, onRetry=loadInitial) ?  when loadError && messages.length===0
   └─ composer row (border-t, bg-surface, paddingBottom = max(insets.bottom,12))
      ├─ TextInput (multiline, maxHeight 120 / minHeight 40; editable = !sending)
      └─ Pressable send (→ handleSend)  [bg-primary | bg-dividerStrong when sending/empty]  → ActivityIndicator (sending) | Send icon
```

**States:**
- **Loading:** `initialLoading` true on mount → ListEmpty shows a small primary `ActivityIndicator`. Older-page fetch shows `loadingOlder` spinner in `ListFooterComponent`.
- **Empty:** not loading, no error, `messages` empty → centered "No messages yet." (wrapped in `scaleY:-1` to counter the inverted list).
- **Error:** `loadError` set on initial fetch failure → ListEmpty renders `null` and a compact `ErrorState` with `onRetry={loadInitial}` shows above the composer (only while `messages.length===0`). `loadOlder` failures are silent (scroll up to retry).
- **Variants:** Message rows branch on `sender_type` — `user` (right/primary bubble), `agent` (left/surface bubble with sender name), `system` (centered italic, no bubble). Pending user bubble = 0.7 opacity + "Sending…" timestamp. Header Badge variant/label driven by `STATUS_META[ticket.status]` (falls back to `open`).

**Interactions & haptics:** Send button `onPress` fires `Haptics.impactAsync(ImpactFeedbackStyle.Light)` then `handleSend()`. `handleSend` clears the input, appends an optimistic `pending` bubble (`temp-<Date.now()>` id), and on `postMessage` success swaps the temp row for the saved message and flips a resolved/closed ticket's local status to `pending`. On failure: `Haptics.notificationAsync(NotificationFeedbackType.Error)`, `toast.error('Failed to send message')`, drops the optimistic bubble, and restores the typed text for retry. Scrolling to `onEndReached` (top of inverted list) triggers `loadOlder`, guarded by `hasMore` + `loadingOlderRef`.

**Data:** No react-query — plain `useState` + `supportService` (raw `api`). `loadInitial` → `supportService.getTicket(id)` sets `ticket`, `messages`, `hasMore`, `nextBefore`. `loadOlder` → `getTicket(id, { before: nextBefore })`, prepends the ASC older page to the chronological list and advances the `next_before` cursor. `handleSend` → `supportService.postMessage(id, text)`; that service call invalidates `['support','tickets']` so the inbox list re-orders. Rows are derived via `buildRows` (reverses chronological messages, inserts day separators at calendar-day boundaries).

**Navigation:** Entered from the support ticket list with `id` param (`useLocalSearchParams`). Header back returns to `/(customer)/support` (via `fallbackHref`). No outbound navigation from this screen.

---

## 5. Runner Flow — Core (tabs)

### 5.0 Runner Tab Bar — `(runner)/(tabs)/_layout.tsx`
**File:** `src/app/(runner)/(tabs)/_layout.tsx`  ·  **Purpose:** Floating pill tab bar shell for the four runner core tabs (Home, Earnings, History, Profile).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
Tabs  (headerShown:false · animation:'shift' · freezeOnBlur · lazy · floating pill tabBarStyle, absolute/rounded-999/Elevation shadow)
├─ Tabs.Screen "index"    → TabBarItem name="home"   [showOnlineDot = isOnline (runnerStore)]
├─ Tabs.Screen "earnings" → TabBarItem name="wallet"
├─ Tabs.Screen "history"  → TabBarItem name="time"
└─ Tabs.Screen "profile"  → TabBarItem name="person"
```

**States:**
- **Loading:** n/a (layout only)
- **Empty:** n/a
- **Error:** n/a
- **Variants:** Home icon shows a live green online dot when `isOnline` is true (via `showOnlineDot`); active tint = `LightColors.primary`, inactive = `textMuted`; labels hidden (icon-only); `tabBarHideOnKeyboard`; bottom float gap computed from safe-area inset.

**Interactions & haptics:** Standard tab switching (no explicit haptics at this layer). `freezeOnBlur`+`lazy` freeze off-screen tabs so History stops re-rendering while Home receives GPS pings.

**Data:** `useRunnerStore(s => s.isOnline)` for the Home online dot; `useSafeAreaInsets()` for float offset.

**Navigation:** Declares the four tab routes; per-tab navigation lives in each screen.

---

### 5.1 Runner Dashboard / Home — `(runner)/(tabs)/index.tsx`
**File:** `src/app/(runner)/(tabs)/index.tsx`  ·  **Purpose:** Runner home anchored on the online-status toggle + today's earnings hero, with active errand, offers, shortcuts, and recent errands.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View bg-background
├─ StatusBar (iOS only)
├─ ScrollView (RefreshControl)
│  ├─ HERO  View bg-background → SafeAreaView edges=[top]
│  │  ├─ Greeting row
│  │  │  ├─ Pressable → Avatar (sm)              (→ profile tab)
│  │  │  ├─ "Welcome back" / {firstName}
│  │  │  └─ Pressable Bell + unread dot ?        (→ notifications)
│  │  └─ Earnings hero  LinearGradient (blue balance card, Elevation.md)
│  │     ├─ row
│  │     │  ├─ left col:  earningsFailed ? ErrorState (compact, on white inset, onRetry=onRefresh)
│  │     │  │             | "Today's earnings" + formatCurrency(today) + updatedLabel? + "This week · {week}" (TrendingUp)
│  │     │  └─ right: online toggle (72×72)
│  │     │     ├─ Animated.View pulse ring ?  (isOnline && !reduceMotion)
│  │     │     └─ Pressable Power  [disabled if togglingOnline||!canGoOnline]
│  │     ├─ Daily goal:  (dailyGoal && goalProgress) ? [ "{today} of {goal} goal" + Pencil edit btn + progress bar + "Daily goal reached"? ]
│  │     │                                            | Pressable "Set a daily goal" (Pencil, underline)
│  │     └─ Status caption row  [dot(green if online) + statusCaption]
│  ├─ VerificationBanner ?            (!canGoOnline, overlaps hero -mt-3)
│  ├─ Location nudge ?                (canGoOnline && locationGranted===false → "Turn on location" + Enable btn)
│  ├─ ActiveRunnerErrandCard ?        (activeErrand present → errand/[id])
│  ├─ Lifetime strip:  eyebrow "Lifetime"
│  │     lifetimeFailed ? ErrorState (compact, onRetry=onRefresh)
│  │     | 3-col hairline row [Errands · Rating(Star) · Acceptance%]
│  ├─ Open offers ?                   (isOnline && offers>0 → eyebrow + "{n} WAITING" + NegotiateOfferCard[] → errand/[id])
│  ├─ Shortcuts grid  [Earnings · History · Areas · Errand types · Busy areas (TrendingUp → demand)]   ← Phase 3
│  └─ Recent ?                        (recentErrands>0 → eyebrow + "See all" link + ≤3 hairline rows → errand/[id])
├─ IncomingRequestModal ?            (incomingRequest present)
└─ Modal (daily goal editor, slide-up bottom sheet + KeyboardAvoidingView)
   ├─ "Set/Edit daily goal" + TextInput(₱, number-pad)
   ├─ Button "Save goal"
   ├─ Pressable "Remove goal" ?  (dailyGoal set)
   └─ Pressable "Cancel"
```

**States:**
- **Loading:** `initialLoading` (profile+history both loading, no cached data) → full-screen `RunnerHomeSkeleton`.
- **Empty:** No dedicated empty screen. Recent/Offers sections simply omit when their arrays are empty; a fresh runner with ₱0 shows a legitimate `formatCurrency(0)` hero (only suppressed on error, see below).
- **Error:** `earningsFailed` (today OR week query errored with nothing cached) → `ErrorState compact` on a white inset inside the hero left column, `onRetry=onRefresh`. `lifetimeFailed` (profile query errored, no cache, no store profile) → `ErrorState compact` replacing the Lifetime 3-col row, `onRetry=onRefresh`. Toggle-online failures surface via `toast` (warning/error) + Error notification haptic, not inline.
- **Variants:** online / offline; `canGoOnline` (verification approved) vs verification-required (toggle muted, `accessibilityLabel="Verification required"`); `locationGranted===false` nudge; daily-goal set (progress bar, "reached" when ≥100%) vs unset ("Set a daily goal"); `activeErrand` present; incoming request overlay; `statusCaption` computes one of: "Verification required" / online / "Location off" / "Tap the power button to go online".

**Interactions & haptics:**
- **Go online/offline toggle** — `Haptics.impactAsync(Medium)` on press (instant ack); then on server outcome `notificationAsync(Success)` when tracking starts / offline, or `notificationAsync(Error)` on failure/rollback. Pre-checks preferred-types & verification (redirects with toast.warning) before calling. Robust GPS via `getCurrentCoords` (permission+timeout+last-known); on tracking-start failure it rolls status back to offline.
- **Accept incoming errand** — server-confirmed → `notificationAsync(Success)`, routes to errand; failure → `notificationAsync(Error)` + toast, clears request.
- **Daily goal** — `openGoalModal` fires `selectionAsync`; `saveGoal` (valid n>0) fires `notificationAsync(Success)`.
- **Pull-to-refresh** — refreshes profile, today/week earnings, history, current errand, and offers (only if online).
- **Pulse ring** — infinite scale/opacity loop around Power while online, frozen under `useReducedMotion`.
- Avatar tap → profile; Bell tap → notifications; Shortcut cards, Recent rows, See-all, active card all navigate (no per-tap haptic on those).

**Data:** stores — `useAuthStore` (user, role), `useRunnerStore` (isOnline, toggleOnline, currentErrand, incomingRequest, earnings, setEarnings, runnerProfile, setRunnerProfile, accept/decline), `useLocationStore` (startTracking/stopTracking), `useNotificationStore` (unreadCount). `useQuery` keys (all `enabled = role==='runner'`): `['runner','profile',userId]`, `['runner','earnings','today',userId]`, `['runner','earnings','week',userId]`, `['runner','errands','recent',userId]` (per_page 3), `['runner','errand','available',userId]` (enabled only when online, SHORT ttl), `['runner','errand','current',userId]`. Realtime: `useIncomingRequest(isOnline&&userId ? userId : null)`. Polling fallback: `useForegroundInterval` refreshes current-errand every 30s while online; a ref-guarded effect promotes a freshly `matched` booking into `setIncomingRequest`. Daily goal persisted via `storage` at `@eg_runner_daily_goal:{userId}`. "Updated Xm ago" from `lastUpdatedAt` + 60s `setMinuteTick` interval, formatted with `formatRelativeTime`.

**Navigation:** profile tab, `/(runner)/notifications`, `/(runner)/settings/preferred-types`, `/(runner)/settings/documents`, `/(runner)/errand/{id}`, earnings tab, history tab, `/(runner)/settings/working-areas`, `/(runner)/demand` (Busy areas — Phase 3).

---

### 5.2 Runner Earnings — `(runner)/(tabs)/earnings.tsx`
**File:** `src/app/(runner)/(tabs)/earnings.tsx`  ·  **Purpose:** Earnings summary hero + period tabs + weekly bar chart + per-errand list grouped by day, with a payout CTA.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View bg-background
├─ GradientHeader "Earnings"
└─ ScrollView (RefreshControl)
   ├─ Hero:  summaryFailed ? Card → ErrorState (compact, onRetry=summaryQ.refresh)
   │         | LinearGradient balance card [periodLabel + formatCurrency(total) + "{n} errands" chip + "Avg {x}" chip]
   ├─ Period tabs  (underline strip) [Today · This week · This month]
   ├─ Breakdown Card ?           (!summaryFailed → KeyValueRow: Total errands / Avg per errand / Hairline / Total(emphasis))
   ├─ Weekly chart ?             (period==='week' && weekChart.max>0 → Eyebrow "Daily breakdown" + Card)
   │     └─ 7 bars Mon–Sun  [best day = primary, others = primaryMuted, empty = divider stub; today label bold-primary; ₱ label above]
   └─ Per-errand  Eyebrow "Per-errand"
         historyFailed ? ErrorState (compact, onRetry=historyQ.refresh)
         | earningsList empty ? EmptyState (Wallet, "No earnings yet", CTA "Go online to start earning")
         | earningsByDay[] groups  [day header "{label}" + subtotal, then rows: type + time + payout, Hairline between]
   ├─ Button "Request Payout" (outline)
   └─ Export section  [Button "Export CSV" · Button "Download PDF"]  (both disabled while exporting)   ← Phase 3
```

**States:**
- **Loading:** `initialLoading` (summary or history loading with no cached data) → `GradientHeader` + custom `EarningsSkeleton` (mirrors real layout: hero block, period tabs, breakdown card, 4 per-errand rows using `Skeleton`).
- **Empty:** Per-errand `EmptyState` — icon `Wallet`, title "No earnings yet", description "Completed errands for this period will show up here.", CTA "Go online to start earning" → home tab.
- **Error:** BOTH `summaryFailed && historyFailed` → full-screen `ErrorState` ("Couldn't load your earnings", `onRetry=retryAll`) under the header. `summaryFailed` alone → hero replaced by `Card`+`ErrorState compact` (retry summary), and the Breakdown card is hidden (avoids repeating fake ₱0.00). `historyFailed` alone → `ErrorState compact` (retry history) in the per-errand slot.
- **Variants:** period `today` / `week` / `month`; weekly bar chart renders only for `week` with `max>0`; breakdown chips reflect summary counts.

**Interactions & haptics:** `selectPeriod` → `Haptics.selectionAsync()` then setPeriod. Pull-to-refresh (refreshes summary + history). Payout button navigates. Chart bars are non-interactive but each is an accessible node ("{Day}[, today]: {amount}[, best day]"). **Export CSV (Phase 3)** → builds a CSV (Date · Errand type · Payout) from the loaded `earningsList`, writes to `FileSystem.cacheDirectory`, and opens `Share.share({url})`. **Download PDF** → `FileSystem.downloadAsync(API_URL + '/runner/earnings/export?period=…')` with the auth token header (period forwarded so the PDF matches the on-screen summary), then shares. Both fire Success/Error notification haptics + toasts and disable while in-flight.

**Data:** `useRunnerStore` (earnings, setEarnings — destructured, not driving render), `useAuthStore` userId. `useQuery`: `['runner','earnings',period,userId]` (summary), `['runner','earnings','history',period,userId]` (per_page 50 today / 100 otherwise, `date_from` computed to match the selected window). `runnerService.getEarnings` / `getEarningsHistory`. PDF export hits `GET /runner/earnings/export` (dompdf) with `secureStorage` token. Derived: `earningsByDay` (Map grouped by calendar day with Today/Yesterday labels + subtotals) and `weekChart` (7 zero-filled Mon–Sun totals, max, bestIdx, todayIdx). `compactAmount` for bar labels.

**Navigation:** `/(runner)/payout` (Request Payout), `/(runner)/(tabs)` home (empty-state CTA).

---

### 5.3 Runner History / Errands — `(runner)/(tabs)/history.tsx`
**File:** `src/app/(runner)/(tabs)/history.tsx`  ·  **Purpose:** Searchable, filterable, paginated list of past errands (completed/cancelled) with payout + route preview.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View bg-background
├─ GradientHeader "Errands"  [trailing: MessageCircle + chatUnread badge → chat]
├─ Search row  [Search icon + TextInput "Search errands" (underline)]
├─ Status filter tabs (underline) [All · Completed · Cancelled]
└─ FlatList (RefreshControl · onEndReached infinite scroll)
   ├─ item → Card (mx-5)
   │  ├─ top row: type + Badge(Completed=success | Cancelled=danger) · date + payout(muted if cancelled)
   │  └─ route: timeline beads (pickup dot → dashed → dropoff dot?) + pickup/dropoff addresses
   ├─ ListEmptyComponent:
   │     page1Failed ? ErrorState (onRetry=page1Q.refresh)
   │     | searchActive ? RunnerEmptyState (SearchX, "No matches for \"{q}\"", CTA "Clear search")
   │     | RunnerEmptyState (ClipboardList, "No completed errands")
   └─ ListFooterComponent:
         loadingMore ? ActivityIndicator
         | loadMoreFailed ? Pressable "Couldn't load more · Tap to retry" (RefreshCw)
         | null
```

**States:**
- **Loading:** `initialLoading` (page-1 loading, no cache) → `GradientHeader` + `HistorySkeleton`.
- **Empty:** two `RunnerEmptyState` variants — search zero-result (`SearchX`, eyebrow "No results", "No matches for \"{query}\"", CTA "Clear search" → clears search) vs genuine empty history (`ClipboardList`, eyebrow "No history yet", "No completed errands", no CTA).
- **Error:** page-1 fetch failed with no cache (`page1Failed`) → `ErrorState` in the list body, `onRetry=page1Q.refresh`. Pagination failure (`loadMoreFailed`) → inline footer retry Pressable (blocks auto `onEndReached` re-trigger until tapped).
- **Variants:** status filter All/Completed/Cancelled; `searchActive` (debounced) toggles between the two empty states; `loadingMore` footer spinner vs `loadMoreFailed` footer.

**Interactions & haptics:** Filter tab tap → `Haptics.selectionAsync()` + reset pagination. Card tap → `Haptics.impactAsync(Light)` then navigate. Footer retry tap → `Haptics.impactAsync(Light)` + `fetchNextPage`. Pull-to-refresh (resets to page 1). Infinite scroll via `onEndReached` (threshold 0.3, guarded by hasMore/loadingMore/loadMoreFailed). Client-side search filter over booking_number/pickup/dropoff/type.

**Data:** `useAuthStore` userId, `useChatStore` unreadCount (header badge). `useQuery` key `['runner','errands','history',statusFilter,userId]` (page-1, per_page 15, cache-first); subsequent pages fetched imperatively via `runnerService.getErrandHistory` and appended to `extraPages` state. `useDebounce(search,300)`. FlatList perf: maxToRenderPerBatch 10, windowSize 5, removeClippedSubviews.

**Navigation:** `/(runner)/chat` (header messages), `/(runner)/errand/{id}` (row tap).

---

### 5.4 Runner Profile — `(runner)/(tabs)/profile.tsx`
**File:** `src/app/(runner)/(tabs)/profile.tsx`  ·  **Purpose:** Runner identity, performance metrics, account/preferences menus, logout, and account deletion.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View bg-background
├─ GradientHeader "Profile"
├─ ScrollView (RefreshControl)
│  ├─ Identity row  [Avatar(lg) + name + Star rating + "· {n} errands" + "Verified runner"(BadgeCheck)?]
│  ├─ Performance  eyebrow "Performance"
│  │     (loadFailed && !runnerProfile) ? ErrorState (compact, onRetry=refreshAll) in hairline box
│  │     | [ 3× PerformanceMetric rings: Acceptance(status good/warning) · Completion(status good/warning) · Rating(★, no status)
│  │         + "Member since {mon year}" row ]
│  ├─ Account  Card [Edit Profile · Documents&Verification(preview) · Vehicle(preview) · Payout Settings · Preferred Errand Types · Working Areas(preview)]
│  ├─ Preferences  Card [Notification Preferences · Help & Support · Terms & Privacy]
│  ├─ InlineLogoutLink (tap-to-confirm)
│  └─ Pressable "Delete account" (underline)
├─ Modal delete-account (slide bottom sheet + KeyboardAvoidingView)
│  └─ "Delete your account?" + Type-DELETE TextInput + Button(danger, disabled until "DELETE") + Cancel
└─ LogoutSplash (visible while loggingOut)
```

**States:**
- **Loading:** No skeleton — hydrated store renders immediately; `useFocusEffect` triggers a background `refreshAll` on every focus.
- **Empty:** n/a (stores hold identity; menus always render).
- **Error:** `loadFailed && !runnerProfile` (refresh failed AND nothing cached) → `ErrorState compact` ("Couldn't load your stats", `onRetry` clears loadFailed + refreshAll) inside a hairline-bound box, replacing the metric rings. If store has a cached profile, stale numbers are kept (no error shown). Delete-account failure → `toast.error`.
- **Variants:** "Verified runner" badge only when `verification_status==='approved'`; menu `preview` labels (Documents → Verified/Pending/Rejected/Action needed; Vehicle → Walking/Bicycle/Motorcycle/Car; Working Areas → "{n} km") render only when the underlying value exists; PerformanceMetric acceptance <70% and completion <80% flip color to warning + AlertTriangle icon, otherwise success + TrendingUp.

**Interactions & haptics:** Delete-account entry tap → `Haptics.notificationAsync(Warning)` + opens modal; delete confirm (`handleDeleteAccount`, only when text==="DELETE") → `Haptics.notificationAsync(Warning)` again before the API call. Logout via `InlineLogoutLink` (inline tap-to-confirm, no bottom sheet) → shows `LogoutSplash`. Pull-to-refresh + on-focus refresh both call `refreshAll`. Menu rows navigate on tap (no haptic).

**Data:** `useAuthStore` (user, setUser, logout), `useRunnerStore` (runnerProfile, setRunnerProfile). `refreshAll` fetches `runnerService.getRunnerProfile()` + `userService.getProfile()` in parallel (Promise.all) and writes both stores. `userService.deleteAccount()` on confirm. No `useQuery` here — refresh is imperative + focus-driven.

**Navigation:** `/(runner)/settings/edit-profile`, `/(runner)/settings/documents`, `/(runner)/settings/vehicle`, `/(runner)/payout`, `/(runner)/settings/preferred-types`, `/(runner)/settings/working-areas`, `/(runner)/settings/notifications`, `/(runner)/settings/help`, `/(runner)/settings/terms`; logout & successful delete → `/(auth)/welcome`.

---

**Shared runner components referenced above (current behavior):**
- **ActiveRunnerErrandCard** — status→phase map (pickup / pickup_arrived / in_transit / arrived / delivered) drives title/sub/CTA copy; shows dropoff address + Package icon once in transit, else pickup + Navigation; brand-stripe header, payout chip, avatar, address inset, and a "breathing" CTA chip (Animated scale loop, frozen under `useReducedMotion`); press fires `Haptics.impactAsync(Light)`.
- **IncomingRequestModal** — MotiView spring-in overlay with a countdown ring (color primary→warning≤10s→danger≤5s). **Escalating haptics:** `impactAsync(Heavy)` on mount, `notificationAsync(Warning)` at 10s remaining, then `impactAsync(Heavy)` every second inside the final 5s; auto-declines at 0. Coarse (5s-bucket) `accessibilityLiveRegion` countdown label. Accept/Decline buttons (decline fires a quiet `impactAsync(Light)`; accept success haptic is fired by the parent). Renders transport/shopping/on-site badges, shopping budget cap banner, and a slate distance+payout block.
- **NegotiateOfferCard** — Card with errand-type Badge, "{n}m left" clock (from `negotiate_expires_at`), pickup/dropoff rows, distance + `customer_offer` amount; whole card Pressable.
- **PerformanceMetric** — 64px colored ring with value+suffix; optional non-color `status` ('good'→TrendingUp / 'warning'→AlertTriangle) trailing icon baked into the a11y label ("…, on track" / "…, needs attention") for color-blind accessibility.
- **VerificationBanner** — returns null when approved; otherwise a tinted card (pending/rejected/resubmit) with icon, message, and an action link ("View documents" / "View Details" / "Re-submit") padded to a ≥44pt target.
## 6. Runner Flow — Job workspace

### 6.1 Runner Onboarding (Document Verification) — `/(runner)/onboarding`
**File:** `src/app/(runner)/onboarding.tsx`  ·  **Purpose:** Runner uploads required + optional verification documents, tracks approval status, and continues to the dashboard once required docs are in.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (bg-background)
├─ TopBar (flex-row)
│  ├─ Pressable "Skip"  (→ setRunnerOnboardingSkipped + replace (tabs))
│  └─ Pressable LogOut icon  (→ ConfirmModal "Log out?")
└─ ScrollView (RefreshControl)
   ├─ Header  [LOGO image · "Complete Your Runner Profile" · verify blurb]
   └─ body ?
      ├─ loading ? Skeleton block (label + 4 doc-card skeletons)
      ├─ loadError ? ErrorState "Couldn't load your documents" (onRetry)
      └─ else (loaded)
         ├─ Step progress  ["{n} of 2 required uploaded" · "+{k} optional" · progressbar bar]
         ├─ "Required Documents" section → renderDocCard × [government_id, selfie]
         ├─ "Vehicle Documents (Optional)" section → renderDocCard × [vehicle_registration, vehicle_photo, drivers_license]
         ├─ Info Card (primaryLight) [Clock · "Verification takes 1–2 business days"]
         └─ Continue block
            ├─ Button (title toggles "Continue to Dashboard" / "Upload Required Documents"; disabled until required uploaded)
            └─ Pressable "Skip for now" ? (only when !requiredUploaded)
   (each renderDocCard = Pressable→Card: thumbnail(Image+Eye overlay) ? | icon tile · label + required `*` · statusText/description · capture `tip` (when canUpload) · trailing StatusIcon / "Uploading…")
Overlays:
├─ ImagePickerModal (camera/gallery → handleImageConfirm → uploadFile)
├─ Full-screen image preview ?  (Pressable black overlay, tap to close)
└─ ConfirmModal (logout)
```

**States:**
- **Loading:** Custom inline Skeleton block — one 45%-width label skeleton + 4 doc-card skeletons (48px square + two text lines + trailing 16px), wrapped in bordered `bg-surface` cards.
- **Empty:** n/a as a dedicated empty screen — a 404 on the profile fetch is treated as the legitimate "nothing uploaded yet" state and every doc card just shows "Not uploaded".
- **Error:** ErrorState (full, `flex:0 paddingVertical:32`) "Couldn't load your documents" / "Check your internet connection and try again." with `onRetry` (re-sets loading + refetches). Only a non-404 fetch failure trips this. Upload failures surface via `toast.error` + error haptic, not this state.
- **Variants:** Per-document status badge drives color/icon/text: approved (success + CheckCircle "Approved"), pending (warning + Clock "Under review"), rejected (danger + ChevronRight "Rejected — tap to re-upload", re-uploadable), none (muted + ChevronRight "Not uploaded"). `canUpload` = no doc yet OR rejected. Uploading doc shows "Uploading…" text.

**Interactions & haptics:** Tap doc card → ImagePickerModal (only when canUpload). Tap thumbnail → full-screen preview. Upload success → `Haptics.notificationAsync(Success)` + toast; failure → `notificationAsync(Error)` + toast. Skip → `Haptics.impactAsync(Light)` then persist skipped flag. Continue with missing required docs → `toast.warning`. Pull-to-refresh re-fetches profile. Logout → ConfirmModal (destructive, warning haptic on confirm via ConfirmModal).

**Data:** Local component state (documents/loading/loadError/uploading/preview/modals). Services: `runnerService.getRunnerProfile()`, `runnerService.uploadDocument(formData)`, `userService.getProfile()` (on Continue to sync user). Stores: `useAuthStore` (user/setUser/setRunnerOnboardingSkipped), `useRunnerStore.setRunnerProfile`, `useAuth().logout`, `toast`. No useQuery — manual `fetchProfile` in effect.

**Navigation:** Continue → `router.replace('/(runner)/(tabs)')`. Skip / Skip for now → same tabs replace (after setting skipped flag). Logout confirm → `router.replace('/(auth)/welcome')`.

---

### 6.2 Runner Notifications — `/(runner)/notifications`
**File:** `src/app/(runner)/notifications.tsx`  ·  **Purpose:** Grouped, paginated notification inbox for the runner with type icons, read tracking, and deep-link routing.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (bg-background)
├─ GradientHeader "Notifications"  [showBack · trailing: "Mark all read" text + "Clear all" Trash2 icon(danger) ? (when notifications.length>0)]   ← Phase 3: Clear all
└─ SectionList (RefreshControl · stickySectionHeaders · onEndReached=handleLoadMore)
   ├─ renderSectionHeader  [bucket title (Today/Yesterday/This Week/Earlier) · "{n} new" ? unread badge]
   ├─ renderItem → Swipeable (swipe-left; opaque bg-background row) → notification Pressable   ← Phase 3: swipe actions
   │  ├─ right actions: [Archive (surfaceMuted chip) · Delete (danger, Trash2)]
   │  ├─ type icon tile (color+bg by NotificationType)
   │  └─ body [title (bold if unread) + 6px unread dot ? · body(2 lines) · relative time]
   ├─ ListFooter ?  loadingMore ? ActivityIndicator | (!hasMore & has items) "You're all caught up" | null
   └─ ListEmpty ?  loading ? null | error ? ErrorState | RunnerEmptyState
```

**States:**
- **Loading:** No skeleton — `ListEmptyComponent` returns `null` while `notifQ.loading` so the inbox never flashes an empty/error state during first fetch.
- **Empty:** `RunnerEmptyState` — icon `Bell`, eyebrow "Inbox clear", title "No notifications yet", description "Errand offers, payouts, and updates will land here as they happen." (no CTA).
- **Error:** ErrorState "Couldn't load notifications" with `onRetry={() => notifQ.refresh()}` — only shown for a failed first fetch (gated so it doesn't compete with loading). **Swipe archive/delete failure (Phase 3):** optimistic `remove(id)`, then service call, rollback via `setNotifications` snapshot + `toast.error` (runner screen also gained a `toast` import; it previously swallowed errors silently). **Clear all** empties the store only after the server confirms.
- **Variants:** Per-notification read state changes title font weight + shows a 6px primary dot; section headers show "{n} new" per bucket. Pagination footer states: loading-more spinner / "You're all caught up" / none. Load-more failures soft-fail silently.

**Interactions & haptics:** Tap notification → marks read (optimistic + PATCH) then routes by type. "Mark all read" → `Haptics.selectionAsync()` + `markAllAsRead()`. **Swipe-left → Archive** (`selectionAsync`) or **Delete** (`notificationAsync(Warning)`): optimistic `remove(id)` + service + rollback on failure (Phase 3). **"Clear all"** → destructive `ConfirmModal` (`notificationAsync(Warning)`) → `clearAll()` + `clear()`. Pull-to-refresh → `notifQ.refresh()`. Infinite scroll via `onEndReached` (threshold 0.4) appending de-duped pages.

**Data:** `useQuery(['notifications', userId])` → `notificationService.getNotifications({page:1,per_page:20})` (staleTime 30s, ttl MEDIUM). Manual pagination state (page/hasMore/loadingMore + ref). Store: `useNotificationStore` (notifications/setNotifications/markRead/markAllRead/setUnreadCount + Phase-3 `remove(id)`/`clear()`). Services: `notificationService.markAsRead/markAllAsRead` + Phase-3 `deleteNotification`/`archiveNotification`/`clearAll`. `useAuthStore` for userId.

**Navigation:** booking_update → `/(runner)/errand/{booking_id}`; payment → `/(runner)/(tabs)/earnings`; chat → `/(runner)/chat/{booking_id}`; document_update → `/(runner)/settings/documents`; system/promo/sos → no route.

---

### 6.3 Active Errand (Job workspace) — `/(runner)/errand/[id]`
**File:** `src/app/(runner)/errand/[id].tsx`  ·  **Purpose:** The runner's primary in-job cockpit — full-screen live map behind a draggable detail sheet, one big status-advance CTA, per-phase proof capture, PIN, SOS, and completion.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (edges=[])
└─ View (relative)
   ├─ RunnerActiveMap variant="fill"  (absolute-fill background; bottomOffset follows sheet height)
   ├─ Floating top bar (SafeAreaView top, absolute)
   │  └─ Card [BackButton (confirmLeaveErrand when active) · "Passenger ride"/"Active errand" + booking_number · divider · MessageCircle chat (unread badge ?)]
   └─ KeyboardAvoidingView (absolute bottom)
      └─ Animated.View draggable bottom sheet (height animated between SNAP_COLLAPSED/MID/EXPANDED)
         ├─ Drag handle (panResponder · accessibilityRole="adjustable")
         ├─ Header (always visible)
         │  ├─ JourneyBeads (status)
         │  └─ CurrentStepHero  [eyebrow PICKUP/DROP-OFF · verb-led runnerHeroTitle · address subtitle · etaMinutes]
         │     └─ Action row ? (only !isReadOnly & active): [Navigate btn (primary) · Maps btn (system maps)]
         ├─ ScrollView (RefreshControl sheetRefreshing) details
         │  ├─ Customer pill  [Avatar · name · phone · call btn (disabled if no phone) · chat btn (unread badge ?)]
         │  ├─ PIN gate ? (transportation & arrived_at_pickup & !pinVerified): [TextInput 4-digit · Verify Button]
         │  ├─ PIN verified banner ? (transportation & pinVerified): CheckCircle "PIN verified — ready to start"
         │  ├─ Payout strip  [runner_payout · Budget ? (shopping)]
         │  └─ "Trip details" disclosure (Chevron toggle)
         │     └─ detailsOpen ?
         │        ├─ shopping budget warning ? (ShoppingBag banner)
         │        ├─ ErrandDetailsCard (description/instructions/photos/value + server-synced shopping checklist ?)   ← Phase 3
         │        ├─ "Progress" → StatusTimeline (per errandRule.statusFlow)
         │        ├─ Emergency SOS Pressable ? (!isReadOnly; toggles armed→active)
         │        └─ "Report an issue" mailto link
         └─ Sticky action footer (border-t)
            ├─ isReadOnly ?
            │  · true → "Read-only view" + "Status: {label}"
            │  · false →
            │    ├─ Pre-completion checklist ? (nextStatus==completed): "Before you complete" [delivery photo · receipt · PIN · signature — CheckCircle2/Circle done state]
            │    ├─ helper caption ["Slide to confirm…" | "Tap to advance…"]
            │    └─ StatusActionButton (key=status:slideResetKey → Button OR SlideToConfirm)
Overlays (conditional):
├─ PhotoProofModal ? (showPhotoProof 'pickup'|'delivery')
├─ ReceiptCaptureModal (visible=showReceipt; shopping errands)
├─ CompletionModal ? (showCompletion; signature or confirm-only)
├─ SuccessCheck overlay ? (showSuccessMoment; celebrate)
├─ RateCustomerModal ? (showRate; after completion confirmed)
└─ ConfirmModal (SOS confirm, destructive)
```

**States:**
- **Loading:** Full custom Skeleton mirroring the real layout — top-bar skeleton + spacer map area + bottom-sheet skeleton (drag pill, eyebrow, hero title, action row, customer pill w/ SkeletonCircle avatar + two SkeletonCircle action buttons, and a 56px rounded CTA). Shown only while `fetchedQ.loading` and no booking resolved yet.
- **Empty:** n/a (single booking).
- **Error:** When booking null and not loading → ErrorState "Errand unavailable" / "This errand is no longer accessible…" with `onRetry={fetchedQ.refresh}` plus an outline "Go Back" button. Status-update failures revert optimistic state + error haptic + toast (not a full error screen).
- **Variants:** `isReadOnly` (terminal/unloaded) swaps the sticky footer to a read-only status line and hides Navigate/Maps/SOS. Phase: `inPickupPhase` (single-location or pickup statuses) drives hero eyebrow, map target, ETA target, and Navigate/Maps destination. Transportation vs shopping vs single-location alter the hero copy, PIN gate, checklist items, and which modal opens at each transition. SOS armed→active toggle. Sheet snap: collapsed (220) / mid (~55%) / expanded (~88%).

**Interactions & haptics:** THE CTA is `StatusActionButton` — a tap `Button` for early transitions, a `SlideToConfirm` for consequential ones (next status `delivered`/`completed`). `handleStatusUpdate` branches into ReceiptCaptureModal (shopping arrived_at_pickup), PhotoProofModal pickup (non-shopping multi-loc), CompletionModal (single-loc picked_up & delivered), PhotoProofModal delivery (arrived_at_dropoff), else `advanceStatus`. `advanceStatus` is optimistic (mutate cache + store, background POST); server-confirmed non-completed transitions fire `Haptics.notificationAsync(Success)`; failures fire Error haptic, revert, bump `slideResetKey` to re-arm the slider, toast. Completion → `SuccessCheck` overlay (own haptic) then RateCustomerModal after server confirms `completed`. Navigate btn / Maps btn → `Haptics.impactAsync(Light)`. PIN verify → Success/Error notification haptics. SOS: arm press → `notificationAsync(Warning)` opens ConfirmModal; confirm broadcasts. Pull-to-refresh inside sheet. Android hardware-back guarded (double-press) while active & not read-only via `useBackGuard`; leaving via BackButton calls `confirmLeaveErrand`.

**Data:** `useQuery(['runner','errand','byId',id])` → `runnerService.getErrand(id)` (staleTime 15s, ttl SHORT; SWR from AsyncStorage). Falls back to `useRunnerStore.currentErrand` when it matches id. Ownership proven by the server-scoped 200 (no client identity check). Stores: `useRunnerStore` (currentErrand/updateErrandStatus), `useChatStore` (refreshUnread + unreadByBooking, polled 30s via `useForegroundInterval`), `useLocationStore` (isTracking/startTracking/currentLocation), `useAuthStore`. Hooks: `useEta`, `useForegroundInterval` (15s status poll while active), `useBackGuard`. Services: `runnerService.advanceErrandStatus / submitPickedUpWithReceipt / verifyRidePin / triggerSOS / submitCustomerReview`. Realtime: status advances broadcast server-side via BookingStatusChanged / Supabase Realtime (mirrored to customer within ~5s per comments).

**Navigation:** Chat icons → `/(runner)/chat/{id}`. Navigate btn + auto-launch on entering travel legs (`heading_to_pickup`/`in_transit`, once per transition, 350ms delay) → `/(runner)/navigate/{id}`. Maps btn → system maps deep link. Report issue → mailto. Rate submit/skip → `router.replace('/(runner)/(tabs)')`. Back → `router.back()` or replace tabs (guarded when active).

---

### 6.4 Turn-by-turn Navigation — `/(runner)/navigate/[id]`
**File:** `src/app/(runner)/navigate/[id].tsx`  ·  **Purpose:** In-app satnav — full-screen following map, maneuver banner, live ETA/distance/speed, off-route re-routing, and an expandable step list.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
booking null ?
  ├─ hydrateFailed ? SafeAreaView → ErrorState "Couldn't start navigation" (onRetry → retry hydrate)
  └─ else → View: ActivityIndicator + "Preparing navigation…"
destination null ? SafeAreaView: AlertTriangle + "No destination" + "Go Back" pill
else →
View (dark bg)
├─ HereMapView (absolute-fill · showsUserLocation · follows camera)
│  ├─ HereMarker destination (Flag; primary if pickup / danger if dropoff)
│  └─ HerePolyline route ? (cased: outline primary900 + fill primary500)
├─ Top maneuver banner (SafeAreaView top)
│  ├─ Card (primary) [ManeuverIcon · "In {dist}" / Calculating… / Route unavailable eyebrow · instruction · "Then …" upcomingStep ? · mute/unmute toggle (Volume2/VolumeX)  ← Phase 4 · X end-nav btn]
│  └─ Destination subtitle pill  ["Pickup/Dropoff: {label}"]
├─ Greeting card ? (showGreeting & navRoute; fades in ~3.5s, tap to dismiss)  [MapPin · "Heading to pickup/drop-off" · label · dist · duration/arrival]
├─ Speed HUD chip ? (speedKmh != null)  [km/h · Gauge "Speed"]  bottom:220
├─ Recenter FAB ? (!followCamera)  Locate icon  bottom:220
└─ ExpandableSheet (initial peek; snaps 0.18/0.52/0.90)
   ├─ ETA summary row  [big remainingDuration · dist · "arrives {time}" · arrivedSoon ? "I've Arrived" (success) | "End" (gray)]
   │  └─ routeError ? "Retry route" pill
   └─ Upcoming steps ScrollView ? (steps beyond current)  [ManeuverIcon · instruction · distance]
```

**States:**
- **Loading:** Booking hydration → centered `ActivityIndicator` + "Preparing navigation…". Route calc → banner eyebrow shows "Calculating…"; ETA row shows em-dash placeholders.
- **Empty:** No navigable destination → dedicated AlertTriangle "No destination" screen with a Go Back pill.
- **Error:** Hydration failure or 12s stall → ErrorState "Couldn't start navigation" / connection copy, `onRetry` clears `hydrateFailed` and bumps `hydrateAttempt`. Route fetch failure → banner eyebrow "Route unavailable" + a "Retry route" pill in the sheet (calls `fetchNav`, `toast.info('Recalculating route…')` on auto off-route reroute).
- **Variants:** `followCamera` on/off (pan disengages → Recenter FAB appears). `inPickupPhase` colors markers/greeting. `arrivedSoon` (<80m remaining) swaps End → "I've Arrived". Speed HUD only when moving (speed>0). Greeting auto-dismisses. **Voice muted/unmuted (Phase 4)** — mute toggle in the banner, state persisted (`@voice_guidance_muted`); voice also suppressed under OS Reduce Motion.

**Interactions & haptics:** End navigation (X or End) → `Haptics.impactAsync(Light)` + `router.back()`. "I've Arrived" → `Haptics.notificationAsync(Success)` + `router.back()` (does NOT push a status change — arrival status is owned by the errand screen's StatusActionButton). Pan map → disengages camera follow. Tap greeting → dismiss. Off-route (>60m for 2 strikes) auto-refetches route + info toast. Periodic 60s ETA refetch via `useForegroundInterval`; route refetch keyed on ~110m origin snap. **Voice guidance (Phase 4):** each maneuver is spoken once via `useVoiceGuidance().speak` — keyed on the instruction TEXT (stable across the ~110m/60s route refetches that re-index steps) with a short debounce that swallows the transient step cursor a refetch produces; suppressed when muted or Reduce Motion is on; the mute toggle fires `selectionAsync` (accessibilityState.selected reflects unmuted) and speech stops on End / I've Arrived / unmount.

**Data:** Local `booking` state (seeded from `useRunnerStore.currentErrand` if id matches, else hydrated via `runnerService.getErrand`). `useLocationStore` (currentLocation/isTracking/startTracking + tolerant `speed` cast). `routeService.getNavigationRoute` → `NavigationRoute` (coordinates + steps). `getErrandTypeRule` for singleLocation/phase. `useForegroundInterval`, `toast`; Phase-4 `useVoiceGuidance` (expo-speech) + `useReducedMotion`. Map: `HereMapView`/`HereMarker`/`HerePolyline`.

**Navigation:** All exits are `router.back()` to the errand screen. No forward routes.

---

### 6.5 Payouts — `/(runner)/payout`
**File:** `src/app/(runner)/payout/index.tsx`  ·  **Purpose:** Runner requests a withdrawal against wallet balance, views a Requested→Paid payout timeline, and edits bank / e-wallet payout details.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (bg-background)
├─ GradientHeader "Payouts"  [showBack · fallback profile]
└─ KeyboardAvoidingView
   └─ ScrollView (RefreshControl)
      ├─ Balance Card (brand gradient)  [Wallet · "Available for payout" · balance · "Withdraw anytime · Min ₱100"]
      ├─ Pending payout banner ? (pendingPayout)  [Clock "Payout in progress" · amount + submitted date]
      ├─ Amount block  [label · TextInput "₱0.00" · "Min ₱100" + "Withdraw all" link · Request Payout Button · "arrive within 1–3 business days"]
      ├─ "Recent Payouts" section ?
      │  ├─ loading & empty ? Skeleton card (3 rows)
      │  ├─ error & empty ? Card → ErrorState (compact, onRetry)
      │  ├─ empty ? Card → EmptyState (Wallet "No payouts yet")
      │  └─ list → payout rows [StatusIcon · amount · timeline (Requested dot→connector→Paid/Failed/Processing dot) · failure_reason ? · status pill (Paid/Failed/Pending)]
      ├─ Bank Account Card  [CreditCard · Bank Name input · Account Number input]
      ├─ E-Wallet Card  [Smartphone · E-Wallet Number input]
      └─ "Save Payout Info" Button (outline)
Overlays:
├─ SuccessCheck overlay ? (showPayoutSuccess)
└─ ConfirmModal (request payout confirm)
```

**States:**
- **Loading:** Recent Payouts first-load → Skeleton Card with 3 payout-row skeletons (18px status circle + two text lines + 52px pill). No page-level spinner.
- **Empty:** Recent Payouts empty → `EmptyState` icon `Wallet`, title "No payouts yet", description "Request your first payout once you've earned ₱100." (no CTA).
- **Error:** Recent Payouts fetch error (and empty) → compact `ErrorState` inside a Card, "Couldn't load payouts" / connection copy, `onRetry={payoutsQ.refresh}`. Request/save failures → `toast.error`.
- **Variants:** `pendingPayout` (a transaction with status pending) shows the warning banner AND disables + relabels the request button to "Payout in progress". Request button also disabled when balance ≤ 0, below min, or above balance. Per-row status: completed (success, "Paid"), failed (danger, "Failed" + optional failure_reason), pending (warning, "Processing — usually 1–3 business days"), each with a two-step Requested→Paid/Failed timeline.

**Interactions & haptics:** "Withdraw all" sets amount to full balance. Request Payout validates min/balance then opens ConfirmModal → `confirmRequestPayout` posts, shows `SuccessCheck` (its own success haptic), toast, refresh. Save Payout Info persists bank/account/ewallet then refreshes. Pull-to-refresh reloads runner profile + user (balance) + payout history. (No explicit `Haptics` calls beyond SuccessCheck's built-in and ConfirmModal's warning-on-confirm — the request confirm is non-destructive so ConfirmModal stays silent there.)

**Data:** `useQuery(['runner','payouts',userId])` → `runnerService.getPayoutHistory({page:1,per_page:5})` (staleTime 30s, ttl MEDIUM). Balance from `useAuthStore.user.wallet_balance` (NOT lifetime earnings). Stores: `useRunnerStore` (runnerProfile/setRunnerProfile), `useAuthStore` (user/setUser). Services: `runnerService.updateRunnerProfile / requestPayout`, `userService.getProfile`. Const `MIN_PAYOUT=100`.

**Navigation:** Back → `/(runner)/(tabs)/profile` fallback. No forward routes (stays on screen after request).

---

### 6.6 Chat Inbox (Conversations) — `/(runner)/chat`
**File:** `src/app/(runner)/chat/index.tsx` (thin wrapper) → renders `src/components/chat/ConversationList.tsx`  ·  **Purpose:** Runner's message inbox — unread-first list of per-booking conversations with the customer.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
RunnerChatInbox → <ConversationList chatHrefPrefix="/(runner)/chat" fallbackHref="/(runner)/(tabs)/history" />
ConversationList:
View (bg-background)
├─ GradientHeader "Messages"  [showBack · fallbackHref]
└─ FlatList (RefreshControl · sorted: unread first then recency)
   ├─ renderRow → Card (→ chat thread)
   │  ├─ Avatar (counterparty) + unread count badge ?
   │  └─ [name (bold if unread) + timeAgo · subtitle (errand type + #booking, or status label) · preview row (ImageIcon/Info prefix ? · "You: …"/"Photo"/system preview)]
   └─ ListEmpty ?  loading ? 5 skeleton rows | error ? ErrorState | EmptyState (role-aware)
```

**States:**
- **Loading:** First load (no cached data) → 5 skeleton conversation rows (SkeletonCircle avatar + name/time/subtitle/preview skeletons in bordered surface cards).
- **Empty:** `EmptyState` icon `MessageCircle`, title "No conversations yet", role-aware description — runner sees "When you accept an errand, your chat with the customer will appear here." (customer variant differs). No CTA.
- **Error:** `ErrorState` "Couldn't load messages" with `onRetry={conversationsQ.refresh}`.
- **Variants:** `isRunner` (derived from href prefix) toggles the empty-state copy. Rows split into unread cluster (bold name, primary time, danger count badge) then read. Last-message preview adapts: image → "Photo" + ImageIcon, system → "System update" + Info, outgoing → "You: …".

**Interactions & haptics:** Tap row → navigate to thread. Pull-to-refresh (`refreshing` = loading with cached data present). No explicit haptics in this component.

**Data:** `useQuery(['chat','conversations',userId])` → `chatService.getConversations()` (staleTime 30s, ttl MEDIUM, SWR from disk). `useAuthStore` for userId. Local `sorted` memo (unread-first).

**Navigation:** Row → `/(runner)/chat/{booking_id}`. Back → `/(runner)/(tabs)/history` fallback.

---

### 6.7 Chat Thread (Runner ↔ Customer) — `/(runner)/chat/[bookingId]`
**File:** `src/app/(runner)/chat/[bookingId].tsx`  ·  **Purpose:** Real-time 1:1 message thread with the customer — text + image messages, delivery/read receipts, quick replies, live typing indicator, and call.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
SafeAreaView (edges=top)
├─ Header (border-b)  [BackButton · "Chat with Customer" + "Booking #{slice}" · Phone call btn (disabled if no phone)]
└─ KeyboardAvoidingView
   ├─ FlatList (inverted · data=rows[day-separators+messages])
   │  ├─ renderRow ?
   │  │  · day ? day-separator pill
   │  │  · system ? centered gray pill
   │  │  · imageOnly ? bare Image (Pressable→lightbox) + meta row
   │  │  · else → bubble [Image ? · content ·] + meta row (mine: time + Clock/AlertCircle+RotateCw/CheckCheck Read/Check Sent · theirs: time)
   │  ├─ ListEmpty → "No messages yet. Start the conversation!"
   │  └─ ListFooter ? loadingOlder ? ActivityIndicator (back-pagination)
   ├─ TypingIndicator ? (isTyping)  — 3 pulsing dots (static dimmed under Reduce Motion)
   ├─ Quick Messages ScrollView (horizontal RUNNER_QUICK_MESSAGES pills)
   └─ Composer (border-t · paddingBottom=safe inset)  [Camera attach btn · multiline TextInput (onChange fires sendTyping) · Send btn (spinner while sending)]
Overlays:
├─ ImagePickerModal (visible=imagePickerVisible → handleImageSend)
└─ ImageLightbox (previewUri)
```

**States:**
- **Loading:** No skeleton — initial fetch just populates the inverted list; older-page fetch shows an ActivityIndicator footer (`loadingOlder`).
- **Empty:** `ListEmptyComponent` → centered "No messages yet. Start the conversation!" text (not the shared EmptyState component).
- **Error:** No dedicated error screen (ErrorState is imported but the thread relies on per-message failed state). Send failures → `toast.error` and the message row flips to a `failed` state (danger bubble, "Failed · Tap to retry" + RotateCw) that retries on tap; text-send failure also restores the draft into the input.
- **Variants:** Per-message delivery state: pending (Clock "Sending", 0.75 opacity), failed (AlertCircle + "Failed · Tap to retry" + RotateCw), read (CheckCheck primary "Read"), sent (Check muted "Sent"). Image-only vs text+image vs text-only vs system vs day-separator row kinds. Live `isTyping` bubble. Quick-message pills disabled while `sending`.

**Interactions & haptics:** Send text → input cleared immediately (optimistic), `chatSendMessage`. Quick-message pill → `chatSendMessage`. Attach → ImagePickerModal → `chatSendImage` (multipart). Tap failed message → `chatRetryMessage` (toast on repeat failure). Tap image → ImageLightbox. Typing in composer → throttled `sendTyping()` ping. Call btn → `Linking.openURL(tel:)`. Auto-mark-read: on focus, on foreground (AppState), and debounced 1.2s as new incoming messages land (gated on unreadCount>0 and app active). No explicit `Haptics` calls in this screen (the `expo-haptics` import is present but delivery feedback is visual). TypingIndicator respects `useReducedMotion`.

**Data:** `useChat(bookingId)` hook → { messages, fetchMessages, sendMessage, sendMessageWithImage, retryMessage, markAsRead, loadOlder, hasMore, loadingOlder, unreadCount, isTyping, sendTyping } (realtime chat channel + typing presence). Stores: `useAuthStore` (user), `useRunnerStore` (currentErrand for customer phone). Utils: `buildChatRows` (day separators), `resolveImageUrl`, `RUNNER_QUICK_MESSAGES`. `useReducedMotion`, `toast`.

**Navigation:** Back → `/(runner)/(tabs)` fallback. Call → dialer (no in-app route). No forward navigation.

---

### 6.8 Busy Areas (Demand) — `/(runner)/demand`
**File:** `src/app/(runner)/demand.tsx`  ·  **Purpose:** Runner demand insights — a HERE map heatmap of where recent bookings happen plus a 7×24 day-of-week × hour peak-hours density grid, so runners can decide where and when to be online.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Busy areas"  [showBack; fallbackHref="/(runner)/(tabs)"]
├─ DemandSkeleton ?  (initialLoading — Skeleton eyebrow + 260h map block + eyebrow + 200h grid block)
├─ ErrorState(full) ?  [title:"Couldn't load demand data", onRetry:retryAll]  (bothFailed)
└─ ScrollView  (RefreshControl; paddingBottom:32)          ← default branch
   ├─ Section: Demand heatmap
   │  ├─ Eyebrow "Where bookings happen"
   │  ├─ Card + ErrorState(compact, onRetry) ?            (heatmapFailed)
   │  ├─ View (rounded-2xl, h:280, border-divider)          ← else
   │  │  ├─ HereMapView [initialRegion=fitted bbox | DEFAULT_REGION] ?  (cells.length>0)
   │  │  │  └─ HereHeatmap [id:"demand-heatmap", cells]   (MapLibre heatmap layer, blue→green→yellow→orange→red ramp)
   │  │  └─ empty View ?  TrendingUp icon + "Not enough recent bookings to map yet"  (cells.length===0)
   │  └─ caption "Warmer areas had more bookings in the last {days} days" ?  (cells.length>0)
   └─ Section: Peak hours
      ├─ Eyebrow "Peak hours"
      ├─ headline "Busiest around {Day} {h}{am/pm}" ?      (peakInsight — busiest slot)
      ├─ Card
      │  ├─ ErrorState(compact, onRetry) ?                 (peakFailed)
      │  ├─ empty "No booking history yet to show peak hours" ?  (!grid || gridMax<=0)
      │  └─ ScrollView(horizontal) ?                        ← else (has data)
      │     ├─ hour axis row  [labels at h%6===0 → 12a·6a·12p·6p]
      │     ├─ day row × 7  [Mon→Sun; label + cell × 24; bg=densityColor(count,gridMax); a11y "{Day} {h}: {n} bookings"]
      │     └─ legend row  ["Less" · swatch ×5 (0·.25·.5·.75·1) · "More"]
      └─ caption "Based on the last {days} days of bookings" ?  (grid && gridMax>0)
```

**States:**
- **Loading:** `initialLoading` = either query loading with no data yet → full-screen `DemandSkeleton` under the header (static Skeleton blocks; no shimmer logic in this file).
- **Empty:** Heatmap with zero cells → `TrendingUp` icon + "Not enough recent bookings to map yet. Check back soon." Peak grid with no data or `gridMax<=0` → centered "No booking history yet to show peak hours." Captions and the `peakInsight` headline suppress themselves when their data is empty.
- **Error:** Both queries failed with no data → full `ErrorState` (title "Couldn't load demand data", `onRetry=retryAll` refreshes both). Only heatmap failed → `Card` wrapping compact `ErrorState` "Couldn't load the map" (retries `heatmapQ`). Only peak failed → compact `ErrorState` "Couldn't load peak hours" inside the peak Card (retries `peakQ`). The two sections degrade independently.
- **Variants:** Map region auto-fits to the cells' bounding box (padded ×1.5, min 0.05 delta), else Metro Manila `DEFAULT_REGION`. Peak-hours cell color is a brand-blue alpha blend (`densityColor`: 0.18→1.0 alpha by count/max; empty = `LightColors.divider`). Days rendered Monday-first though the backend grid is 0=Sun..6=Sat.

**Interactions & haptics:** No expo-haptics anywhere in this screen. Pull-to-refresh (`RefreshControl`) runs both queries in parallel via `onRefresh`. The peak grid scrolls horizontally; per-cell nodes are `accessible` with descriptive a11y labels. Reduced-motion safe — layout is fully static (no animated/entering transitions, no shimmer), the map heatmap is a static overlay, and refresh is user-initiated.

**Data:** `useQuery(['runner','heatmap',14], () => runnerService.getHeatmap(14).data.data, {staleTime:CacheTTL.MEDIUM, ttl:CacheTTL.LONG})` → `{days, cells:[{lat,lng,weight}]}`. `useQuery(['runner','peak-hours',30], () => runnerService.getPeakHours(30).data.data, {staleTime:CacheTTL.MEDIUM, ttl:CacheTTL.LONG})` → `{days, grid:number[7][24]}`. Both service calls are `silent` with a 60s HTTP cache (`GET /runner/heatmap?days=14`, `GET /runner/peak-hours?days=30`). Derived via `useMemo`: fitted `region`, `peakInsight` (busiest dow/hour), `gridMax`. No zustand store, no realtime channel.

**Navigation:** Reached from the runner tabs (Busy areas entry); `GradientHeader` back button pops, falling back to `/(runner)/(tabs)`. No outbound navigation from this screen.

---

#### Shared component notes (runner workspace)

- **StatusActionButton** (`src/components/runner/StatusActionButton.tsx`): Renders nothing if there's no per-type action label. Returns a **SlideToConfirm** when the next status is `delivered`/`completed` (consequential — label like "Slide to hand over item"), otherwise a tap **Button**. `getNextStatus()` treats `matched` as `accepted`. Disabled for transportation `arrived_at_pickup` until PIN verified (with an accessibility hint). Per-type labels/flow come from `getErrandTypeRule`.
- **CompletionModal** (`src/components/runner/CompletionModal.tsx`): Bottom MotiView sheet. `requiresSignature` true → real **SignaturePad** (PanResponder + SVG, exports PNG file URI on submit), "Clear Signature" appears after first stroke, submit disabled until signed. False → confirm-only card (CheckCircle2 + subtitle). Optional delivery/proof photo preview at top.
- **PhotoProofModal** (`src/components/runner/PhotoProofModal.tsx`): RN Modal + MotiView slide-up. Take Photo (`Haptics.impactAsync(Light)`) / Choose from Gallery → preview with Retake/Confirm. `type` toggles "Pickup Photo" vs "Delivery Photo" copy.
- **ReceiptCaptureModal** (`src/components/runner/ReceiptCaptureModal.tsx`): Shopping-errand receipt + actual cost capture. Shows pre-authorized budget card, amount Input (over-budget error blocks submit), receipt photo (camera w/ Light haptic or gallery). Submit "Submit & Mark Picked Up" enabled only when amount>0, ≤budget, photo present.
- **RateCustomerModal** (`src/components/runner/RateCustomerModal.tsx`): RN Modal, KeyboardAvoidingView + tap-outside-dismiss. Avatar + RatingStars(36) + optional 200-char comment. Submit disabled until rating>0; Skip link.
- **ErrandDetailsCard** (`src/components/runner/ErrandDetailsCard.tsx`): Collapsible Card (renders null if no content) — description, special instructions, estimated item value, horizontally-scrollable item photos (tap opens URL). **Phase 3:** when passed `shoppingItems` (from `booking.shopping_items`) it renders a tickable shopping checklist ("Picked N/total") that is the server source-of-truth — each toggle optimistically mirrors locally and calls `runnerService.updateChecklistTicks` (PATCH), rolling back + toast on failure, with a selection haptic and checkbox accessibility roles; when absent it falls back to the Phase-2 `parseChecklist(description)` device-local ticks.
- **RunnerActiveMap** (`src/components/runner/RunnerActiveMap.tsx`): HereMapView with pickup/dropoff markers (active phase = solid, inactive = faded), route polyline (cased; primary in pickup phase, danger in dropoff), animated "{n} min away" ETA chip + Recenter FAB anchored to an animated `bottomOffset` (follows the errand sheet). `variant` 'fill' (errand bg) vs 'card'. "Map unavailable" fallback when no coords.
- **ConfirmModal** (`src/components/ui/ConfirmModal.tsx`): Centered MotiView dialog (scrollable body), Cancel | Confirm split footer. Confirm fires `Haptics.notificationAsync(Warning)` only when `destructive`; Cancel fires `selectionAsync`. Loading swaps confirm label for an `ErrandLoader`. Used here for logout (onboarding), SOS (errand), and payout request confirmation.
## 7. Runner Flow — Settings

### 7.1 Edit Profile — `/(runner)/settings/edit-profile`
**File:** `src/app/(runner)/settings/edit-profile.tsx`  ·  **Purpose:** Edit the runner's name / phone / email with inline validation and a sticky save bar.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Edit Profile"  [showBack · fallbackHref → (runner)/(tabs)/profile]
├─ KeyboardAvoidingView (padding on iOS)
│  └─ ScrollView (px-5, paddingBottom 40)
│     ├─ Identity header (items-center)
│     │  ├─ Avatar  [uri=user.avatar_url · name=user.full_name · size xl]
│     │  ├─ Text  full_name (fallback "Runner")
│     │  └─ Text ? user.email
│     ├─ Section label "PERSONAL DETAILS"
│     └─ Card (padding md)
│        ├─ Input "Full Name"  [error={nameError} · autoCapitalize words]
│        ├─ Input "Phone Number"  [phone-pad · maxLength 13]
│        └─ Input "Email Address"  [email-address · autoCapitalize none]
└─ BottomActionBar
   └─ Button "Save Changes"  [loading · fullWidth · size lg]
```

**States:**
- **Loading:** none for the screen; Save `Button` shows its own spinner via `loading` while `handleSave` runs.
- **Empty:** n/a (form is pre-filled from `authStore.user`, falling back to empty strings).
- **Error:** save failure → `toast.error` with `err.response.data.message` or "Failed to update profile". Validation error for empty name is shown inline on the Full Name `Input` (`nameError` = "Full name is required"), not a toast.
- **Variants:** inline validation — `nameError` set on empty/whitespace name and cleared as soon as the user types a non-empty value.

**Interactions & haptics:** Tap Save → validates (blocks if name empty), calls `userService.updateProfile`. On success fires `Haptics.notificationAsync(Success)`, then `toast.success` and navigates back. No haptic on validation-block. Typing in Full Name clears the inline error live.

**Data:** `useAuthStore` (`user`, `updateProfile`), `userService.updateProfile({ full_name, phone?, email? })`, `toast` store. Local `useState` for fullName / phone / email / nameError / loading. No queries.

**Navigation:** On success `router.back()` if possible, else `router.replace('/(runner)/(tabs)/profile')`. Header back uses `fallbackHref` to the profile tab.

---

### 7.2 Documents & Verification — `/(runner)/settings/documents`
**File:** `src/app/(runner)/settings/documents.tsx`  ·  **Purpose:** Show verification status and let the runner upload/replace the five required documents via camera/library.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Documents & Verification"  [showBack · fallbackHref → profile]
├─ ScrollView (RefreshControl: refreshing = profileQ.loading && !profile)
│  └─ ?  ErrorState (loadFailed)  |  null (initial load, nothing cached)  |  success:
│     ├─ Verification Status Banner ? (only if verificationStatus present)
│     │  └─ Card  [bg-successSoft | bg-dangerSoft | bg-primaryLight]
│     │     └─ Row: {CheckCircle | XCircle | Clock} + Text {Verified | Rejected | Pending Review}
│     │        └─ Text ? "Approved on <date>"  (if profile.approved_at)
│     └─ Document Cards (px-5)
│        └─ map DOCUMENT_TYPES → DocumentUploadCard × 5
│           [Government ID · Selfie with ID · Vehicle Registration · Vehicle Photo · Driver's License]
├─ DocumentViewer (modal · visible = !!viewer)
└─ ImagePickerModal (visible=pickerVisible · uploading=!!uploading · title="Upload <label>")
```

**States:**
- **Loading:** initial load with nothing cached renders `null` in the ScrollView body (the `RefreshControl` spinner shows instead — deliberately does not paint docs as "not uploaded").
- **Empty:** n/a — the five document slots always render (as "Upload" affordances) once data (or cache) exists.
- **Error:** `loadFailed` (= `profileQ.error && !profile && !profileQ.loading`) → full `ErrorState` title "Couldn't load your documents" with `onRetry` → `profileQ.refresh()`. Upload failure → `Haptics.notificationAsync(Error)` + `toast.error`.
- **Variants:** verification banner has three visual states approved / rejected / pending driven by `profile.verification_status`; each `DocumentUploadCard` reflects per-doc status (pending / approved / rejected + rejection reason).

**Interactions & haptics:** Tap a doc's Upload/Replace/Re-upload → opens `ImagePickerModal` for that `activeDocType`. Confirm image → `uploadFile` sends multipart FormData via `runnerService.uploadDocument`, refreshes, fires `Haptics.notificationAsync(Success)` + success toast; on failure fires `Haptics.notificationAsync(Error)` + error toast. Tapping a doc thumbnail opens `DocumentViewer`. Pull-to-refresh → `profileQ.refresh()`.

**Data:** `useQuery(['runner','profile', userId], runnerService.getRunnerProfile)` (staleTime 60s, `CacheTTL.LONG`, cache-first); mirrors result into `useRunnerStore.setRunnerProfile`; `profile = profileQ.data ?? runnerProfile`. `useAuthStore` for userId. `runnerService.uploadDocument(FormData)`. `toast` store. Local state: uploading / pickerVisible / activeDocType / viewer.

**Navigation:** No route pushes — all interaction is via the two modals (DocumentViewer, ImagePickerModal). Header back → profile tab fallback.

---

### 7.3 Vehicle Information — `/(runner)/settings/vehicle`
**File:** `src/app/(runner)/settings/vehicle.tsx`  ·  **Purpose:** Choose vehicle type (walk/bicycle/motorcycle/car) and, for motorized types, enter a plate number.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Vehicle Information"  [showBack · fallbackHref → profile]
├─ ScrollView (px-5, paddingBottom 40)
│  ├─ Section label "VEHICLE TYPE"
│  ├─ Vehicle grid (flex-row flex-wrap gap-3)
│  │  └─ map VEHICLE_OPTIONS → Pressable card × 4  [role=radio · state.selected]
│  │     ├─ Icon {PersonStanding | Bike | Bike | Car}
│  │     ├─ Text label
│  │     └─ Check badge ? (top-right, when selected)
│  └─ Plate section ? (vehicleType === motorcycle | car)
│     ├─ Section label "PLATE DETAILS"
│     └─ Card → Input "Plate Number"  [autoCapitalize characters]
└─ BottomActionBar
   └─ Button "Save Changes"  [loading · fullWidth · size lg]
```

**States:**
- **Loading:** none for screen; Save Button shows spinner during `handleSave`.
- **Empty:** n/a (defaults to `runnerProfile.vehicle_type ?? 'motorcycle'`).
- **Error:** save failure → `toast.error` (message or "Failed to update vehicle"). No inline validation on plate.
- **Variants:** plate section only renders for `motorcycle` or `car`; selected option card switches to `border-primary bg-primaryLight` styling and shows the Check badge.

**Interactions & haptics:** Tap a vehicle option → `Haptics.selectionAsync()` then sets `vehicleType` (option has `accessibilityRole="radio"` + `accessibilityState.selected`). Save → `runnerService.updateRunnerProfile` (sends `vehicle_plate` only for motorized types); on success `Haptics.notificationAsync(Success)` + success toast + back.

**Data:** `useRunnerStore` (`runnerProfile`, `setRunnerProfile`), `runnerService.updateRunnerProfile`, `toast`. Local state: vehicleType / plate / loading. No queries.

**Navigation:** On success `router.back()` else `router.replace('/(runner)/(tabs)/profile')`. Header back → profile fallback.

---

### 7.4 Working Areas — `/(runner)/settings/working-areas`
**File:** `src/app/(runner)/settings/working-areas.tsx`  ·  **Purpose:** Set the runner's service center point (from GPS/saved) and a working radius, previewed on a HERE map with a circle overlay.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Working Areas"  [showBack · fallbackHref → profile]
├─ ScrollView (RefreshControl · paddingBottom 120)
│  ├─ Map box (h-56 rounded)
│  │  └─ ?  HereMapView (lat && lng)                     |  No-location placeholder
│  │     ├─ HereMarker center  (pin dot)                 ├─ MapPin icon
│  │     └─ HereCircle radius (primary fill+stroke)      ├─ "Enable location to view map"
│  │                                                      └─ Button "Enable Location" [secondary · sm · loading]
│  ├─ Center Point Card  → coords "lat, lng" | "Location not available"
│  ├─ Working Radius Card
│  │  ├─ Row: "Working Radius"  +  "<x.x> km"
│  │  ├─ Slider  [1000–50000 · step 500 · a11y label/value]
│  │  └─ Row: "1 km" ··· "50 km"
│  └─ Helper text (radius tradeoff)
└─ BottomActionBar
   └─ Button "Save Working Area"  [loading=saving · fullWidth]
```

**States:**
- **Loading:** no full-screen skeleton; pull-to-refresh drives the `RefreshControl` (`refreshing` state). Save Button + Enable-Location Button show their own spinners.
- **Empty:** no location → map area shows the placeholder (MapPin + "Enable location to view map" + "Enable Location" CTA); Center Point Card reads "Location not available".
- **Error:** save failure → `toast.error`. Missing lat/lng on save → `toast.warning('Please enable location services…')`. `onRefresh` swallows errors silently (empty catch).
- **Variants:** map vs placeholder gated on `lat && lng` (from `runnerProfile.working_area_*` → `currentLocation` → 0). Enable-Location can succeed (seeds `locationStore`) or `toast.warning('Location is unavailable…')`.

**Interactions & haptics:** Dragging the radius `Slider` fires `Haptics.selectionAsync()` once per whole-km boundary crossing, throttled to ≥80ms (via `lastKmRef` / `lastTickAtRef`) so a fling doesn't burst. Slider has `accessibilityLabel="Working radius"` + `accessibilityValue`. Tap "Enable Location" → `getCurrentCoords({ feature })` (permission + Settings deep-link fallback), seeds `setCurrentLocation`. Save → `updateRunnerProfile({ working_area: JSON })`, `Haptics.notificationAsync(Success)`, success toast, then re-fetches profile. Pull-to-refresh re-fetches profile + radius.

**Data:** `useRunnerStore` (runnerProfile/setRunnerProfile), `useLocationStore` (currentLocation/setCurrentLocation), `runnerService.getRunnerProfile` / `updateRunnerProfile`, `getCurrentCoords` (locationPermission util), `toast`. Map components `HereMapView`/`HereMarker`/`HereCircle`. Local state: radius / saving / refreshing / requestingLocation + refs.

**Navigation:** Stays on screen after save (re-fetch, no navigation). Header back → profile fallback.

---

### 7.5 Preferred Errand Types — `/(runner)/settings/preferred-types`
**File:** `src/app/(runner)/settings/preferred-types.tsx`  ·  **Purpose:** Multi-select which errand categories the runner wants to receive (min 1 required).

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Preferred Errand Types"  [showBack · fallbackHref → profile]
│  └─ children: Text "<n> selected • min 1 required"  (white/80)
├─ ScrollView (px-5, RefreshControl · paddingBottom 120)
│  ├─ Text "Select the errand types you want to receive requests for."
│  └─ map types → Pressable  [role=checkbox · state.checked]  × 6
│     └─ Card (border-primary when selected)
│        ├─ Text type.name
│        └─ Check circle (filled bg-primary + Check | outline border)
└─ BottomActionBar
   └─ Button "Save Preferences"  [loading=saving · fullWidth]
```
Types: Delivery · Purchase & Deliver · Transportation · Document Processing · Queue & Wait · Moving Assistance.

**States:**
- **Loading:** no skeleton; `RefreshControl` on pull; Save Button shows its own spinner.
- **Empty:** n/a — the 6 default types always render (sourced from a hardcoded `defaultTypes` array, not the API; comment notes it "would normally come from API").
- **Error:** save failure → `toast.error`. Selecting none then saving → `toast.warning('Please select at least one errand type.')`. `onRefresh` swallows errors (empty catch).
- **Variants:** each row toggles selected styling; header count `selectedCount` updates live.

**Interactions & haptics:** Tap a type row → `Haptics.selectionAsync()` then toggles selection (row has `accessibilityRole="checkbox"` + `accessibilityState.checked`). Save → validates ≥1 selected, `updateRunnerProfile({ preferred_types })`, `Haptics.notificationAsync(Success)`, success toast, then re-fetches profile. Pull-to-refresh re-fetches profile.

**Data:** `useRunnerStore` (runnerProfile/setRunnerProfile), `runnerService.updateRunnerProfile` / `getRunnerProfile`, `toast`. `useEffect` seeds selection from `runnerProfile.preferred_types`. Local state: types / saving / refreshing.

**Navigation:** Stays on screen after save (re-fetch). Header back → profile fallback.

---

### 7.6 Notification Preferences — `/(runner)/settings/notifications`
**File:** `src/app/(runner)/settings/notifications.tsx`  ·  **Purpose:** Toggle runner notification categories, persisted per-user in AsyncStorage; Safety Alerts is locked ON.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Notification Preferences"  [showBack · fallbackHref → profile]
├─ ScrollView (px-5, paddingBottom 40)
│  ├─ Card (p-0 overflow-hidden)
│  │  └─ map PREFERENCES → Row × 4 (border-b between)
│  │     ├─ Icon bubble {Bell | MessageSquare | Star | AlertTriangle}
│  │     ├─ Text label + description
│  │     └─ Switch  [value=isOn · disabled when locked · a11y label/hint]
│  │        rows: New Errand Requests · Chat Messages · Reviews & Ratings · Safety Alerts(locked)
│  └─ Text "Safety alerts cannot be fully disabled for your protection."
```

**States:**
- **Loading:** none — prefs default to `DEFAULT_PREFS` (all true) immediately; persisted values merged in on mount asynchronously.
- **Empty:** n/a.
- **Error:** none surfaced — AsyncStorage read failure just keeps defaults; write is fire-and-forget with a swallowed `.catch(() => {})`.
- **Variants:** locked Safety Alerts row — `isOn` forced true, `Switch` `disabled`, no `onValueChange`, accessibilityHint "Always on. Safety alerts cannot be disabled for your protection." Every persisted merge also forces `alerts: true`.

**Interactions & haptics:** Toggle any unlocked switch → `Haptics.selectionAsync()` then flips the key and persists `{...prev, [key]:!prev[key], alerts:true}` via `storage.setJSON(prefsKey(userId))`. Locked switch is non-interactive. No navigation, no save button (persistence is per-toggle).

**Data:** `useAuthStore` for userId; `storage` util (`getJSON`/`setJSON`) keyed `runner_notif_prefs:<userId>` — per-user so account switches don't leak. Local state: `prefs`. `useEffect` loads + merges persisted prefs on mount (cancellable). No queries, no backend call.

**Navigation:** Header back → profile fallback only.

---

### 7.7 Help & Support — `/(runner)/settings/help`
**File:** `src/app/(runner)/settings/help.tsx`  ·  **Purpose:** Searchable FAQ accordion plus email/phone contact links.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Help & Support"  [showBack · fallbackHref → profile]
├─ ScrollView (px-5, keyboardShouldPersistTaps=handled)
│  ├─ SectionHeader "Frequently Asked Questions"
│  ├─ Search row (Search icon + TextInput "Search questions")
│  ├─ Card (FAQ list)
│  │  └─ ?  "No questions match "<q>"…" (filteredFaqs empty)
│  │     |  map filteredFaqs → FAQ row
│  │        ├─ Pressable header  [role=button · state.expanded]  (question + Chevron Up/Down)
│  │        └─ Answer Text ? (isExpanded)
│  ├─ SectionHeader "Contact Us"
│  └─ Card (contact list)
│     ├─ Pressable "Chat with Support" (Headphones + ChevronRight) → /(customer)/support   ← Phase 3 (shared support stack)
│     ├─ Pressable "Email Support" (Mail + support@errandguy.app + ChevronRight)
│     └─ Pressable "Phone Support" (Phone + +63 912 345 6789 + ChevronRight)
```

**States:**
- **Loading:** none (static content).
- **Empty:** search with no matches → in-card message "No questions match "<query>". Try a different keyword or contact us below." (5 FAQs are hardcoded).
- **Error:** opening a link that fails → `openLink` catch → `toast.error` ("Couldn't open your mail app." / "Couldn't open your phone app.").
- **Variants:** one FAQ expanded at a time (`expanded` tracked by question string, not index, so it survives search re-filtering); accordion chevron flips Up/Down.

**Interactions & haptics:** Tap a FAQ header → `Haptics.selectionAsync()` then toggles expand (accordion, single open). **Chat with Support (Phase 3)** → `Haptics.selectionAsync()` + `router.push('/(customer)/support')` — the support ticket stack is shared; `(customer)/_layout.tsx` lets the `support` subtree through for runners. Tap Email Support → `Linking.openURL('mailto:support@errandguy.app')` in try/catch. Tap Phone Support → `Linking.openURL('tel:+639123456789')` in try/catch. Search input filters question+answer text (case-insensitive), `keyboardShouldPersistTaps="handled"`.

**Data:** hardcoded `FAQS` array; `useMemo` filtered by `search`; `toast` store. Local state: expanded / search. No queries or services.

**Navigation:** Chat with Support → `/(customer)/support` (Phase 3). External `Linking` (mailto/tel). Header back → profile fallback.

---

### 7.8 Terms & Privacy — `/(runner)/settings/terms`
**File:** `src/app/(runner)/settings/terms.tsx`  ·  **Purpose:** Static legal text — Terms of Service, Privacy Policy, Community Guidelines.

**Layout structure** (outermost → in; indentation = nesting; note conditional nodes with `?`):
```
View (flex-1 bg-background)
├─ GradientHeader "Terms & Privacy"  [showBack · fallbackHref → profile]
└─ ScrollView (px-5, paddingBottom 40)
   ├─ map SECTIONS → block × 3
   │  ├─ Text section.title
   │  └─ Card → Text section.content
   │     [Terms of Service · Privacy Policy · Community Guidelines]
   └─ Text "Last updated: January 2025"
```

**States:**
- **Loading:** none.
- **Empty:** n/a.
- **Error:** n/a.
- **Variants:** none — fully static.

**Interactions & haptics:** None (scroll only). No haptics, no links, no buttons.

**Data:** hardcoded `SECTIONS` array. No hooks, stores, services, or queries.

**Navigation:** Header back → `/(runner)/(tabs)/profile` fallback only.

---

### Shared components used by this section

**`DocumentUploadCard`** (`src/components/runner/DocumentUploadCard.tsx`) — a `Card` per document. Header row: label + optional status chip (icon+text) driven by `STATUS_CONFIG` (pending=Clock/warning, approved=CheckCircle/success, rejected=XCircle/danger). If `fileUrl` present: an `expo-image` thumbnail (140pt tall, inline-sized) wrapped in a Pressable (`accessibilityRole="imagebutton"`, "View <label>") calling `onView(fileUrl)`, with "Tap to view full size" caption. Optional `rejectionReason` text (danger). Bottom: a dashed Pressable whose label is **Upload** (no file) / **Re-upload** (rejected) / **Replace** (otherwise), `accessibilityRole="button"`, `hitSlop {top:8,bottom:8}` to reach the 44pt target, calling `onUpload`. No haptics in the card itself (the parent screen fires them on upload result).

**`DocumentViewer`** (`src/components/runner/DocumentViewer.tsx`) — full-screen `Modal` (transparent, fade, `statusBarTranslucent`, light status bar) over a 0.94 black scrim. Top bar: title (numberOfLines 1) + close `X` Pressable (`accessibilityLabel="Close preview"`, hitSlop 16). Center: `expo-image` (`contentFit="contain"`, `cachePolicy="memory-disk"`, inline-sized to `SW-24 × SH*0.72` via `useWindowDimensions` so it re-flows on rotation) with an `ActivityIndicator` overlay while `loading`; if no `uri`, "No file to preview". Tapping the image area OR the backdrop closes (`onClose`). Footer caption "Tap anywhere to close". Reads `useSafeAreaInsets` for padding.
---

## 8. Shared / System

These render across the whole app rather than on any single screen. They have no route.

### 8.1 App Entry — `/` — `src/app/index.tsx`
**Purpose:** Pure routing gate; renders no UI.
```
<Redirect>  ? /(auth)/welcome        (not authenticated)
            | /(runner)/(tabs)       (role === 'runner')
            | /(customer)/(tabs)     (otherwise)
```
- **Data:** reads `isAuthenticated` + `role` from `authStore`.

### 8.2 Root Layout — `src/app/_layout.tsx`
**Purpose:** App-wide providers, font/asset loading, session validation, push registration. No screen chrome of its own.
```
SafeAreaProvider
└─ GestureHandlerRootView
   ├─ <Slot />              (the active route tree)
   ├─ ApiActivityBar        (global top network bar)
   ├─ OfflineBanner         (global offline banner)
   └─ ToastProvider         (global toast stack)
```
- **On mount:** installs error logging; `LogBox` ignores known native warnings; applies iOS system font; disables global font scaling; holds the native splash until fonts + auth hydration finish.
- **Session validation:** fetches `/user/profile` once on load; **only a real `401`/`403` logs out** (a transport-level failure / server hiccup keeps the cached session — fixed this pass). Aborts in-flight on unmount.
- **Push:** registers notifications only once the account has a verified phone/email.

### 8.3 Global overlays
| Overlay | Role |
|---|---|
| `ToastProvider` | Top-of-screen stack of animated toast pills (success / error / info / warning), auto-dismiss ~4s. |
| `ApiActivityBar` | Indeterminate top progress bar; fades in only after network activity persists >800ms. |
| `OfflineBanner` | **(new)** Slide-down "You're offline" banner driven by `networkStore` (fed by the axios interceptors); pings a health endpoint every ~10s in the foreground to auto-recover. |
| `LogoutSplash` | Full-screen brand splash shown during sign-in/logout transitions. |

---

## Appendix — Reusable Component Library

Shared building blocks in `src/components/ui/` (and a few cross-cutting ones). Items marked **(new)** were added in the 2026-07 design pass.

### Layout & chrome
| Component | Role |
|---|---|
| `GradientHeader` | Standard screen header: back button + title + optional trailing action. |
| `BottomActionBar` | Sticky safe-area bottom bar holding a primary action button. |
| `Card` | Surface container with padding + hairline border. |
| `Typography` | Text primitives (font families / sizes / weights). |
| `TabBarItem` | Icon-only floating-pill tab item (with optional unread badge). |
| `CurrentStepHero` | Verb-led headline + address/subtitle + ETA hero (tracking / active errand). |

### Inputs & controls
| Component | Role |
|---|---|
| `Button` | Primary / outline / ghost pill button; built-in light press haptic + loading state. |
| `Input` | Labeled text field with validation, error state, and built-in password show/hide toggle. |
| `OTPInput` | 6-digit code entry; SMS autofill, paste distribution, per-digit haptic, **error shake** (reduced-motion aware). |
| `RatingStars` | 5-star rating; interactive or read-only; **full a11y + selection haptics (new)**. |
| `SlideToConfirm` | **(new)** Slide-to-commit control for consequential actions (e.g. confirm delivery/completion); screen-reader activatable; self-fires success haptic. |

### Feedback & status
| Component | Role |
|---|---|
| `ErrorState` | **(new)** Inline "couldn't load + Retry" block; full and `compact` variants; used wherever a fetch can fail. |
| `EmptyState` / `RunnerEmptyState` | Illustration + title + description; **now support a primary CTA + secondary link (new)**. |
| `SuccessCheck` | **(new)** Animated success checkmark + optional confetti; reduced-motion aware; self-fires success haptic (payment / rate / payout / completion). |
| `Skeleton` / `Spinner` / `ErrandLoader` | Loading placeholders. |
| `Badge` | Small status/label pill. |
| `StatusTimeline` / `JourneyBeads` / `BookingStepIndicator` | Progress / journey indicators. |
| `PriceBreakdown` | Line-item fare breakdown with total. |
| `ToastProvider` / `ApiActivityBar` / `OfflineBanner` / `LogoutSplash` | Global system overlays (see §8.3). |

### Sheets, modals & media
| Component | Role |
|---|---|
| `BottomSheet` / `ExpandableSheet` / `FloatingModal` | Draggable / snap-point bottom sheets & modals. |
| `ConfirmModal` | Confirmation dialog; **destructive-variant warning haptic (new)**. |
| `ImagePickerModal` / `ImageLightbox` | Photo capture/pick + full-screen viewer. |
| `LegalModal` | **(new)** In-app Terms / Privacy content modal (used by Register). |
| `QuickBookFAB` | Center floating "+" quick-book button (customer tab bar). |
| `ErrandTypeIcon` | Errand-type glyph (PNG with hand-drawn SVG fallback). |

### Domain components
- **Customer** (`src/components/customer/`): `ActiveBookingCard`, `RecentErrandItem`, `BookingDetailSheet`, `EditProfileModal`, `SavedAddressSheet`, `BookingStepIndicator`, `DateTimePicker`, `ScheduleToggle`, `VehicleTypeSelector`, `PaymentMethodSelector`, `PromoCodeInput`, `PhotoGrid`, `OfferSlider`.
- **Runner** (`src/components/runner/`): `ActiveRunnerErrandCard`, `IncomingRequestModal`, `NegotiateOfferCard`, `ErrandDetailsCard`, `StatusActionButton`, `PerformanceMetric`, `VerificationBanner`, `CompletionModal`, `PhotoProofModal`, `ReceiptCaptureModal`, `RateCustomerModal`, `SignaturePad`, `RunnerActiveMap`, `DocumentUploadCard`, `DocumentViewer`.
- **Chat** (`src/components/chat/`): `ConversationList` (shared by both roles' inboxes).
- **Auth** (`src/components/auth/`): `OnboardingSlide`, `OnboardingIllustrations` (+ `AuthBrandMark`), `PasswordStrengthIndicator`, `SocialLoginButton`, `SocialLogos`, `InlineLogoutLink`.
- **Map** (`src/components/map/`): `OnDemandMap` / platform `index` wrappers around the HERE map view.

### State & data (referenced in screen blocks)
- **Stores** (`src/stores/`, zustand): `authStore`, `bookingStore`, `runnerStore`, `walletStore`, `chatStore`, `notificationStore`, `locationStore`, `toastStore`, `apiActivityStore`, `networkStore` **(new)**.
- **Hooks** (`src/hooks/`): `useAuth`, `useBooking`, `useBookingStatus`, `useChat`, `useCountdown`, `useEta`, `useIncomingRequest`, `useNotifications`, `useQuery`, `useRunnerTracking`, `useSupabaseRealtime`, `useForegroundInterval`, `useReducedMotion`, `useImagePicker`, `useDebounce`, `useKeyboard`, `useBackGuard`.
- **Services** (`src/services/`): `api`, `auth`, `booking`, `chat`, `config`, `geocoding`, `notification`, `payment`, `route`, `runner`, `user`, `cache`, `preload`, `supabase`.
