# ErrandGuy — UI Structure: Authentication & Onboarding

**Scope:** Shared screens before role-specific tabs load  
**Platform:** Mobile (React Native + Expo)  
**Route Group:** `(auth)/`

---

## Page Hierarchy

```
(auth)/
├── Splash Screen
├── Welcome / Onboarding Slides
├── Login (Phone/Email + OTP)
├── OTP Verification
├── Registration (Profile Setup)
└── Role Selection (Customer or Runner)
```

---

## 1. Splash Screen

```
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│                                          │
│                                          │
│                                          │
│                                          │
│           ┌──────────────┐               │
│           │  ErrandGuy   │               │
│           │    (Logo)    │               │
│           └──────────────┘               │
│                                          │
│                                          │
│                                          │
│                                          │
│                                          │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Full Screen Container**
  - Background: Pure white `#FFFFFF`
  - No scrolling, no status bar content
- **Logo (Centered)**
  - ErrandGuy wordmark + icon
  - Animation: Fade in 0→1 opacity, scale 85%→100% (spring: damping 18, stiffness 120)
  - Hold: 600ms → auto-navigate to Welcome or Home (based on auth state)
- **No other elements** — no spinner, no tagline, no illustration

---

## 2. Welcome / Onboarding Slides

```
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│         ┌────────────────────┐           │
│         │                    │           │
│         │   [Illustration]   │           │
│         │   (Lottie/SVG)     │           │
│         │                    │           │
│         └────────────────────┘           │
│                                          │
│         Book Any Errand                  │
│         Anytime, Anywhere                │
│                                          │
│         From deliveries to rides,        │
│         get things done with a tap.      │
│                                          │
│              ● ○ ○                       │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │          Get Started →             │  │
│  └────────────────────────────────────┘  │
│                                          │
│           Already have an account?       │
│               Log In                     │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Status Bar:** Dark icons on white background
- **Illustration Area** (top 40% of screen)
  - Lottie animation or static SVG per slide
  - Slides: Swipeable horizontally (3 slides)
    - Slide 1: "Book Any Errand" — delivery/task illustration
    - Slide 2: "Track in Real Time" — map/GPS illustration
    - Slide 3: "Safe & Reliable" — verified/shield illustration
- **Title Text**
  - Font: Montserrat Bold, 24px
  - Color: `#0F172A` (Slate 900)
- **Subtitle Text**
  - Font: Montserrat Regular, 16px
  - Color: `#475569` (Slate 600)
  - Max 2 lines
- **Page Indicator Dots**
  - Active: `#2563EB` (Blue 600), 10dp circle
  - Inactive: `#E2E8F0` (Slate 200), 8dp circle
- **"Get Started" Button** (Primary CTA)
  - Full width (minus 16dp horizontal margins)
  - Background: `#2563EB`, text: white, border-radius: 14dp
  - Height: 52dp
  - Position: Bottom third of screen
- **"Log In" Link**
  - Text: `#2563EB`, font: Montserrat Medium, 14px
  - Tap → navigates to Login screen

---

## 3. Login Screen

```
┌──────────────────────────────────────────┐
│                                          │
│  [← Back]                                │
│                                          │
│  Welcome back                            │
│  Log in to your account                  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📱  Phone number or email        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  🔒  Password               👁    │  │
│  └────────────────────────────────────┘  │
│                                          │
│           Forgot password?               │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │            Log In →                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ─────────── or continue with ────────── │
│                                          │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │  G  Google   │  │  f  Facebook     │  │
│  └──────────────┘  └──────────────────┘  │
│                                          │
│      Don't have an account? Sign Up      │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Back Button** (top-left)
  - Lucide `ArrowLeft` icon, 24dp, `#0F172A`
  - Navigates to Welcome screen
- **Header Text**
  - Title: "Welcome back" — Montserrat Bold, 24px, `#0F172A`
  - Subtitle: "Log in to your account" — Montserrat Regular, 16px, `#475569`
- **Phone/Email Input**
  - Component: `Input` (text variant)
  - Placeholder: "Phone number or email"
  - Left icon: Lucide `Smartphone` or `Mail`
  - Border: 1px `#E2E8F0`, focus border: `#2563EB`
  - Border-radius: 12dp, height: 52dp, padding: 16dp
- **Password Input**
  - Component: `Input` (password variant)
  - Left icon: Lucide `Lock`
  - Right icon: Lucide `Eye` / `EyeOff` toggle
  - Same styling as above
- **Forgot Password Link**
  - Text: `#2563EB`, Montserrat Medium, 14px
  - Tap → navigates to Forgot Password flow
- **Log In Button** (Primary CTA)
  - Full width, background `#2563EB`, white text
  - Height: 52dp, border-radius: 14dp
  - Loading state: spinner replaces text
- **Divider with "or continue with"**
  - Hairline `#E2E8F0` lines with centered text `#475569`
- **Social Login Buttons** (2-column row)
  - Google: Outline button, Google "G" icon, text: "Google"
  - Facebook: Outline button, Facebook "f" icon, text: "Facebook"
  - Border: 1px `#E2E8F0`, border-radius: 12dp, height: 48dp
- **Sign Up Link**
  - "Don't have an account?" in `#475569` + "Sign Up" in `#2563EB`
  - Tap → navigates to Registration screen

---

## 4. OTP Verification Screen

```
┌──────────────────────────────────────────┐
│                                          │
│  [← Back]                                │
│                                          │
│  Verify your number                      │
│  We sent a 6-digit code to              │
│  +63 917 •••• 567                        │
│                                          │
│                                          │
│    ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐  │
│    │ 4 │ │ 7 │ │ 2 │ │ _ │ │ _ │ │ _ │  │
│    └───┘ └───┘ └───┘ └───┘ └───┘ └───┘  │
│                                          │
│                                          │
│         Resend code in 0:45              │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │          Verify →                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│       Didn't receive it? Resend          │
│                                          │
│                                          │
│                                          │
│    ┌─────────────────────────────────┐   │
│    │     (System Keyboard)           │   │
│    │     1  2  3  4  5  6  7  8  9   │   │
│    │        0     ⌫                  │   │
│    └─────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Back Button** — Same as Login
- **Header Text**
  - Title: "Verify your number" — Montserrat Bold, 24px
  - Subtitle: masked phone number — Montserrat Regular, 16px, `#475569`
- **OTP Input** (6 cells)
  - Component: `Input` (OTP variant)
  - 6 individual boxes, 48×52dp each, gap: 12dp
  - Border: 2px `#E2E8F0`, active/filled: 2px `#2563EB`
  - Font: Montserrat Bold, 24px, centered
  - Auto-focus first cell, auto-advance on input
  - Auto-submit when all 6 digits entered
- **Countdown Timer**
  - "Resend code in 0:45" — Montserrat Regular, 14px, `#475569`
  - Counts down from 60 seconds
- **Verify Button** (Primary CTA)
  - Same style as Login button
  - Disabled state (grayed out) until all 6 digits entered
- **Resend Link**
  - Hidden during countdown, appears after timer expires
  - "Didn't receive it?" `#475569` + "Resend" `#2563EB`
  - Tap → triggers new OTP, resets countdown
- **Keyboard**
  - System numeric keyboard auto-opens

---

## 5. Registration (Profile Setup)

```
┌──────────────────────────────────────────┐
│                                          │
│  [← Back]                                │
│                                          │
│  Create your account                     │
│  Let's set up your profile               │
│                                          │
│         ┌──────────────┐                 │
│         │              │                 │
│         │   (Avatar)   │                 │
│         │   + Photo    │                 │
│         │              │                 │
│         └──────────────┘                 │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  👤  Full name                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📱  Phone number                 │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  ✉️   Email address               │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  🔒  Password               👁    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  🔒  Confirm password        👁    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📍  Default address (optional)   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ☐ I agree to the Terms of Service      │
│    and Privacy Policy                    │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │        Create Account →            │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Back Button** — Same as previous
- **Header Text**
  - Title: "Create your account" — Montserrat Bold, 24px
  - Subtitle: "Let's set up your profile" — Montserrat Regular, 16px
- **Avatar Upload**
  - Circular container, 96dp diameter
  - Default: Lucide `Camera` icon on `#DBEAFE` background
  - Tap → opens image picker (camera or gallery)
  - After upload: shows cropped profile image with blue ring
- **Input Fields** (scrollable form)
  - Full name — required, `Input` text, left icon: `User`
  - Phone number — pre-filled if registered via phone, left icon: `Smartphone`
  - Email — pre-filled if registered via email, left icon: `Mail`
  - Password — required, `Input` password variant, left icon: `Lock`, right: eye toggle
  - Confirm password — must match, same styling
  - Default address — optional, left icon: `MapPin`, tap opens address search/map picker
  - All inputs: 52dp height, 12dp radius, 1px `#E2E8F0` border
  - Validation errors: red `#EF4444` text below field, red border
  - Password requirements shown as hint text below: "Min 8 chars, 1 uppercase, 1 number, 1 special"
- **Terms Checkbox**
  - Checkbox: 20dp, unchecked: `#E2E8F0` border, checked: `#2563EB` fill + white check
  - Text: `#475569`, "Terms of Service" and "Privacy Policy" as blue links
- **Create Account Button** (Primary CTA)
  - Disabled until required fields filled + terms checked
  - Loading state with spinner on submit

---

## 6. Role Selection Screen

```
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│  How will you use ErrandGuy?             │
│  You can always switch later.            │
│                                          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │   ┌──────┐                         │  │
│  │   │  📦  │  I need errands done    │  │
│  │   └──────┘                         │  │
│  │             Customer               │  │
│  │   Post tasks, track runners,       │  │
│  │   and get things done.             │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │   ┌──────┐                         │  │
│  │   │  🏃  │  I want to earn money   │  │
│  │   └──────┘                         │  │
│  │             Errand Runner          │  │
│  │   Accept errands, complete them,   │  │
│  │   and earn on your own time.       │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │          Continue →                │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Header Text**
  - Title: "How will you use ErrandGuy?" — Montserrat Bold, 24px
  - Subtitle: "You can always switch later." — Montserrat Regular, 16px, `#475569`
- **Role Cards** (selectable, only one active)
  - Component: `Card` (selectable variant)
  - Dimensions: Full width (−32dp margins), height: ~120dp
  - Default: 1px `#E2E8F0` border, white background
  - Selected: 2px `#2563EB` border, `#DBEAFE` background tint
  - Spring animation on select (scale 0.98→1.0)
  - **Customer Card:**
    - Icon: Lucide `Package` in blue circle (`#DBEAFE` bg)
    - Title: "I need errands done" — Montserrat Bold, 18px
    - Role label: "Customer" — Montserrat Medium, 14px, `#2563EB`
    - Description: "Post tasks, track runners, and get things done." — 14px, `#475569`
  - **Runner Card:**
    - Icon: Lucide `Bike` or `Footprints` in blue circle
    - Title: "I want to earn money" — Montserrat Bold, 18px
    - Role label: "Errand Runner" — Montserrat Medium, 14px, `#2563EB`
    - Description: "Accept errands, complete them, and earn on your own time." — 14px, `#475569`
- **Continue Button** (Primary CTA)
  - Disabled until a role is selected
  - If "Customer" → navigates to Customer Home `(customer)/(tabs)/home`
  - If "Runner" → navigates to Runner Verification flow (document upload)

---

## 7. Forgot Password Screen

```
┌──────────────────────────────────────────┐
│                                          │
│  [← Back]                                │
│                                          │
│  Reset password                          │
│  Enter your email or phone number        │
│  and we'll send you a reset link.        │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  ✉️   Email or phone number       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │       Send Reset Link →           │  │
│  └────────────────────────────────────┘  │
│                                          │
│       Remember your password?            │
│            Back to Log In                │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Back Button** — Lucide `ArrowLeft`
- **Header Text**
  - Title: "Reset password" — Montserrat Bold, 24px
  - Subtitle: 2 lines of instruction text — 16px, `#475569`
- **Email/Phone Input**
  - Same styling as Login input
  - Left icon: `Mail`
- **Send Reset Link Button** (Primary CTA)
  - Full width, same style
  - On success → shows Toast "Reset link sent!" + navigates back
- **Back to Log In Link**
  - `#2563EB`, navigates to Login screen

---

## Navigation Flow Summary

```
App Launch
    │
    ├── Auth Token Exists? ──Yes──► Customer Home / Runner Home
    │
    └── No Token
         │
         ▼
    Splash Screen (800ms)
         │
         ▼
    Welcome / Onboarding (3 slides)
         │
         ├── "Get Started" ──► Registration
         │                         │
         │                         ▼
         │                    OTP Verification
         │                         │
         │                         ▼
         │                    Role Selection
         │                         │
         │                    ┌────┴────┐
         │                    ▼         ▼
         │              Customer    Runner
         │                Home    Verification
         │
         └── "Log In" ──► Login Screen
                              │
                              ├── Success ──► Home (based on role)
                              │
                              └── "Forgot?" ──► Reset Password
```

---

## Shared Design Tokens (Reference)

| Token | Value | Usage |
|---|---|---|
| Primary | `#2563EB` | CTAs, active states, links |
| Primary Light | `#DBEAFE` | Backgrounds, selected states |
| Surface | `#FFFFFF` | Cards, modals |
| Background | `#F8FAFC` | Screen backgrounds |
| Text Primary | `#0F172A` | Headings, body |
| Text Secondary | `#475569` | Labels, placeholders |
| Divider | `#E2E8F0` | Borders, separators |
| Danger | `#EF4444` | Errors, destructive actions |
| Font | Montserrat | Body + Bold for headings |
| Border Radius | 12–14dp | Inputs + cards |
| Button Height | 52dp | Primary CTAs |
| Input Height | 52dp | All form inputs |
| Min Tap Target | 48dp | All interactive elements |
