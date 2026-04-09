# ErrandGuy — Product Specification Document

**Version:** 1.0  
**Date:** March 19, 2026  
**Platform:** Android & iOS (React Native + Expo)  
**Backend:** Laravel 12 + Supabase (PostgreSQL)  
**State Management:** Zustand  
**Real-Time:** Supabase Realtime  

---

## 1. App Overview

ErrandGuy is an on-demand errand booking and service platform. Customers post errands (deliveries, purchases, bills payment, queuing, document processing, transportation, etc.), errand runners claim and complete them, and admins manage the ecosystem. Think of it as a ride-hailing app—but for any task, including the ride itself.

### 1.1 Tech Stack Summary

| Layer | Technology |
|---|---|
| Mobile App | React Native (Expo SDK 52+), TypeScript |
| Styling | NativeWind (Tailwind CSS for React Native) |
| Animations | React Native Reanimated + Moti |
| State | Zustand |
| Navigation | Expo Router (file-based) |
| Maps | Mapbox (`@rnmapbox/maps`) |
| Icons | Lucide Icons (lucide-react-native) |
| Backend API | Laravel 12 |
| Auth | Laravel Sanctum (token-based) |
| Database | Supabase (PostgreSQL 16) |
| Real-Time | Supabase Realtime (WebSocket channels) |
| Payments | Xendit (Card, GCash, Maya), Cash on Delivery |
| Push Notifications | Expo Notifications + Firebase Cloud Messaging |
| File Storage | Supabase Storage |
| Mobile Deployment | Expo (Android + iOS) |
| API Hosting | Laravel Forge (managed server provisioning) |
| Admin Web Hosting | Vercel |
| Database Hosting | Supabase (managed) |

### 1.2 Core Modules

#### Module 1 — Authentication & Onboarding
- Phone/email registration with OTP verification
- Social login (Google, Facebook)
- Role selection during onboarding (Customer or Errand Runner)
- Errand runner identity verification (ID upload, selfie, background check status)
- Secure token-based session management via Sanctum

#### Module 2 — Errand Booking (Customer)
- **Errand Type Selection:** Predefined categories:
  - Delivery (pick up → drop off)
  - Purchase & Deliver (buy something and deliver it)
  - Bills Payment (pay a bill on behalf)
  - Queue / Line Waiting
  - Document Processing (filing, claiming)
  - Transportation (passenger ride — customer is picked up and brought to destination)
  - Custom Errand (free-text description)
- **Transportation-Specific Rules:**
  - Only available with Motorcycle and Car vehicle types (Walk and Bicycle are excluded)
  - Pickup location = customer's current or chosen location; drop-off = destination
  - No item description or photos required — task detail input is simplified to pickup, destination, and optional notes
  - Status timeline changes: Accepted → En Route to Customer → Customer Picked Up → In Transit → Arrived → Completed
  - Enhanced safety features automatically activate during ride (see Module 10)
- **Task Detail Input:**
  - Pickup and drop-off locations (map picker + address autocomplete)
  - Item description, photos, special instructions
  - Estimated item value (for insurance/pricing)
  - Contact person details at pickup/drop-off
- **Schedule Selection:**
  - Immediate (ASAP)
  - Scheduled (date + time picker, up to 7 days ahead)
- **Pricing Mode (Customer Chooses One):**
  - **Fixed Price (Accept & Go):** System-calculated price based on:
    - Runner vehicle type rates (walk, bicycle, motorcycle, car — each has different per-km rate)
    - Distance (km between pickup and drop-off via road)
    - Base fee per errand type
    - Errand type surcharge
    - 8% platform service fee
    - Price shown in Philippine Peso (₱ / PHP)
    - Transparent breakdown shown before confirmation
    - Auto-matched to nearest available runner
  - **Negotiate Price (Haggle Mode):** Customer proposes their own price:
    - System shows recommended price range (min–max based on distance + vehicle type)
    - Customer enters their offered amount (must meet minimum floor: ₱30)
    - Booking broadcast to all nearby online runners with the offered price
    - Runners see the offer and can Accept or Skip
    - First runner to accept wins the booking
    - If no runner accepts within 5 minutes, customer is notified to raise the offer or switch to Fixed Price
- **Runner Matching:**
  - **Fixed Price:** Auto-match nearest available runner (1-to-1 assignment)
  - **Negotiate:** Broadcast to all nearby runners (first-accept-wins)

#### Module 3 — Errand Runner Dashboard
- Online/offline toggle
- Incoming errand requests with accept/decline (countdown timer) — shows pricing mode:
  - **Fixed Price:** Shows calculated payout, 30s countdown to accept/decline
  - **Negotiate:** Shows customer's offered price, runner can Accept or Skip (no countdown — stays open until someone accepts or expires)
- Active errand view with navigation, status updates, chat
- Earnings summary (daily, weekly, monthly)
- Errand history with details
- Document and vehicle management

#### Module 4 — Real-Time Tracking
- Live GPS location of runner on map (customer view)
- Runner broadcasts location every 5 seconds while active
- Status timeline (standard errands): Accepted → En Route to Pickup → At Pickup → In Transit → Arrived → Completed
- Status timeline (Transportation): Accepted → En Route to Customer → Arrived at Customer → Customer Picked Up → In Transit → Arrived at Destination → Completed
- ETAs computed and updated in real-time

#### Module 5 — In-App Communication
- Chat between customer and runner (text + image)
- Pre-canned quick messages ("I'm here", "Running late", etc.)
- VoIP or masked phone calling for privacy

#### Module 6 — Payments
- Multiple payment methods per booking:
  - Credit/Debit Card (via Xendit)
  - GCash (via Xendit)
  - Maya (via Xendit)
  - Cash on Delivery
- Wallet system (top-up balance, refunds credited to wallet)
- Receipts and transaction history
- Runner payout management (weekly/on-demand)

#### Module 7 — Ratings & Reviews
- Two-way ratings after errand completion (customer ↔ runner)
- 1–5 stars + optional written review
- Flagging system for inappropriate behavior
- Rating affects runner visibility and priority in matching

#### Module 8 — Notifications
- Push notifications for:
  - Booking confirmed / runner assigned
  - Runner status changes (en route, arrived, completed)
  - Payment processed / receipt
  - Promotions and announcements
  - [Transportation] Ride PIN ready — "Your ride PIN is 4729. Share it with your runner."
  - [Transportation] Route deviation safety check — "Are you okay? Your route seems different than expected."
  - [Transportation] Duration safety check — "Your ride is taking longer than expected. Are you okay?"
  - [SOS] Trusted contact alert — "[Name] triggered an SOS alert on ErrandGuy" + live location link
  - [Trip Share] Recipient notification — "[Name] shared their ErrandGuy trip with you" + tracking link
- In-app notification center with read/unread state

#### Module 9 — Admin Panel (Web)
- User management (customers, runners, suspensions)
- Booking oversight and dispute resolution
- Runner verification and approval workflow
- Analytics dashboard (bookings, revenue, active users, heatmaps)
- Promo code and pricing management
- System configuration (fees, radius, limits)
- Content management (FAQs, terms, announcements)

#### Module 10 — Support & Safety
- In-app help center / FAQ
- Report an issue (per booking)
- Emergency SOS button during active errands
- Insurance claim flow for lost/damaged items
- **Trusted Contacts Management:**
  - Customer can save 1–5 trusted contacts (name, phone number, relationship) in their profile
  - Contacts are stored securely and used for SOS alerts and trip sharing
  - Contacts can be added, edited, or removed anytime from profile settings

#### Module 10a — Enhanced Safety for Transportation (Passenger Rides)

When the errand type is **Transportation** (customer is physically in the vehicle), the following enhanced safety features automatically activate:

- **SOS Emergency Button (Persistent during ride):**
  - A prominent red SOS button is always visible on the tracking screen during a Transportation booking
  - SOS button appears after runner status reaches "Customer Picked Up" and remains until "Completed"
  - When pressed, a confirmation prompt appears (to prevent accidental triggers): "Are you in danger? This will alert your emergency contacts and ErrandGuy Safety."
  - Upon confirmation, the following actions happen simultaneously:
    1. **Auto-dial emergency contact:** The app immediately initiates a phone call to the customer's primary trusted contact. If the primary contact doesn't answer within 15 seconds, it auto-dials the next contact in the list.
    2. **Live location shared with all trusted contacts:** An SMS and/or push notification is sent to all saved trusted contacts containing:
       - Customer's name and a message: "[Name] triggered an SOS alert on ErrandGuy"
       - A live-updating map link showing the customer's real-time GPS position
       - Runner details: name, vehicle type, plate number, profile photo
       - The live link remains active for 60 minutes or until manually deactivated by the customer
    3. **Platform safety alert:** A distress signal is sent to the ErrandGuy backend safety team dashboard, including:
       - Customer ID, runner ID, booking ID
       - Real-time GPS coordinates of both customer and runner
       - Booking details (pickup, destination, vehicle info)
       - Timestamp of SOS trigger
       - Admin can monitor, call the customer, or escalate to local authorities
    4. **Ride recording flag:** The booking is flagged as "SOS Triggered" in the system for admin review, even if the customer later cancels the alert

- **Trip Sharing (Proactive — no SOS required):**
  - Available for **all errand types**, but prominently surfaced for Transportation bookings
  - Customer can tap "Share Trip" at any point during an active errand
  - Opens a share sheet to select a trusted contact or enter any phone number / messaging app
  - Recipient receives a link to a live tracking page showing:
    - Real-time map with runner's position
    - Runner profile: name, photo, rating, vehicle type, plate number
    - Route: pickup → destination
    - ETA
    - Errand status timeline
  - The shared link expires when the errand is completed or cancelled
  - No app download required for the recipient — opens in mobile browser
  - Customer can revoke the shared link at any time

- **Transportation Status Timeline (Modified):**
  - Accepted
  - En Route to Customer (runner heading to pickup)
  - Arrived at Customer (runner waiting for passenger)
  - Customer Picked Up (passenger in vehicle — enhanced safety activates)
  - In Transit (heading to destination)
  - Arrived at Destination
  - Completed

- **Additional Transportation Safety Measures:**
  - Runner's license plate number and vehicle photo are shown to customer before pickup
  - Customer must confirm a 4-digit ride PIN with the runner before boarding (PIN displayed on customer's screen, runner enters it to confirm correct passenger)
  - If the booking route deviates significantly (>500m from expected route for >2 minutes), the system automatically sends a safety check notification to the customer: "Are you okay? Your route seems different than expected." with options: "I'm fine" or "Send SOS"
  - Rides that take 2× longer than the estimated duration trigger an automatic safety check notification

---

## 2. User Roles & Flows

### 2.1 User Roles

| Role | Description | Access Level |
|---|---|---|
| **Customer** | Books errands, tracks progress, pays for services | Mobile app only |
| **Errand Runner** | Accepts and fulfills errands, earns money | Mobile app only |
| **Admin** | Manages platform, users, disputes, analytics | Web dashboard only |
| **Super Admin** | Full system access, configuration, role management | Web dashboard only |

### 2.2 Customer Flow

```
Registration & Auth
│
├─ 1. Open app → Splash screen → Welcome/Onboarding slides
├─ 2. Sign up (phone/email + OTP) or Social login (Google/Facebook)
├─ 3. Enter profile info: name, profile photo, default address
├─ 4. Role auto-set to "Customer"
└─ 5. Land on Customer Home screen
```

```
Booking an Errand
│
├─ 1. Tap "Book an Errand" on Home
├─ 2. Select errand type (Delivery, Purchase, Bills, Queue, Document, Transportation, Custom)
├─ 3. Enter task details:
│     ├─ Pickup location (map pin or address search)
│     ├─ Drop-off location
│     ├─ Item description + photos (optional)
│     ├─ Special instructions
│     └─ Estimated item value
├─ 4. Choose schedule: "Now" or pick date/time
├─ 5. Choose pricing mode:
│     ├─ ● Fixed Price — see calculated price breakdown (by distance + vehicle type)
│     └─ ○ Negotiate — enter your offered price (system shows recommended range)
├─ 6. View price breakdown (Fixed) or confirm your offer (Negotiate)
├─ 7. Select payment method (Card / GCash / Maya / Cash / Wallet)
├─ 8. Confirm booking
├─ 9a. [Fixed] System auto-matches nearest runner → 30s countdown
├─ 9b. [Negotiate] Booking broadcast to nearby runners → first to accept wins
├─ 10. Runner matched → Customer sees runner profile, vehicle type, ETA
├─ 11. Real-time tracking begins on map
├─ 12. Status updates: Accepted → En Route → At Pickup → In Transit → Arrived
├─ 12t. [Transportation] Status: Accepted → En Route to Customer → Arrived → Customer Picked Up → In Transit → Arrived at Destination
├─ 12t-a. [Transportation] Verify runner via plate number and vehicle photo before boarding
├─ 12t-b. [Transportation] Share 4-digit ride PIN with runner to confirm identity
├─ 12t-c. [Transportation] Enhanced safety active: SOS button visible, Trip Share available
├─ 13. Errand completed → Receipt shown
├─ 14. Rate & review the runner (1–5 stars + comment)
└─ 15. Return to Home
```

```
Managing Bookings
│
├─ View active errand with live tracking
├─ View booking history (past errands with details, receipts)
├─ Cancel an errand (before runner picks up — cancellation fee may apply)
├─ Report an issue on any past booking
└─ Re-book a previous errand (quick re-order)
```

```
Account & Wallet
│
├─ Edit profile (name, phone, email, photo, addresses)
├─ Manage trusted contacts (1–5 emergency contacts for SOS + trip sharing)
├─ Manage saved payment methods
├─ Top up wallet balance
├─ View transaction history (payments, refunds, wallet)
├─ Manage notification preferences
└─ Delete account (soft delete with 30-day grace period)
```

### 2.3 Errand Runner Flow

```
Registration & Verification
│
├─ 1. Open app → Sign up (phone/email + OTP)
├─ 2. Select role: "Errand Runner"
├─ 3. Enter personal info: full name, date of birth, address
├─ 4. Upload documents:
│     ├─ Valid government ID (front + back)
│     ├─ Selfie holding ID
│     └─ Vehicle info (if applicable): type, plate number, photo
├─ 5. Agree to terms & conditions
├─ 6. Status set to "Pending Verification"
├─ 7. Admin reviews and approves/rejects (1–48 hours)
├─ 8. Approved → Runner can go online
└─ 9. Rejected → Reason given, can re-submit
```

```
Accepting & Completing Errands
│
├─ 1. Toggle "Online" on Runner Dashboard
├─ 2. Receive errand request:
│     ├─ [Fixed Price] Sound + vibration + popup:
│     │   Shows: errand type, pickup/dropoff, distance, calculated payout
│     │   30-second countdown to accept/decline
│     └─ [Negotiate] Notification card in feed:
│         Shows: errand type, pickup/dropoff, distance, customer's offered price
│         Runner taps "Accept Offer" or skips (no countdown, first-come-first-served)
├─ 3. Accept → Navigate to pickup (in-app navigation or external maps)
├─ 4. Arrive at pickup → Tap "Arrived at Pickup"
├─ 5. Collect item/complete pickup task → Tap "Picked Up" (photo proof optional)
├─ 5t. [Transportation] Arrive at customer → Tap "Arrived at Customer"
├─ 5t-a. [Transportation] Customer shows 4-digit ride PIN → Runner enters PIN to confirm correct passenger
├─ 5t-b. [Transportation] Tap "Customer Picked Up" → Enhanced safety mode activates for customer
├─ 6. Navigate to drop-off / destination
├─ 7. Arrive at drop-off → Tap "Arrived"
├─ 8. Complete delivery → Tap "Completed" (photo proof + signature if required)
├─ 8t. [Transportation] Arrive at destination → Tap "Ride Completed"
├─ 9. Payment processed automatically (or collect cash)
├─ 10. Rate the customer (1–5 stars)
└─ 11. Return to available state, wait for next errand
```

```
Earnings & Payouts
│
├─ View daily / weekly / monthly earnings breakdown
├─ See per-errand earnings detail (base + distance + tips)
├─ Request instant payout (for a small fee) or wait for scheduled payout
├─ Set up bank account / e-wallet for payouts
└─ View payout history
```

```
Runner Account Management
│
├─ Update profile and vehicle info
├─ Upload/renew documents
├─ View performance metrics (acceptance rate, completion rate, avg rating)
├─ Set preferred errand types and working areas
└─ View and respond to admin notices
```

### 2.4 Admin Flow

```
Dashboard & Monitoring
│
├─ 1. Login via web dashboard (email + password + 2FA)
├─ 2. View real-time overview:
│     ├─ Active errands count and map view
│     ├─ Online runners count
│     ├─ Today's bookings, revenue, new users
│     └─ System health indicators
```

```
User Management
│
├─ Search / filter users (customers + runners)
├─ View user profile, booking history, ratings
├─ Suspend / ban / reactivate accounts (with reason)
├─ Reset user credentials
└─ Send targeted notifications to users
```

```
Runner Verification
│
├─ Queue of pending runner applications
├─ Review submitted documents (ID, selfie, vehicle)
├─ Approve or reject with notes
├─ Flag for re-submission
└─ Track verification metrics (avg approval time, rejection rate)
```

```
Booking & Dispute Management
│
├─ View all bookings (filterable by status, date, type, runner, customer)
├─ View individual booking detail (timeline, chat log, payment, rating)
├─ Handle disputes:
│     ├─ Customer filed a complaint → Review evidence
│     ├─ Issue refund (full or partial)
│     ├─ Warn / suspend runner
│     └─ Close dispute with resolution notes
```

```
Configuration & Content
│
├─ Set pricing rules (base fees, per-km rates, surcharges per errand type)
├─ Manage promo codes (create, activate, deactivate, usage limits)
├─ Configure service areas (geofences)
├─ Edit FAQs, terms of service, privacy policy
├─ Manage announcements and in-app banners
└─ Set system parameters (max distance, cancellation window, payout schedule)
```

### 2.5 Key Business Rules

| Rule | Detail |
|---|---|
| Cancellation (Customer) | Free within 1 minute of booking. After runner accepts: ₱30 cancellation fee |
| Cancellation (Runner) | Counts against acceptance rate. 3+ cancels/day → temporary suspension |
| No-show (Runner) | If runner doesn't arrive within 2× ETA, booking auto-cancelled, runner penalized |
| Minimum Rating | Runners below 3.5 avg rating after 20 errands get warning; below 3.0 → suspended |
| Max Active Errands | Runner can have only 1 active errand at a time |
| Booking Expiry | Scheduled bookings not matched within 30 min of start time → auto-cancelled + refund |
| Wallet Refunds | Refunds go to wallet by default; card refunds available on request (3–5 business days) |
| Negotiate Timeout | Negotiate bookings expire after 5 min with no runner acceptance → prompt customer to raise price or switch to Fixed |
| Negotiate Floor | Customer's offered price must be ≥ ₱30 (minimum errand fee) |
| Negotiate Ceiling | No max cap, but system warns if offer is 3× above recommended price (possible input error) |
| Vehicle Pricing | Rates vary by runner vehicle: Walk (cheapest) < Bicycle < Motorcycle < Car (highest per-km rate) |
| Transportation Vehicle Restriction | Transportation (passenger ride) bookings only available with Motorcycle and Car vehicle types — Walk and Bicycle are excluded |
| Ride PIN | Transportation bookings require 4-digit PIN verification between customer and runner before boarding |
| Route Deviation Alert | If a Transportation ride deviates >500m from expected route for >2 min, system sends safety check to customer |
| Ride Duration Alert | If a Transportation ride exceeds 2× estimated duration, system sends automatic safety check notification |
| SOS Alert Escalation | SOS auto-dials primary trusted contact; if no answer in 15s, dials next contact. Platform safety team is always notified simultaneously |
| SOS Link Expiry | Live location link sent to trusted contacts via SOS remains active for 60 minutes or until manually deactivated |
| Trip Share | Available for all errand types; shared link expires on errand completion or cancellation; opens in mobile browser (no app required) |

---

## 3. UI/UX Structure

### 3.1 Design Principles

- **Minimal First:** White-dominant backgrounds, generous whitespace, zero visual clutter. If an element doesn't need to be there, it isn't.
- **Blue & White Only:** The palette is strictly blue shades + white/near-white. No secondary accent colors, no greens, ambers, or purples.
- **Flat, Borderless Cards:** No left-border accents, no colored side strips. Cards are flat with hairline dividers or sufficient whitespace — shadows are avoided entirely or limited to a single barely-visible elevation (1dp max).
- **Lucide Icons Throughout:** All iconography uses `lucide-react-native`. No mixing of icon sets.
- **Trust-Forward:** Verified badges, visible ratings, transparent pricing — builds confidence.
- **Thumb-Friendly:** Primary actions within bottom-third of screen, large tap targets (48dp minimum).
- **Progressive Disclosure:** Show only what's needed at each step; details expand on demand.
- **Dark Mode Support:** Full light/dark theme with system preference detection (dark surfaces stay near-black, not colored).
- **Accessibility:** WCAG 2.1 AA compliant — contrast ratios, screen reader labels, scalable text.
- **Micro-Interactions:** Subtle spring animations on state changes; Lottie for loading/success/empty states.
- **Haptic Feedback:** Light vibration on key actions (booking confirmed, runner arrived).

### 3.2 Color System

> **Rule:** Only blue shades and white/near-white are used. Danger red is kept only for destructive actions (cancel, SOS, ban) — it is the single exception and must be used sparingly.

| Token | Light | Dark | Usage |
|---|---|---|---|
| Primary | `#2563EB` (Blue 600) | `#3B82F6` (Blue 500) | CTAs, active states, links |
| Primary Light | `#DBEAFE` (Blue 100) | `#1D3461` (Blue 900) | Pill backgrounds, subtle highlights |
| Primary Muted | `#93C5FD` (Blue 300) | `#60A5FA` (Blue 400) | Secondary text, icons, dividers |
| Surface | `#FFFFFF` | `#0F172A` | Cards, bottom sheets |
| Background | `#F8FAFC` (near-white) | `#0A0F1E` | Screen backgrounds |
| Text Primary | `#0F172A` (Slate 900) | `#F1F5F9` | Headings, body text |
| Text Secondary | `#475569` (Slate 600) | `#94A3B8` | Labels, captions, placeholders |
| Divider | `#E2E8F0` (Slate 200) | `#1E293B` | Subtle separators (no left-borders) |
| Danger | `#EF4444` (Red 500) | `#F87171` (Red 400) | Destructive only: cancel, SOS, ban — use sparingly |

### 3.3 Navigation Architecture (Expo Router)

```
app/
├── (auth)/                      # Auth group (no tab bar)
│   ├── welcome.tsx              # Welcome / onboarding slides
│   ├── login.tsx                # Phone/email + OTP entry
│   ├── verify-otp.tsx           # OTP verification
│   ├── register.tsx             # Profile setup
│   └── role-select.tsx          # Choose Customer or Runner
│
├── (customer)/                  # Customer tab group
│   ├── _layout.tsx              # Bottom tab navigator
│   ├── (tabs)/
│   │   ├── home.tsx             # Home — errand types, recent bookings
│   │   ├── activity.tsx         # Booking history
│   │   ├── notifications.tsx    # Notification center
│   │   └── profile.tsx          # Account, wallet, settings
│   ├── book/
│   │   ├── type.tsx             # Step 1: Select errand type
│   │   ├── details.tsx          # Step 2: Task details + locations
│   │   ├── schedule.tsx         # Step 3: Now or scheduled
│   │   ├── review.tsx           # Step 4: Price breakdown + payment method
│   │   └── confirm.tsx          # Step 5: Confirmation + searching for runner
│   ├── tracking/
│   │   └── [id].tsx             # Live tracking screen per booking
│   ├── chat/
│   │   └── [bookingId].tsx      # Chat with runner
│   ├── rate/
│   │   └── [bookingId].tsx      # Rate & review runner
│   └── wallet/
│       ├── index.tsx            # Wallet balance + history
│       └── top-up.tsx           # Add funds
│
├── (runner)/                    # Runner tab group
│   ├── _layout.tsx              # Bottom tab navigator
│   ├── (tabs)/
│   │   ├── home.tsx             # Dashboard — online toggle, incoming requests
│   │   ├── earnings.tsx         # Earnings breakdown
│   │   ├── history.tsx          # Completed errands
│   │   └── profile.tsx          # Account, documents, settings
│   ├── errand/
│   │   └── [id].tsx             # Active errand — navigation, status updates
│   ├── chat/
│   │   └── [bookingId].tsx      # Chat with customer
│   └── payout/
│       └── index.tsx            # Payout settings + history
│
└── _layout.tsx                  # Root layout (auth state check, theme provider)
```

### 3.4 Key Screens — Customer

#### Home Screen
```
┌─────────────────────────────────┐
│ 📍 Current Location        🔔  │  ← Header: location + notifications badge
│─────────────────────────────────│
│                                 │
│  Good morning, Juan! 👋        │  ← Greeting
│                                 │
│  ┌─────────────────────────────┐│
│  │  What do you need done?     ││  ← Search / book CTA
│  │  [Book an Errand →]         ││
│  └─────────────────────────────┘│
│                                 │
│  ── Quick Actions ──────────── │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│  │ 📦 │ │ 🛒 │ │ 💰 │ │ 📄 │  │  ← Errand type shortcuts
│  │Dlvr │ │Buy │ │Bill│ │Docs│  │
│  └────┘ └────┘ └────┘ └────┘  │
│  ┌────┐ ┌────┐                  │
│  │ 🚗 │ │ ⚙️  │                  │  ← Row 2: Transport + Custom
│  │Ride │ │More│                  │
│  └────┘ └────┘                  │
│                                 │
│  ── Active Errand ──────────── │
│  ┌─────────────────────────────┐│
│  │ 🟢 In Transit              ││  ← Current errand card (if any)
│  │ Runner: Mark D. → ETA 8min ││
│  │ [Track →]                   ││
│  └─────────────────────────────┘│
│                                 │
│  ── Recent Errands ─────────── │
│  ┌─────────────────────────────┐│
│  │ Mar 18 • Delivery • ₱120   ││
│  │ ★ 4.8 Mark D. • Completed  ││
│  │ [Re-book]                   ││
│  └─────────────────────────────┘│
│                                 │
├─────────────────────────────────┤
│ 🏠 Home  📋 Activity  🔔  👤  │  ← Bottom tabs
└─────────────────────────────────┘
```

#### Booking Flow (Multi-Step Bottom Sheet)
```
Step 1: Errand Type         Step 2: Details             Step 3: Schedule
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ Select Errand    │       │ Errand Details    │       │ When?            │
│                  │       │                  │       │                  │
│ ○ Delivery       │       │ Pickup:          │       │ ● Now (ASAP)     │
│ ○ Purchase       │       │ [📍 Set location]│       │ ○ Schedule       │
│ ○ Bills Payment  │       │                  │       │   [Date] [Time]  │
│ ○ Queue          │       │ Drop-off:        │       │                  │
│ ○ Documents      │       │ [📍 Set location]│       │                  │
│ ○ Transportation │       │                  │       │                  │
│ ○ Custom         │       │ Description:     │       │                  │
│                  │       │ [____________]   │       │ [Next →]         │
│ [Next →]         │       │ Photos: [+ Add]  │       └──────────────────┘
└──────────────────┘       │                  │
                           │ [Next →]         │
                           └──────────────────┘

Step 4: Review & Pay
┌──────────────────────────────────┐
│ Booking Summary                  │
│                                  │
│ Type: Delivery                   │
│ From: 123 Main St → To: SM Mall  │
│ Distance: 5.2 km                 │
│ Schedule: Now                    │
│                                  │
│ ── Pricing Mode ─────────────── │
│ [● Fixed Price] [○ Negotiate]    │
│                                  │
│ ── Price Breakdown (Fixed) ──── │
│ Base fee           ₱ 40.00      │
│ Distance (5.2 km)  ₱ 62.40      │  ← rate varies by vehicle type
│ Service fee        ₱  8.19      │
│ ─────────────────────────────    │
│ Total              ₱110.59      │
│ Vehicle: 🏍️ Motorcycle           │
│                                  │
│ ── Rates by Vehicle ─────────── │
│ 🚶 Walk          ₱ 88.13        │
│ 🚲 Bicycle       ₱ 99.36        │
│ 🏍️ Motorcycle    ₱110.59  ✓     │
│ 🚗 Car           ₱127.44        │
│                                  │
│ Payment: 💳 Visa •••• 4242 [✏️]  │
│                                  │
│ [Confirm Booking ₱110.59]        │
└──────────────────────────────────┘

Step 4: Review & Pay (Negotiate Mode)
┌──────────────────────────────────┐
│ Booking Summary                  │
│                                  │
│ Type: Delivery                   │
│ From: 123 Main St → To: SM Mall  │
│ Distance: 5.2 km                 │
│ Schedule: Now                    │
│                                  │
│ ── Pricing Mode ─────────────── │
│ [○ Fixed Price] [● Negotiate]    │
│                                  │
│ ── Set Your Offer ─────────────  │
│ Suggested range: ₱65 – ₱115     │
│                                  │
│  ₱ [  80.00  ]                   │  ← customer types their offer
│  ◄━━━━━━━●━━━━━━━━━━━━━━━►       │  ← slider (min ₱30, max 3× rec)
│  ₱30                    ₱345     │
│                                  │
│ ℹ️ Lower offers may take longer   │
│   to find a runner.              │
│                                  │
│ Payment: 💳 Visa •••• 4242 [✏️]  │
│                                  │
│ [Send Offer ₱80.00]              │
└──────────────────────────────────┘
```

#### Live Tracking Screen
```
┌─────────────────────────────────┐
│ [← Back]    Tracking    [Chat]  │
│─────────────────────────────────│
│                                 │
│   ┌───── MAP (full-width) ─────┐  │
│   │                          │  │
│   │  ◉ Pickup                │  │  ← Pickup: white circle, blue outline
│   │   │                      │  │
│   │   ╌╌╌╌╌╌╌ (route line)  │  │  ← Dashed blue polyline
│   │   │                      │  │
│   │  ▣ Runner                │  │  ← Runner: ErrandGuy branded marker
│   │   │                      │  │     (blue rounded square, logo icon)
│   │   ╌╌╌╌╌╌╌ (route line)  │  │
│   │   │                      │  │
│   │  ◉ Drop-off              │  │  ← Drop-off: filled blue pin
│   │                          │  │
│   └──────────────────────────┘  │
│                                 │
│  ── Status Timeline ────────── │
│  ✅ Accepted (2:30 PM)          │
│  ✅ En Route to Pickup (2:31)   │
│  🔵 At Pickup (now)             │
│  ○ In Transit                   │
│  ○ Arrived                      │
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🏃 Mark D.  ★ 4.8          ││
│  │ ETA: 8 min                  ││
│  │ [Call]  [Chat]  [SOS]       ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

#### Live Tracking Screen — Transportation (Passenger Ride)

> When the errand type is Transportation, the tracking screen is modified to emphasize passenger safety.
> SOS button is persistent and prominent. Trip Share is surfaced in the action bar.
> Ride PIN verification happens before "Customer Picked Up" status.

```
┌─────────────────────────────────┐
│ [← Back]   Your Ride    [Share]│  ← "Share" = Trip Share button
│─────────────────────────────────│
│                                 │
│   ┌───── MAP (full-width) ─────┐  │
│   │                          │  │
│   │  ◉ Your Location          │  │  ← Customer: blue dot
│   │   │                      │  │
│   │   ╔═══════ (route line)  │  │  ← Solid blue polyline
│   │   │                      │  │
│   │  ▣ Runner                │  │  ← Runner marker with heading
│   │   │                      │  │
│   │   ╔═══════ (route line)  │  │
│   │   │                      │  │
│   │  ◉ Destination            │  │  ← Filled blue pin
│   │                          │  │
│   └──────────────────────────┘  │
│                                 │
│  ── Ride PIN ─────────────── │
│  Your PIN: ┌─────────────┐    │  ← Shown before boarding
│            │  4  7  2  9  │    │     Runner must enter this
│            └─────────────┘    │     to confirm correct passenger
│  Share this PIN with your       │
│  runner to start the ride.      │
│                                 │
│  ── Status Timeline ───────── │
│  ✅ Accepted (2:30 PM)           │
│  ✅ En Route to You (2:31)       │
│  🟢 Arrived at You (now)         │  ← Waiting for PIN confirmation
│  ○ Customer Picked Up            │
│  ○ In Transit                    │
│  ○ Arrived at Destination         │
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🏃 Mark D.  ★ 4.8          ││
│  │ 🏍️ Motorcycle • ABC-1234     ││  ← Plate number shown
│  │ ETA: 3 min                  ││
│  │ [Call]  [Chat]  [Share Trip]││
│  └─────────────────────────────┘│
│                                 │
│  ┌─────────────────────────────┐│
│  │      🔴 SOS EMERGENCY        ││  ← Persistent red button
│  └─────────────────────────────┘│     Danger red #EF4444 bg
│                                 │     Always visible during ride
└─────────────────────────────────┘
```

#### SOS Confirmation Modal (FloatingModal)

> Triggered when customer taps the SOS button. Uses FloatingModal pattern.
> Requires explicit confirmation to prevent accidental triggers.

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← dimmed backdrop
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                               ░░
░░  ╔═════════════════════════╗  ░░
░░  ║                         ║  ░░
░░  ║   🚨 Emergency SOS      ║  ░░
░░  ║                         ║  ░░
░░  ║  Are you in danger?    ║  ░░
░░  ║                         ║  ░░
░░  ║  This will:            ║  ░░
░░  ║  • Call your emergency  ║  ░░
░░  ║    contact             ║  ░░
░░  ║  • Share your live     ║  ░░
░░  ║    location with your  ║  ░░
░░  ║    trusted contacts    ║  ░░
░░  ║  • Alert ErrandGuy     ║  ░░
░░  ║    Safety team         ║  ░░
░░  ║                         ║  ░░
░░  ║  [Cancel]  [🚨 SOS NOW] ║  ░░  ← SOS NOW = Danger red
░░  ║                         ║  ░░
░░  ╚═════════════════════════╝  ░░
░░                               ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```
- **Cancel:** Ghost button (text only, `#475569`)
- **SOS NOW:** Danger red button (`#EF4444`, white label, Lucide `AlertTriangle` icon)
- **No backdrop dismiss:** Tapping the backdrop does NOT close this modal (safety-critical)
```

### 3.5 Key Screens — Runner

#### Runner Dashboard (Home)
```
┌─────────────────────────────────┐
│ ErrandGuy Runner          🔔   │
│─────────────────────────────────│
│                                 │
│  ┌─────────────────────────────┐│
│  │  You are [🔴 Offline]       ││  ← Large toggle switch
│  │  Toggle to start receiving  ││
│  └─────────────────────────────┘│
│                                 │
│  ── Today's Stats ──────────── │
│  ┌────────┐ ┌────────┐ ┌─────┐ │
│  │₱ 620   │ │ 5      │ │ 4.9 │ │
│  │Earnings │ │Errands │ │Rating│ │
│  └────────┘ └────────┘ └─────┘ │
│                                 │
│  ── Recent Errands ─────────── │
│  ┌─────────────────────────────┐│
│  │ Delivery • ₱120 • 2:00 PM  ││
│  │ 3.2 km • ★ 5.0 from cust.  ││
│  └─────────────────────────────┘│
│  ┌─────────────────────────────┐│
│  │ Purchase • ₱185 • 12:30 PM ││
│  │ 5.1 km • ★ 4.0 from cust.  ││
│  └─────────────────────────────┘│
│                                 │
├─────────────────────────────────┤
│ 🏠 Home  💰 Earn  📋 Hist  👤 │
└─────────────────────────────────┘
```

#### Incoming Errand Request — Fixed Price (Floating Modal)

> Uses the `FloatingModal` component: white card, 20dp horizontal margin, 24dp corner radius,
> centered vertically. Backdrop is `rgba(15,23,42,0.45)`. Card springs up from below on appear.

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← dimmed backdrop
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                               ░░
░░  ╔═════════════════════════╗  ░░
░░  ║                         ║  ░░
░░  ║   New Errand Request    ║  ░░
░░  ║                         ║  ░░
░░  ║  ──────────────────────  ║  ░░
░░  ║  Delivery               ║  ░░
░░  ║  123 Main St            ║  ░░
░░  ║    ↓ 5.2 km             ║  ░░
░░  ║  SM City Mall           ║  ░░
░░  ║                         ║  ░░
░░  ║  Est. Pay   ₱120        ║  ░░
░░  ║  Fixed Price            ║  ░░
░░  ║                         ║  ░░
░░  ║  ┌──────────────────┐   ║  ░░
░░  ║  │ ████ 28s ░░░░░░░ │   ║  ░░  ← thin blue progress bar
░░  ║  └──────────────────┘   ║  ░░
░░  ║                         ║  ░░
░░  ║  [Decline]  [Accept →]  ║  ░░
░░  ║                         ║  ░░
░░  ╚═════════════════════════╝  ░░
░░                               ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```
- **Backdrop:** `rgba(15,23,42,0.45)`, blurs content behind card
- **Card:** White `#FFFFFF`, `borderRadius: 24`, no shadow, no border
- **Progress bar:** Blue `#2563EB` strip at top of card shrinks left-to-right over 30s
- **Decline:** Ghost button (text only, `#475569`)
- **Accept:** Filled blue button (`#2563EB`, white label)
- **Animation:** Card translates from Y+40 → 0, opacity 0→1 on mount; reverses on dismiss

#### Negotiate Feed (Runner Dashboard Tab)
```
┌─────────────────────────────────┐
│ 🤝 Available Offers        🔄  │  ← Pull-to-refresh
│─────────────────────────────────│
│                                 │
│  ┌─────────────────────────────┐│
│  │ 📦 Delivery                 ││
│  │ Offer: ₱80  (Rec: ₱65–115) ││  ← customer's offer vs range
│  │ 123 Main St → SM Mall      ││
│  │ 5.2 km • 1.3 km from you   ││
│  │ ⏱️ Expires in 3:42           ││
│  │ [Accept ₱80 →]              ││  ← first-come-first-served
│  └─────────────────────────────┘│
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🛒 Purchase                 ││
│  │ Offer: ₱150 (Rec: ₱90–160) ││
│  │ SM Megamall → Ayala Ave     ││
│  │ 8.1 km • 2.0 km from you   ││
│  │ ⏱️ Expires in 1:15           ││
│  │ [Accept ₱150 →]             ││
│  └─────────────────────────────┘│
│                                 │
│  No more offers nearby.         │
│                                 │
├─────────────────────────────────┤
│ 🏠 Home  🤝 Offers 📋 Hist 👤 │
└─────────────────────────────────┘
```

### 3.6 Shared UI Components

| Component | Description |
|---|---|
| `Button` | Primary, secondary, outline, danger, ghost variants. Loading state with spinner. |
| `Input` | Text, phone, OTP, password, textarea. Validation error display. |
| `Card` | Flat surface with rounded corners (14dp radius), hairline `#E2E8F0` border. No shadow. |
| `BottomSheet` | Draggable sheet for booking flow, details, filters. Floats with 16dp horizontal margin and 24dp bottom margin — does not stretch edge-to-edge (see FloatingModal pattern). |
| `FloatingModal` | **For important, blocking interactions only** (incoming errand request, booking confirmation, rating prompt, destructive action confirmation). Centered card over a dimmed backdrop `rgba(15,23,42,0.45)`. 20dp horizontal margin, 24dp border radius, white background, no shadow. Spring entry: Y+40→0, opacity 0→1. Dismiss via backdrop tap or swipe down. Do NOT use FloatingModal for informational tips, field explanations, or passive data — use `Popover` instead. |
| `Popover` | Lightweight tooltip/info bubble for non-critical details: fee explanations, field hints, pricing breakdowns, recommended ranges. Appears anchored to the triggering element (an `(i)` icon, a label tap, or a long-press). White card, 12dp border radius, 12dp padding, no backdrop overlay — content behind it remains fully interactive. Dismissed by tapping anywhere outside or a small `×` close icon. Animated: scale 0.85→1.0 + opacity 0→1 (100ms ease-out). |
| `MapView` | Mapbox (`@rnmapbox/maps`) with custom map styles, route polylines, distinct map markers (see Map Markers spec in 3.9), dark mode. |
| `StatusTimeline` | Vertical stepper showing errand progress with timestamps. |
| `Avatar` | User photo with fallback initials, online indicator, verified badge. |
| `RatingStars` | Interactive 1–5 star selector + display-only variant. |
| `Toast` | Non-blocking notifications (success, error, info) at top of screen. |
| `Skeleton` | Loading placeholder matching content shape. |
| `EmptyState` | Illustration + message + CTA for empty lists. |
| `Badge` | Notification count, status labels (Verified, Online, Pending). |
| `PriceBreakdown` | Itemized fee display with total. |
| `ChatBubble` | Message bubble with timestamp, read receipt, image support. |
| `SOSButton` | Persistent danger-red (`#EF4444`) button fixed to bottom of tracking screen during Transportation rides. Large tap target (56dp height, full width minus margins). Lucide `AlertTriangle` icon + "SOS EMERGENCY" label in white. Triggers `SOSConfirmationModal`. Available for all errand types but auto-surfaced and persistent for Transportation. |
| `SOSConfirmationModal` | FloatingModal variant for SOS confirmation. Lists the 3 actions that will happen (call contact, share location, alert safety team). Cancel + "SOS NOW" (danger red) buttons. Backdrop tap does NOT dismiss (safety-critical). |
| `TripShareSheet` | BottomSheet with list of trusted contacts + "Share via..." option for other apps. Shows preview of what the recipient will see (runner name, vehicle, live map). Toggle to stop sharing. |
| `RidePINDisplay` | Displays the 4-digit ride verification PIN in large, spaced digits. Blue `#2563EB` text on `#DBEAFE` background pill. Shown on customer's tracking screen before boarding. |
| `TrustedContactsList` | Profile settings component for managing emergency contacts. Add/edit/remove contacts (name, phone, relationship). Drag to reorder priority. Primary contact indicated with a star badge. |

### 3.7 Design Tokens & Typography

```
Font Family:     Montserrat (body), Montserrat Bold (headings)
Font Sizes:      xs: 12  sm: 14  base: 16  lg: 18  xl: 20  2xl: 24  3xl: 30
Spacing Scale:   4, 8, 12, 16, 20, 24, 32, 40, 48, 64
Border Radius:   sm: 6  md: 10  lg: 14  xl: 20  full: 9999
Shadow:          None by default. Cards use 1px #E2E8F0 border OR a barely-visible
                 elevation: { shadowColor: '#000', shadowOpacity: 0.04,
                 shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1 }
                 ── NO left-border accent strips. NO colored card borders.
Animation:       Spring (damping: 15, stiffness: 150) for sheets; 200ms ease for fades
Icons:           lucide-react-native — single icon set, no mixing
```

### 3.9 Map Markers & Route Design

#### Marker Types

| Marker | Appearance | Used For |
|---|---|---|
| **Pickup pin** | White circle (24dp) with a solid blue `#2563EB` ring (3dp stroke) + Lucide `MapPin` icon centered in blue | Pickup location on all map views |
| **Drop-off pin** | Solid blue `#2563EB` teardrop pin (Mapbox standard shape) with white `MapPin` icon inside | Drop-off / destination location |
| **Runner marker** | Blue `#2563EB` rounded square (36×36dp, 10dp radius) with the ErrandGuy logo mark (white monogram/icon) centered. Rotates to match runner’s heading. | Live runner position on customer tracking screen |
| **Customer marker** | Small white circle (20dp) with `#2563EB` border and a Lucide `User` icon in blue | Customer’s position when shown on runner navigation screen |
| **Dot waypoint** | 10dp filled blue `#93C5FD` circle (no outline) | Intermediate waypoints if route has stops |

#### Route Polyline

- **Style:** Dashed blue line `#2563EB` at 50% opacity while runner is **en route to pickup**; solid blue `#2563EB` (3dp width) once runner is **in transit** to drop-off
- **Source:** Mapbox Directions API — actual road-following route, not straight line
- **Updates:** Polyline re-fetches and redraws when runner deviates >50m from current route
- **Trim:** Already-traveled portion of the route fades to `#DBEAFE` (Blue 100) to show progress

#### Popover on Marker Tap

Tapping a marker on the map opens a `Popover` (not a modal) anchored above the marker:
- **Pickup popover:** Address text + "Change" link (if pre-errand)
- **Drop-off popover:** Address text + estimated travel time
- **Runner popover:** Runner name, star rating, vehicle type, ETA chip in blue
- Dismisses on map tap. No backdrop overlay.

### 3.8 Splash Screen

- **Background:** Pure white (`#FFFFFF`) — full screen, no gradient
- **Logo Animation:** ErrandGuy wordmark + icon fades in from 0→1 opacity and scales from 85%→100% via `react-native-reanimated` spring (damping: 18, stiffness: 120). Centered on screen.
- **Duration:** ~800ms total — logo appears, holds for 600ms, then navigates to auth/home
- **No spinner, no tagline, no background illustration** — just the logo on white
- **Status bar:** Light content (dark icons on white)

---

## 4. Database Schema (Supabase / PostgreSQL)

### 4.1 Entity Relationship Overview

```
users ─────────────┐
  │                 │
  │ 1:1             │ 1:N
  ▼                 │
runner_profiles     │
  │                 │
  │ 1:N             │
  ▼                 │
runner_documents    │
                    │
bookings ◄──────────┘
  │
  ├── 1:1 → payments
  ├── 1:N → booking_status_logs
  ├── 1:N → messages (chat)
  ├── 1:N → reviews
  └── 1:N → runner_locations (tracking)

users ──── 1:N ──── wallet_transactions
users ──── 1:N ──── payment_methods
users ──── 1:N ──── notifications
users ──── 1:N ──── saved_addresses

admin_users (separate table for web dashboard)
promo_codes
errand_types
system_config
dispute_tickets
```

### 4.2 Table Definitions

#### `users`
```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(20) UNIQUE,
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    avatar_url      TEXT,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'runner')),
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
    email_verified  BOOLEAN DEFAULT FALSE,
    phone_verified  BOOLEAN DEFAULT FALSE,
    default_lat     DECIMAL(10, 7),
    default_lng     DECIMAL(10, 7),
    fcm_token       TEXT,                    -- Firebase push token
    wallet_balance  DECIMAL(12, 2) DEFAULT 0.00,
    avg_rating      DECIMAL(3, 2) DEFAULT 0.00,
    total_ratings   INTEGER DEFAULT 0,
    last_active_at  TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,             -- Soft delete
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);
```

#### `runner_profiles`
```sql
CREATE TABLE runner_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
    vehicle_type        VARCHAR(30) CHECK (vehicle_type IN ('walk', 'bicycle', 'motorcycle', 'car')),
    vehicle_plate       VARCHAR(20),
    vehicle_photo_url   TEXT,
    is_online           BOOLEAN DEFAULT FALSE,
    current_lat         DECIMAL(10, 7),
    current_lng         DECIMAL(10, 7),
    last_location_at    TIMESTAMPTZ,
    acceptance_rate     DECIMAL(5, 2) DEFAULT 100.00,
    completion_rate     DECIMAL(5, 2) DEFAULT 100.00,
    total_errands       INTEGER DEFAULT 0,
    total_earnings      DECIMAL(12, 2) DEFAULT 0.00,
    preferred_types     TEXT[],              -- Array of errand type slugs
    working_area_lat    DECIMAL(10, 7),      -- Center of working area
    working_area_lng    DECIMAL(10, 7),
    working_area_radius INTEGER DEFAULT 10,  -- km
    bank_name           VARCHAR(100),
    bank_account_number VARCHAR(50),         -- Encrypted at app level
    ewallet_number      VARCHAR(20),
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_runner_profiles_status ON runner_profiles(verification_status);
CREATE INDEX idx_runner_online ON runner_profiles(is_online) WHERE is_online = TRUE;
CREATE INDEX idx_runner_location ON runner_profiles USING gist (
    point(current_lng, current_lat)
);
```

#### `runner_documents`
```sql
CREATE TABLE runner_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    runner_id       UUID NOT NULL REFERENCES runner_profiles(id) ON DELETE CASCADE,
    document_type   VARCHAR(30) NOT NULL
                    CHECK (document_type IN ('government_id_front', 'government_id_back', 'selfie_with_id', 'vehicle_photo', 'drivers_license')),
    file_url        TEXT NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by     UUID REFERENCES admin_users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_runner_docs_runner ON runner_documents(runner_id);
CREATE INDEX idx_runner_docs_status ON runner_documents(status);
```

#### `errand_types`
```sql
CREATE TABLE errand_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(50) UNIQUE NOT NULL, -- 'delivery', 'purchase', 'bills', etc.
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    icon_name       VARCHAR(50),                 -- Icon identifier for frontend
    base_fee        DECIMAL(10, 2) NOT NULL,     -- Base fee in PHP (₱)
    per_km_walk     DECIMAL(10, 2) NOT NULL,     -- Per-km rate for walking runners
    per_km_bicycle  DECIMAL(10, 2) NOT NULL,     -- Per-km rate for bicycle
    per_km_motorcycle DECIMAL(10, 2) NOT NULL,   -- Per-km rate for motorcycle
    per_km_car      DECIMAL(10, 2) NOT NULL,     -- Per-km rate for car
    surcharge       DECIMAL(10, 2) DEFAULT 0.00,
    min_negotiate_fee DECIMAL(10, 2) DEFAULT 30.00, -- Minimum allowed negotiate price
    is_active       BOOLEAN DEFAULT TRUE,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Example rates (PHP ₱):
-- Delivery:       base=₱40, walk=₱8/km, bicycle=₱10/km, motorcycle=₱12/km, car=₱15/km
-- Purchase:       base=₱50, walk=₱8/km, bicycle=₱10/km, motorcycle=₱12/km, car=₱15/km
-- Bills:          base=₱35, walk=₱8/km, bicycle=₱10/km, motorcycle=₱12/km, car=₱15/km
-- Transportation: base=₱50, walk=NULL, bicycle=NULL, motorcycle=₱14/km, car=₱18/km
--                 (Walk and Bicycle are NULL / excluded for Transportation)
```

#### `bookings`
```sql
CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_number      VARCHAR(20) UNIQUE NOT NULL, -- Human-readable: EG-20260319-XXXX
    customer_id         UUID NOT NULL REFERENCES users(id),
    runner_id           UUID REFERENCES users(id),
    errand_type_id      UUID NOT NULL REFERENCES errand_types(id),
    status              VARCHAR(30) NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                            'pending',           -- Waiting for runner match
                            'matched',           -- Runner assigned, not yet accepted
                            'accepted',          -- Runner accepted
                            'en_route_pickup',   -- Runner heading to pickup
                            'at_pickup',         -- Runner arrived at pickup
                            'en_route_customer', -- [Transportation] Runner heading to customer
                            'at_customer',       -- [Transportation] Runner arrived, waiting for passenger
                            'customer_picked_up',-- [Transportation] Passenger in vehicle, enhanced safety active
                            'in_transit',        -- Runner heading to drop-off / destination
                            'arrived',           -- Runner at drop-off / destination
                            'completed',         -- Errand done
                            'cancelled',         -- Cancelled by customer or system
                            'failed'             -- Failed / disputed
                        )),

    -- Locations
    pickup_address      TEXT NOT NULL,
    pickup_lat          DECIMAL(10, 7) NOT NULL,
    pickup_lng          DECIMAL(10, 7) NOT NULL,
    pickup_contact_name VARCHAR(100),
    pickup_contact_phone VARCHAR(20),
    dropoff_address     TEXT NOT NULL,
    dropoff_lat         DECIMAL(10, 7) NOT NULL,
    dropoff_lng         DECIMAL(10, 7) NOT NULL,
    dropoff_contact_name VARCHAR(100),
    dropoff_contact_phone VARCHAR(20),

    -- Task details
    description         TEXT,
    special_instructions TEXT,
    item_photos         TEXT[],                    -- Array of Supabase Storage URLs
    estimated_item_value DECIMAL(10, 2),

    -- Scheduling
    schedule_type       VARCHAR(10) NOT NULL DEFAULT 'now'
                        CHECK (schedule_type IN ('now', 'scheduled')),
    scheduled_at        TIMESTAMPTZ,               -- NULL if immediate

    -- Pricing
    pricing_mode        VARCHAR(10) NOT NULL DEFAULT 'fixed'
                        CHECK (pricing_mode IN ('fixed', 'negotiate')),
    vehicle_type_rate   VARCHAR(30),             -- Vehicle type used for pricing (walk/bicycle/motorcycle/car)
    distance_km         DECIMAL(8, 2),
    base_fee            DECIMAL(10, 2) NOT NULL,
    distance_fee        DECIMAL(10, 2) NOT NULL,
    service_fee         DECIMAL(10, 2) NOT NULL,
    surcharge           DECIMAL(10, 2) DEFAULT 0.00,
    promo_discount      DECIMAL(10, 2) DEFAULT 0.00,
    total_amount        DECIMAL(10, 2) NOT NULL,     -- Final agreed price in PHP (₱)
    customer_offer      DECIMAL(10, 2),              -- Customer's offered price (negotiate mode only)
    recommended_min     DECIMAL(10, 2),              -- System-suggested min price (negotiate mode)
    recommended_max     DECIMAL(10, 2),              -- System-suggested max price (negotiate mode)
    runner_payout       DECIMAL(10, 2),              -- Amount runner receives (total - platform fee)
    negotiate_expires_at TIMESTAMPTZ,                -- When negotiate offer expires (5 min)

    -- Proof of completion
    pickup_photo_url    TEXT,
    delivery_photo_url  TEXT,
    signature_url       TEXT,

    -- Timestamps
    matched_at          TIMESTAMPTZ,
    accepted_at         TIMESTAMPTZ,
    picked_up_at        TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    cancelled_by        VARCHAR(20) CHECK (cancelled_by IN ('customer', 'runner', 'system', 'admin')),

    -- Promo
    promo_code_id       UUID REFERENCES promo_codes(id),

    -- Transportation-specific
    ride_pin            CHAR(4),                     -- 4-digit PIN for Transportation bookings (customer shares with runner)
    ride_pin_verified   BOOLEAN DEFAULT FALSE,       -- TRUE after runner enters correct PIN
    is_transportation   BOOLEAN DEFAULT FALSE,       -- TRUE if errand type is Transportation
    sos_triggered       BOOLEAN DEFAULT FALSE,       -- TRUE if SOS was triggered during this booking
    trip_share_token    VARCHAR(64),                  -- Unique token for public trip share link
    trip_share_active   BOOLEAN DEFAULT FALSE,        -- Whether trip sharing is currently active

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_runner ON bookings(runner_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);
CREATE INDEX idx_bookings_number ON bookings(booking_number);
CREATE INDEX idx_bookings_scheduled ON bookings(scheduled_at) WHERE schedule_type = 'scheduled';
CREATE INDEX idx_bookings_trip_share ON bookings(trip_share_token) WHERE trip_share_token IS NOT NULL;
```

#### `trusted_contacts`
```sql
CREATE TABLE trusted_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    relationship    VARCHAR(50),                  -- e.g. 'Mother', 'Friend', 'Spouse'
    priority        INTEGER NOT NULL DEFAULT 0,   -- Lower = higher priority (0 = primary contact)
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trusted_contacts_user ON trusted_contacts(user_id);
-- Max 5 contacts per user enforced at application level
```

#### `sos_alerts`
```sql
CREATE TABLE sos_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL REFERENCES bookings(id),
    customer_id     UUID NOT NULL REFERENCES users(id),
    runner_id       UUID NOT NULL REFERENCES users(id),
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    customer_lat    DECIMAL(10, 7) NOT NULL,      -- Customer location at trigger time
    customer_lng    DECIMAL(10, 7) NOT NULL,
    runner_lat      DECIMAL(10, 7),               -- Runner location at trigger time
    runner_lng      DECIMAL(10, 7),
    contacts_notified TEXT[],                     -- Array of phone numbers notified
    live_link_token VARCHAR(64) UNIQUE NOT NULL,   -- Token for the live location sharing link
    live_link_expires_at TIMESTAMPTZ NOT NULL,     -- 60 min after trigger
    resolved_at     TIMESTAMPTZ,                  -- When alert was resolved/deactivated
    resolution_note TEXT,                          -- Admin resolution notes
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'resolved', 'escalated')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sos_alerts_booking ON sos_alerts(booking_id);
CREATE INDEX idx_sos_alerts_status ON sos_alerts(status) WHERE status = 'active';
```

#### `booking_status_logs`
```sql
CREATE TABLE booking_status_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    status      VARCHAR(30) NOT NULL,
    changed_by  UUID,                        -- User who triggered the change
    note        TEXT,
    lat         DECIMAL(10, 7),              -- Location when status changed
    lng         DECIMAL(10, 7),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_status_logs_booking ON booking_status_logs(booking_id);
CREATE INDEX idx_status_logs_created ON booking_status_logs(created_at);
```

#### `runner_locations`
```sql
CREATE TABLE runner_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    runner_id   UUID NOT NULL REFERENCES users(id),
    lat         DECIMAL(10, 7) NOT NULL,
    lng         DECIMAL(10, 7) NOT NULL,
    heading     DECIMAL(5, 2),               -- Direction in degrees
    speed       DECIMAL(6, 2),               -- km/h
    accuracy    DECIMAL(8, 2),               -- GPS accuracy in meters
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Partitioned or TTL: auto-delete after 24 hours
CREATE INDEX idx_runner_loc_booking ON runner_locations(booking_id, created_at DESC);
CREATE INDEX idx_runner_loc_runner ON runner_locations(runner_id);
```

#### `payments`
```sql
CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id          UUID NOT NULL REFERENCES bookings(id),
    customer_id         UUID NOT NULL REFERENCES users(id),
    amount              DECIMAL(10, 2) NOT NULL,
    currency            VARCHAR(3) DEFAULT 'PHP',
    method              VARCHAR(20) NOT NULL
                        CHECK (method IN ('card', 'gcash', 'maya', 'wallet', 'cash')),
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded')),
    gateway_tx_id       VARCHAR(255),            -- Xendit payment request ID
    gateway_response    JSONB,                   -- Raw gateway response (sanitized)
    paid_at             TIMESTAMPTZ,
    refund_amount       DECIMAL(10, 2),
    refunded_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_payments_status ON payments(status);
```

#### `payment_methods`
```sql
CREATE TABLE payment_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('card', 'gcash', 'maya')),
    label           VARCHAR(50),                 -- "Visa ending 4242"
    gateway_token   VARCHAR(255) NOT NULL,       -- Tokenized by gateway, never raw card data
    is_default      BOOLEAN DEFAULT FALSE,
    last_four       VARCHAR(4),
    card_brand      VARCHAR(20),
    expires_at      DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_user ON payment_methods(user_id);
```

#### `wallet_transactions`
```sql
CREATE TABLE wallet_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('top_up', 'payment', 'refund', 'payout', 'bonus', 'adjustment')),
    amount          DECIMAL(10, 2) NOT NULL,     -- Positive for credit, negative for debit
    balance_after   DECIMAL(12, 2) NOT NULL,
    reference_id    UUID,                        -- booking_id or payment_id
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at DESC);
```

#### `messages`
```sql
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT,
    image_url       TEXT,
    is_system       BOOLEAN DEFAULT FALSE,       -- System-generated messages
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_booking ON messages(booking_id, created_at);
```

#### `reviews`
```sql
CREATE TABLE reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL REFERENCES bookings(id),
    reviewer_id     UUID NOT NULL REFERENCES users(id),
    reviewee_id     UUID NOT NULL REFERENCES users(id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    is_flagged      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(booking_id, reviewer_id)              -- One review per user per booking
);

CREATE INDEX idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX idx_reviews_booking ON reviews(booking_id);
```

#### `notifications`
```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    type            VARCHAR(30) NOT NULL,        -- 'booking_update', 'payment', 'promo', 'system'
    data            JSONB,                       -- Deep link data
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
```

#### `saved_addresses`
```sql
CREATE TABLE saved_addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       VARCHAR(50) NOT NULL,            -- "Home", "Office", etc.
    address     TEXT NOT NULL,
    lat         DECIMAL(10, 7) NOT NULL,
    lng         DECIMAL(10, 7) NOT NULL,
    is_default  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_addresses_user ON saved_addresses(user_id);
```

#### `promo_codes`
```sql
CREATE TABLE promo_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(30) UNIQUE NOT NULL,
    description     TEXT,
    discount_type   VARCHAR(10) NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
    discount_value  DECIMAL(10, 2) NOT NULL,
    max_discount    DECIMAL(10, 2),              -- Cap for percentage discounts
    min_order       DECIMAL(10, 2) DEFAULT 0,
    usage_limit     INTEGER,                     -- Total uses allowed (NULL = unlimited)
    per_user_limit  INTEGER DEFAULT 1,
    used_count      INTEGER DEFAULT 0,
    valid_from      TIMESTAMPTZ NOT NULL,
    valid_until     TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promo_code ON promo_codes(code);
CREATE INDEX idx_promo_active ON promo_codes(is_active, valid_until);
```

#### `admin_users`
```sql
CREATE TABLE admin_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'super_admin')),
    two_factor_secret VARCHAR(255),
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### `dispute_tickets`
```sql
CREATE TABLE dispute_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL REFERENCES bookings(id),
    reported_by     UUID NOT NULL REFERENCES users(id),
    category        VARCHAR(30) NOT NULL
                    CHECK (category IN ('item_damaged', 'item_lost', 'wrong_delivery', 'runner_behavior', 'payment_issue', 'other')),
    description     TEXT NOT NULL,
    evidence_urls   TEXT[],                      -- Photos / screenshots
    status          VARCHAR(20) DEFAULT 'open'
                    CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
    resolution      TEXT,
    resolved_by     UUID REFERENCES admin_users(id),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_disputes_booking ON dispute_tickets(booking_id);
CREATE INDEX idx_disputes_status ON dispute_tickets(status);
```

#### `system_config`
```sql
CREATE TABLE system_config (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    description     TEXT,
    updated_by      UUID REFERENCES admin_users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Example rows:
-- ('cancellation_fee', '{"amount": 30}', 'Fee for late cancellations')
-- ('max_matching_radius_km', '{"value": 15}', 'Max distance to search runners')
-- ('runner_payout_percentage', '{"value": 85}', 'Runner gets 85% of total')
-- ('matching_timeout_seconds', '{"value": 30}', 'Time runner has to accept')
```

### 4.3 Row-Level Security (RLS) Policies

```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own profile
CREATE POLICY users_self ON users
    FOR ALL USING (auth.uid() = id);

-- Customers see their own bookings; runners see bookings assigned to them
CREATE POLICY bookings_customer ON bookings
    FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY bookings_runner ON bookings
    FOR SELECT USING (auth.uid() = runner_id);

-- Messages: only participants of the booking
CREATE POLICY messages_participants ON messages
    FOR ALL USING (
        auth.uid() IN (
            SELECT customer_id FROM bookings WHERE id = booking_id
            UNION
            SELECT runner_id FROM bookings WHERE id = booking_id
        )
    );

-- Notifications: own only
CREATE POLICY notifications_self ON notifications
    FOR ALL USING (auth.uid() = user_id);

-- Wallet: own only
CREATE POLICY wallet_self ON wallet_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Payments: own only
CREATE POLICY payments_self ON payments
    FOR SELECT USING (auth.uid() = customer_id);
```

---

## 5. API Endpoints & Architecture (Laravel)

### 5.1 Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                  React Native App                    │
│              (Expo + Zustand + Axios)                │
└──────────────────┬───────────────────────────────────┘
                   │ HTTPS (JSON)
                   ▼
┌──────────────────────────────────────────────────────┐
│               Laravel API (v1)                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Sanctum  │  │ Rate     │  │ Request           │  │
│  │ Auth     │  │ Limiter  │  │ Validation        │  │
│  └────┬─────┘  └────┬─────┘  └────┬──────────────┘  │
│       └──────────────┴─────────────┘                 │
│                      │                               │
│  ┌───────────────────▼──────────────────────────┐    │
│  │              Controllers                      │    │
│  │  Auth │ Booking │ Runner │ Payment │ User     │    │
│  └───────────────────┬──────────────────────────┘    │
│                      │                               │
│  ┌───────────────────▼──────────────────────────┐    │
│  │              Services (Business Logic)        │    │
│  │  BookingService │ MatchingService │ PaymentSvc│    │
│  └───────────────────┬──────────────────────────┘    │
│                      │                               │
│  ┌───────────────────▼──────────────────────────┐    │
│  │              Repositories (Data Access)       │    │
│  └───────────────────┬──────────────────────────┘    │
│                      │                               │
└──────────────────────┼───────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
    ┌──────────────┐     ┌──────────────────┐
    │  Supabase    │     │  External APIs   │
    │  PostgreSQL  │     │  Xendit/       │
    │  + Storage   │     │  FCM/Mapbox      │
    └──────────────┘     └──────────────────┘
```

### 5.2 Base Configuration

```
Base URL:       https://api.errandguy.app/api/v1
Content-Type:   application/json
Auth Header:    Authorization: Bearer {sanctum_token}
Rate Limits:    60 requests/minute (auth), 20 requests/minute (guest)
```

### 5.3 Standard Response Format

```json
// Success
{
    "success": true,
    "data": { ... },
    "message": "Booking created successfully"
}

// Error
{
    "success": false,
    "message": "Validation failed",
    "errors": {
        "pickup_address": ["The pickup address field is required."],
        "errand_type_id": ["The selected errand type is invalid."]
    }
}

// Paginated
{
    "success": true,
    "data": [ ... ],
    "meta": {
        "current_page": 1,
        "per_page": 20,
        "total": 85,
        "last_page": 5
    }
}
```

### 5.4 API Endpoints

#### 5.4.1 Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Register new user (phone/email + password) |
| POST | `/auth/login` | No | Login with credentials, returns Sanctum token |
| POST | `/auth/send-otp` | No | Send OTP to phone/email |
| POST | `/auth/verify-otp` | No | Verify OTP code |
| POST | `/auth/social-login` | No | Login via Google/Facebook token |
| POST | `/auth/logout` | Yes | Revoke current token |
| POST | `/auth/refresh` | Yes | Refresh session |
| POST | `/auth/forgot-password` | No | Send password reset link |
| POST | `/auth/reset-password` | No | Reset password with token |

**POST `/auth/register`**
```json
// Request
{
    "phone": "+639171234567",
    "email": "juan@email.com",
    "password": "SecureP@ss123",
    "full_name": "Juan Dela Cruz",
    "role": "customer"
}

// Response 201
{
    "success": true,
    "data": {
        "user": { "id": "uuid", "full_name": "Juan Dela Cruz", "role": "customer" },
        "token": "1|abc123...",
        "requires_otp": true
    }
}
```

**POST `/auth/login`**
```json
// Request
{
    "login": "+639171234567",  // phone or email
    "password": "SecureP@ss123"
}

// Response 200
{
    "success": true,
    "data": {
        "user": { "id": "uuid", "full_name": "...", "role": "customer", "avatar_url": "...", "wallet_balance": 250.00 },
        "token": "1|abc123...",
        "runner_profile": null
    }
}
```

#### 5.4.2 User Profile

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/user/profile` | Yes | Get current user profile |
| PUT | `/user/profile` | Yes | Update profile (name, avatar, etc.) |
| POST | `/user/avatar` | Yes | Upload avatar image |
| PUT | `/user/fcm-token` | Yes | Update FCM push token |
| DELETE | `/user/account` | Yes | Soft-delete account |
| GET | `/user/addresses` | Yes | List saved addresses |
| POST | `/user/addresses` | Yes | Add saved address |
| DELETE | `/user/addresses/{id}` | Yes | Remove saved address |

#### 5.4.3 Bookings (Customer)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/bookings` | Yes | List customer's bookings (paginated, filterable) |
| POST | `/bookings` | Yes | Create a new booking |
| GET | `/bookings/{id}` | Yes | Get booking details |
| POST | `/bookings/{id}/cancel` | Yes | Cancel a booking |
| GET | `/bookings/{id}/track` | Yes | Get current runner location + status |
| POST | `/bookings/{id}/review` | Yes | Submit review for completed booking |
| GET | `/bookings/active` | Yes | Get current active booking (if any) |
| POST | `/bookings/estimate` | Yes | Get price estimate without creating booking |
| POST | `/bookings/{id}/rebook` | Yes | Rebook a previous errand |
| POST | `/bookings/{id}/verify-pin` | Yes | Runner verifies 4-digit ride PIN for Transportation |
| POST | `/bookings/{id}/share-trip` | Yes | Generate/activate a public trip share link |
| DELETE | `/bookings/{id}/share-trip` | Yes | Revoke/deactivate trip share link |
| GET | `/trip/{token}` | No | Public trip tracking page (no auth, for share recipients) |
| POST | `/bookings/{id}/sos` | Yes | Trigger SOS alert for active booking |
| DELETE | `/bookings/{id}/sos` | Yes | Deactivate SOS alert |
| GET | `/user/trusted-contacts` | Yes | List customer's trusted contacts |
| POST | `/user/trusted-contacts` | Yes | Add a trusted contact (max 5) |
| PUT | `/user/trusted-contacts/{id}` | Yes | Update a trusted contact |
| DELETE | `/user/trusted-contacts/{id}` | Yes | Remove a trusted contact |

**POST `/bookings`**
```json
// Request (Fixed Price)
{
    "errand_type_id": "uuid",
    "pricing_mode": "fixed",
    "pickup_address": "123 Main Street, Makati",
    "pickup_lat": 14.5547,
    "pickup_lng": 121.0244,
    "pickup_contact_name": "Maria",
    "pickup_contact_phone": "+639181234567",
    "dropoff_address": "SM Megamall, Mandaluyong",
    "dropoff_lat": 14.5839,
    "dropoff_lng": 121.0566,
    "description": "Pick up the package from the front desk",
    "special_instructions": "Call when arrived, gate code: 1234",
    "estimated_item_value": 500.00,
    "schedule_type": "now",
    "payment_method": "card",
    "payment_method_id": "uuid",
    "promo_code": "FIRST50"
}

// Request (Negotiate Price)
{
    "errand_type_id": "uuid",
    "pricing_mode": "negotiate",
    "customer_offer": 80.00,
    "pickup_address": "123 Main Street, Makati",
    "pickup_lat": 14.5547,
    "pickup_lng": 121.0244,
    "dropoff_address": "SM Megamall, Mandaluyong",
    "dropoff_lat": 14.5839,
    "dropoff_lng": 121.0566,
    "description": "Pick up the package from the front desk",
    "schedule_type": "now",
    "payment_method": "gcash",
    "payment_method_id": "uuid"
}

// Response 201 (Fixed)
{
    "success": true,
    "data": {
        "id": "uuid",
        "booking_number": "EG-20260319-0042",
        "status": "pending",
        "pricing_mode": "fixed",
        "errand_type": { "name": "Delivery", "slug": "delivery" },
        "pickup_address": "123 Main Street, Makati",
        "dropoff_address": "SM Megamall, Mandaluyong",
        "distance_km": 5.2,
        "base_fee": 40.00,
        "distance_fee": 62.40,
        "service_fee": 8.19,
        "promo_discount": 50.00,
        "total_amount": 60.59,
        "vehicle_type_rate": "motorcycle",
        "schedule_type": "now",
        "created_at": "2026-03-19T14:30:00Z"
    },
    "message": "Booking created. Searching for a runner..."
}

// Response 201 (Negotiate)
{
    "success": true,
    "data": {
        "id": "uuid",
        "booking_number": "EG-20260319-0043",
        "status": "pending",
        "pricing_mode": "negotiate",
        "customer_offer": 80.00,
        "recommended_min": 65.00,
        "recommended_max": 115.00,
        "total_amount": 80.00,
        "negotiate_expires_at": "2026-03-19T14:35:00Z",
        "distance_km": 5.2,
        "created_at": "2026-03-19T14:30:00Z"
    },
    "message": "Your offer of \u20b180.00 has been sent to nearby runners."
}
```

**POST `/bookings/estimate`**
```json
// Request
{
    "errand_type_id": "uuid",
    "pickup_lat": 14.5547,
    "pickup_lng": 121.0244,
    "dropoff_lat": 14.5839,
    "dropoff_lng": 121.0566,
    "promo_code": "FIRST50"
}

// Response 200 — Returns pricing for ALL vehicle types so customer can compare
{
    "success": true,
    "data": {
        "distance_km": 5.2,
        "base_fee": 40.00,
        "surcharge": 0.00,
        "rates_by_vehicle": {
            "walk":       { "per_km": 8.00,  "distance_fee": 41.60,  "service_fee": 6.53,  "total": 88.13 },
            "bicycle":    { "per_km": 10.00, "distance_fee": 52.00,  "service_fee": 7.36,  "total": 99.36 },
            "motorcycle": { "per_km": 12.00, "distance_fee": 62.40,  "service_fee": 8.19,  "total": 110.59 },
            "car":        { "per_km": 15.00, "distance_fee": 78.00,  "service_fee": 9.44,  "total": 127.44 }
        },
        "promo_discount": 50.00,
        "negotiate_range": {
            "min": 38.13,
            "max": 127.44,
            "recommended": 99.36
        },
        "estimated_duration_minutes": {
            "walk": 65,
            "bicycle": 35,
            "motorcycle": 20,
            "car": 25
        }
    }
}
```

#### 5.4.4 Runner Operations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/runner/profile` | Yes | Get runner profile + verification status |
| PUT | `/runner/profile` | Yes | Update runner profile |
| POST | `/runner/documents` | Yes | Upload verification document |
| PUT | `/runner/online` | Yes | Toggle online/offline status |
| POST | `/runner/location` | Yes | Update current location (called every 5s) |
| GET | `/runner/errand/current` | Yes | Get current assigned errand |
| POST | `/runner/errand/{id}/accept` | Yes | Accept an errand request (fixed or negotiate) |
| POST | `/runner/errand/{id}/decline` | Yes | Decline an errand request |
| GET | `/runner/errand/available` | Yes | List available negotiate bookings near runner |
| POST | `/runner/errand/{id}/status` | Yes | Update errand status (pickup, transit, etc.) |
| GET | `/runner/earnings` | Yes | Get earnings summary |
| GET | `/runner/earnings/history` | Yes | Get detailed earnings history |
| GET | `/runner/errands/history` | Yes | Get past errands list |
| POST | `/runner/payout/request` | Yes | Request instant payout |

**POST `/runner/errand/{id}/status`**
```json
// Request
{
    "status": "at_pickup",
    "lat": 14.5547,
    "lng": 121.0244,
    "photo_url": "https://storage.supabase.co/..." // optional proof photo
}

// Response 200
{
    "success": true,
    "data": {
        "booking_id": "uuid",
        "status": "at_pickup",
        "updated_at": "2026-03-19T14:35:00Z"
    },
    "message": "Status updated to: At Pickup"
}
```

**POST `/runner/errand/{id}/accept`**
```json
// Request (Fixed Price — no body needed, runner accepts the fixed amount)
{}

// Request (Negotiate — runner accepts the customer's offered price)
{}

// Response 200 (Fixed)
{
    "success": true,
    "data": {
        "booking_id": "uuid",
        "status": "accepted",
        "pricing_mode": "fixed",
        "total_amount": 60.59,
        "runner_payout": 51.50,
        "pickup_address": "123 Main Street, Makati",
        "dropoff_address": "SM Megamall, Mandaluyong"
    },
    "message": "Errand accepted! Head to pickup."
}

// Response 200 (Negotiate)
{
    "success": true,
    "data": {
        "booking_id": "uuid",
        "status": "accepted",
        "pricing_mode": "negotiate",
        "customer_offer": 80.00,
        "total_amount": 80.00,
        "runner_payout": 68.00,
        "pickup_address": "123 Main Street, Makati",
        "dropoff_address": "SM Megamall, Mandaluyong"
    },
    "message": "You accepted ₱80.00 offer. Head to pickup."
}

// Response 409 (already accepted by another runner — negotiate mode race)
{
    "success": false,
    "error": { "code": "CONFLICT", "message": "This errand was already accepted by another runner." }
}
```

**GET `/runner/errand/available`** — Negotiate bookings nearby
```json
// Response 200
{
    "success": true,
    "data": [
        {
            "id": "uuid",
            "booking_number": "EG-20260319-0043",
            "errand_type": { "name": "Delivery", "slug": "delivery" },
            "pricing_mode": "negotiate",
            "customer_offer": 80.00,
            "recommended_min": 65.00,
            "recommended_max": 115.00,
            "distance_km": 5.2,
            "pickup_address": "123 Main Street, Makati",
            "dropoff_address": "SM Megamall, Mandaluyong",
            "distance_from_runner_km": 1.3,
            "negotiate_expires_at": "2026-03-19T14:35:00Z",
            "created_at": "2026-03-19T14:30:00Z"
        }
    ]
}
```

**PUT `/runner/online`**
```json
// Request
{
    "is_online": true,
    "lat": 14.5547,
    "lng": 121.0244
}

// Response 200
{
    "success": true,
    "data": { "is_online": true },
    "message": "You are now online"
}
```

#### 5.4.5 Payments & Wallet

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/payments/methods` | Yes | List saved payment methods |
| POST | `/payments/methods` | Yes | Add new payment method (tokenized) |
| DELETE | `/payments/methods/{id}` | Yes | Remove payment method |
| PUT | `/payments/methods/{id}/default` | Yes | Set as default |
| GET | `/wallet/balance` | Yes | Get current wallet balance |
| POST | `/wallet/top-up` | Yes | Top up wallet |
| GET | `/wallet/transactions` | Yes | Wallet transaction history |
| GET | `/payments/history` | Yes | Payment history for all bookings |
| GET | `/payments/{id}/receipt` | Yes | Get receipt for a payment |

#### 5.4.6 Chat

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/chat/{bookingId}/messages` | Yes | Get chat messages (paginated) |
| POST | `/chat/{bookingId}/messages` | Yes | Send a message |
| POST | `/chat/{bookingId}/read` | Yes | Mark messages as read |

#### 5.4.7 Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | Yes | List notifications (paginated) |
| GET | `/notifications/unread-count` | Yes | Get unread count |
| PUT | `/notifications/{id}/read` | Yes | Mark as read |
| PUT | `/notifications/read-all` | Yes | Mark all as read |

#### 5.4.8 Errand Types & Config

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/errand-types` | Yes | List active errand types with pricing |
| GET | `/config/app` | Yes | Get app configuration (fees, limits, etc.) |
| POST | `/support/report` | Yes | Submit a report/dispute |
| GET | `/promos/validate/{code}` | Yes | Validate a promo code |

#### 5.4.9 Admin API (Web Dashboard)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/admin/auth/login` | No | Admin login (email + password + 2FA) |
| GET | `/admin/dashboard` | Admin | Dashboard stats |
| GET | `/admin/users` | Admin | List users (filterable) |
| GET | `/admin/users/{id}` | Admin | User detail |
| PUT | `/admin/users/{id}/status` | Admin | Suspend/ban/activate user |
| GET | `/admin/runners/pending` | Admin | Pending verification queue |
| PUT | `/admin/runners/{id}/verify` | Admin | Approve/reject runner |
| GET | `/admin/bookings` | Admin | List all bookings |
| GET | `/admin/bookings/{id}` | Admin | Booking detail with full timeline |
| GET | `/admin/disputes` | Admin | List dispute tickets |
| PUT | `/admin/disputes/{id}` | Admin | Resolve dispute |
| POST | `/admin/disputes/{id}/refund` | Admin | Issue refund |
| GET | `/admin/analytics` | Admin | Revenue, booking, user analytics |
| POST | `/admin/promos` | Admin | Create promo code |
| PUT | `/admin/promos/{id}` | Admin | Update promo code |
| PUT | `/admin/config/{key}` | Super | Update system config |
| POST | `/admin/notifications/broadcast` | Admin | Send push to all/segment |

### 5.5 Error Codes

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body validation failed |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Insufficient permissions / wrong role |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Duplicate or state conflict (e.g., already accepted) |
| 422 | `UNPROCESSABLE` | Business logic error (e.g., insufficient wallet balance) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `SERVER_ERROR` | Internal server error |

### 5.6 Laravel Middleware Stack

```
1. ForceHttps               — Redirect all HTTP to HTTPS
2. TrustProxies             — Handle load balancer headers
3. HandleCors               — CORS for admin web dashboard
4. ThrottleRequests          — Rate limiting (configurable per route group)
5. EnsureFrontendRequestsAreStateful — Sanctum SPA support
6. auth:sanctum             — Token authentication
7. role:customer|runner|admin — Custom role-checking middleware
8. verified                 — Ensure OTP verified
9. runner.approved           — Ensure runner is approved (runner routes only)
```

---

## 6. Real-Time Event Flow (Supabase Realtime)

### 6.1 Architecture

```
Runner App                   Supabase                    Customer App
──────────                   ────────                    ────────────
                             
GPS Location Update ──POST──► Laravel API                
                             │                           
                             ├── Save to runner_locations
                             ├── Update runner_profiles.current_lat/lng
                             └── INSERT triggers ──► Supabase Realtime
                                                         │
                                                    WebSocket Push
                                                         │
                                                         ▼
                                                    Map marker moves
                                                    ETA recalculates

Status Update ─────POST────► Laravel API                
                             │                           
                             ├── Update bookings.status
                             ├── INSERT booking_status_logs
                             ├── Send push notification (FCM)
                             └── UPDATE triggers ──► Supabase Realtime
                                                         │
                                                    WebSocket Push
                                                         │
                                                         ▼
                                                    Status timeline updates
                                                    Toast notification shown

Chat Message ──────POST────► Laravel API                
                             │                           
                             ├── INSERT messages
                             └── INSERT triggers ──► Supabase Realtime
                                                         │
                                                    WebSocket Push
                                                         │
                                                         ▼
                                                    New message appears
                                                    Badge count updates
```

### 6.2 Supabase Channels

#### Channel 1: Runner Location Tracking
```typescript
// Customer subscribes when viewing tracking screen
const channel = supabase
  .channel(`booking:${bookingId}:location`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'runner_locations',
      filter: `booking_id=eq.${bookingId}`,
    },
    (payload) => {
      const { lat, lng, heading, speed } = payload.new;
      // Update runner marker on map
      useTrackingStore.getState().updateRunnerPosition({ lat, lng, heading, speed });
    }
  )
  .subscribe();

// Cleanup on unmount
return () => supabase.removeChannel(channel);
```

**Frequency:** Runner sends location every 5 seconds via `POST /runner/location`  
**Optimization:** Only broadcast if runner moved > 10 meters since last broadcast  
**Battery:** Use foreground service on Android for GPS while on active errand  

#### Channel 2: Booking Status Updates
```typescript
// Customer subscribes to their booking
const channel = supabase
  .channel(`booking:${bookingId}:status`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'bookings',
      filter: `id=eq.${bookingId}`,
    },
    (payload) => {
      const { status, runner_id } = payload.new;
      useBookingStore.getState().updateStatus(status);
      
      if (status === 'accepted') {
        // Fetch runner profile details
        fetchRunnerDetails(runner_id);
      }
      if (status === 'completed') {
        // Navigate to rating screen
        router.push(`/rate/${bookingId}`);
      }
    }
  )
  .subscribe();
```

#### Channel 3: Chat Messages
```typescript
// Both customer and runner subscribe
const channel = supabase
  .channel(`booking:${bookingId}:chat`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `booking_id=eq.${bookingId}`,
    },
    (payload) => {
      const message = payload.new;
      if (message.sender_id !== currentUserId) {
        useChatStore.getState().addMessage(message);
        // Show in-app notification if not on chat screen
      }
    }
  )
  .subscribe();
```

#### Channel 4: Runner — Incoming Errand Requests (Fixed Price)
```typescript
// Runner subscribes when online — receives FIXED-PRICE requests assigned directly
const channel = supabase
  .channel(`runner:${userId}:requests`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'bookings',
      filter: `runner_id=eq.${userId}`,
    },
    (payload) => {
      if (payload.new.status === 'matched' && payload.old.status === 'pending') {
        // Fixed-price: Show incoming errand request modal with 30s countdown
        useRunnerStore.getState().showIncomingRequest(payload.new);
      }
    }
  )
  .subscribe();
```

#### Channel 4b: Runner — Negotiate Booking Feed
```typescript
// Runner subscribes when online — receives NEGOTIATE bookings broadcast to area
// Uses Supabase Realtime Broadcast (not postgres_changes) for fan-out efficiency
const negotiateChannel = supabase
  .channel('negotiate:area:makati') // area-based channel
  .on('broadcast', { event: 'new_negotiate_booking' }, (payload) => {
    const booking = payload.payload;
    // Add to the runner's available negotiate feed
    useRunnerStore.getState().addNegotiateBooking(booking);
  })
  .on('broadcast', { event: 'negotiate_booking_taken' }, (payload) => {
    const { bookingId } = payload.payload;
    // Remove from feed — another runner accepted it
    useRunnerStore.getState().removeNegotiateBooking(bookingId);
  })
  .subscribe();

// Server broadcasts when a negotiate booking is created:
// Supabase::channel('negotiate:area:makati')
//   ->broadcast('new_negotiate_booking', $bookingData);
```

#### Channel 5: Notification Count (Global)
```typescript
// All authenticated users subscribe
const channel = supabase
  .channel(`user:${userId}:notifications`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      useNotificationStore.getState().incrementUnread();
      // Optionally show toast
    }
  )
  .subscribe();
```

### 6.3 Runner Matching Flow (Real-Time)

#### 6.3.1 Fixed Price — Direct Assignment
```
Customer creates booking (pricing_mode = 'fixed')
         │
         ▼
Laravel BookingService::create()
         │
         ├── 1. Save booking (status: 'pending', pricing_mode: 'fixed')
         │
         ├── 2. MatchingService::findRunner(booking)
         │       │
         │       ├── Query online runners within radius
         │       │   ORDER BY distance ASC, avg_rating DESC
         │       │   WHERE verification_status = 'approved'
         │       │   AND is_online = TRUE
         │       │   AND NOT in active errand
         │       │
         │       ├── Select top candidate
         │       │
         │       ├── Update booking: runner_id = candidate, status = 'matched'
         │       │   (Triggers Supabase Realtime Channel 4 → runner gets notification)
         │       │
         │       └── Start 30-second timeout job (Laravel Queue)
         │
         ▼
Runner receives request via Channel 4 (direct assignment)
         │
         ├── ACCEPT → POST /runner/errand/{id}/accept
         │              └── Update status to 'accepted'
         │                  (Triggers Realtime → customer sees runner info)
         │
         └── DECLINE or TIMEOUT
                  └── MatchingService tries next runner
                      (Up to 3 attempts, then booking → 'cancelled' with refund)
```

#### 6.3.2 Negotiate — Broadcast to Area
```
Customer creates booking (pricing_mode = 'negotiate', customer_offer = ₱80)
         │
         ▼
Laravel BookingService::create()
         │
         ├── 1. Save booking (status: 'pending', pricing_mode: 'negotiate')
         │      Set negotiate_expires_at = now + 5 minutes
         │
         ├── 2. MatchingService::broadcastNegotiate(booking)
         │       │
         │       ├── Determine area channel from pickup coordinates
         │       │   (e.g., 'negotiate:area:makati')
         │       │
         │       ├── Broadcast to Supabase Channel 4b
         │       │   All online runners in the area see the booking in their feed
         │       │
         │       └── Start 5-minute expiry job (Laravel Queue)
         │
         ▼
Multiple runners see booking in negotiate feed (Channel 4b)
         │
         ├── FIRST RUNNER ACCEPTS → POST /runner/errand/{id}/accept
         │       │
         │       ├── Atomic lock: UPDATE bookings SET runner_id, status='accepted'
         │       │   WHERE id = ? AND status = 'pending' AND runner_id IS NULL
         │       │   (Only ONE runner can win — database-level atomicity)
         │       │
         │       ├── Broadcast 'negotiate_booking_taken' to area channel
         │       │   (Other runners see it disappear from their feed)
         │       │
         │       └── Notify customer via Realtime + push
         │
         └── TIMEOUT (5 min, no runner accepts)
                  └── Booking → 'expired'
                      Customer notified: "No runners accepted. Try a higher offer."
                      Customer can re-post with adjusted price
```

### 6.4 Connection Management

```typescript
// Reconnection strategy in Zustand store
interface RealtimeState {
  isConnected: boolean;
  channels: Map<string, RealtimeChannel>;
  reconnectAttempts: number;
}

// Auto-reconnect with exponential backoff
const handleDisconnect = () => {
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000); // Max 30s
  setTimeout(() => reconnect(), delay);
};

// On app foreground (AppState listener)
const handleAppForeground = () => {
  // Re-subscribe to all active channels
  // Fetch latest state via API to catch missed events
  if (activeBookingId) {
    fetchBookingStatus(activeBookingId); // HTTP fallback
  }
};

// On app background
const handleAppBackground = () => {
  // Keep channels alive but reduce location frequency to 15s
  // Push notifications serve as backup via FCM
};
```

### 6.5 Redundancy: Push Notifications as Fallback

Every real-time event also triggers a push notification via FCM to ensure delivery even when:
- WebSocket is temporarily disconnected
- App is in background / killed
- Network is unstable

```
Event occurs → Laravel dispatches:
  1. Supabase DB change (triggers Realtime)
  2. FCM push notification (via Laravel queue job)
  
App receives:
  - If foreground: Realtime channel handles it, push is suppressed in-app
  - If background: Push notification shown, tapping opens relevant screen
```

---

## 7. Payment Flow Integration

### 7.1 Supported Payment Methods

| Method | Provider | Flow Type | When Charged |
|---|---|---|---|
| Credit/Debit Card | Xendit | Payment Request (CARD) | Pre-authorized at booking, captured on completion |
| GCash | Xendit | E-Wallet Payment Request | Charged at booking confirmation |
| Maya | Xendit | E-Wallet Payment Request | Charged at booking confirmation |
| Wallet | Internal | Direct debit from balance | Instant debit at booking |
| Cash on Delivery | N/A | Runner collects | Runner collects cash upon completion |

### 7.2 Payment Lifecycle

```
Customer confirms booking
         │
         ▼
    ┌──────────────────────────────────────┐
    │ Which payment method?                │
    │                                      │
    ├── CARD (Xendit) ─────────────────────┤
    │   1. Create Payment Request (CARD)   │
    │   2. Customer enters card details     │
    │   3. Payment processes via Xendit     │
    │   4. Webhook: payment.succeeded       │
    │   5. On cancellation:               │
    │      └── Refund via Xendit API       │
    │                                      │
    ├── GCASH (Xendit) ────────────────────┤
    │   1. Create Payment Request (EWALLET)│
    │   2. Redirect customer to GCash app  │
    │   3. Customer authorizes payment     │
    │   4. Webhook: payment.succeeded      │
    │   5. On cancellation:               │
    │      └── Refund via Xendit API       │
    │                                      │
    ├── MAYA (Xendit) ─────────────────────┤
    │   1. Create Payment Request (EWALLET)│
    │   2. Redirect customer to Maya app   │
    │   3. Customer authorizes payment     │
    │   4. Webhook: payment.succeeded      │
    │   5. On cancellation:               │
    │      └── Refund via Xendit API       │
    │                                      │
    ├── WALLET ────────────────────────────┤
    │   1. Check wallet_balance >= amount  │
    │   2. Debit wallet (atomic tx)        │
    │   3. Create wallet_transaction       │
    │   4. On cancellation:               │
    │      └── Credit wallet + transaction │
    │                                      │
    └── CASH ──────────────────────────────┤
        1. No pre-payment                  │
        2. Runner collects cash on arrival │
        3. Runner confirms cash received   │
        4. Platform fee deducted from      │
           runner's next payout            │
        5. No refund needed (no charge)    │
    ───────────────────────────────────────┘
```

### 7.3 Xendit Integration (Card Payments)

#### Adding a Card
```typescript
// Frontend: Collect card details and create payment via Xendit API
const addCard = async (cardDetails: { number: string; exp_month: number; exp_year: number; cvc: string }) => {
  // 1. Create payment method via backend (Xendit)
  const response = await api.post('/payments/methods', {
    type: 'card',
    card_number: cardDetails.number,
    exp_month: cardDetails.exp_month,
    exp_year: cardDetails.exp_year,
    cvc: cardDetails.cvc,
  });
  // Backend creates Xendit tokenized card and stores reference
};
```

#### Charging a Card
```php
// Backend: Laravel PaymentService (via Xendit REST API)
class PaymentService
{
    public function chargeCard(Booking $booking, PaymentMethod $method): Payment
    {
        // 1. Create Payment Request
        $paymentRequest = Http::withBasicAuth(config('services.xendit.secret_key'), '')
            ->post('https://api.xendit.co/payment_requests', [
                'reference_id' => "booking-{$booking->id}",
                'amount' => round($booking->total_amount, 2),
                'currency' => 'PHP',
                'description' => "Booking #{$booking->booking_number}",
                'payment_method' => [
                    'type' => 'CARD',
                    'reusability' => 'ONE_TIME_USE',
                    'card' => [
                        'channel_properties' => [
                            'success_return_url' => config('app.url') . "/payment/success/{$booking->id}",
                            'failure_return_url' => config('app.url') . "/payment/failed/{$booking->id}",
                        ],
                    ],
                ],
                'metadata' => ['booking_id' => $booking->id],
            ]);

        // 2. Save payment record
        return Payment::create([
            'booking_id' => $booking->id,
            'customer_id' => $booking->customer_id,
            'amount' => $booking->total_amount,
            'method' => 'card',
            'status' => 'processing',
            'gateway_tx_id' => $paymentRequest['id'],
        ]);
    }

    public function refundPayment(Payment $payment, float $amount): void
    {
        Http::withBasicAuth(config('services.xendit.secret_key'), '')
            ->post('https://api.xendit.co/refunds', [
                'payment_request_id' => $payment->gateway_tx_id,
                'amount' => round($amount, 2),
                'currency' => 'PHP',
                'reason' => 'REQUESTED_BY_CUSTOMER',
                'reference_id' => "refund-{$payment->id}",
            ]);
        $payment->update(['status' => 'refunded', 'refund_amount' => $amount, 'refunded_at' => now()]);
    }
}
```

### 7.4 GCash / Maya Integration (via Xendit)

```php
class PaymentService
{
    public function createEwalletPayment(Booking $booking, string $type): array
    {
        // $type: 'gcash' or 'maya'
        $channelCode = $type === 'gcash' ? 'GCASH' : 'PAYMAYA';

        $paymentRequest = Http::withBasicAuth(config('services.xendit.secret_key'), '')
            ->post('https://api.xendit.co/payment_requests', [
                'reference_id' => "booking-{$booking->id}",
                'amount' => round($booking->total_amount, 2),
                'currency' => 'PHP',
                'payment_method' => [
                    'type' => 'EWALLET',
                    'reusability' => 'ONE_TIME_USE',
                    'ewallet' => [
                        'channel_code' => $channelCode,
                        'channel_properties' => [
                            'success_return_url' => config('app.url') . "/payment/success/{$booking->id}",
                            'failure_return_url' => config('app.url') . "/payment/failed/{$booking->id}",
                        ],
                    ],
                ],
                'metadata' => ['booking_id' => $booking->id],
            ]);

        // Return action URL → mobile app opens in-app browser
        $actions = $paymentRequest['actions'] ?? [];
        $redirectUrl = collect($actions)->firstWhere('action', 'AUTH')['url'] ?? null;

        return [
            'payment_request_id' => $paymentRequest['id'],
            'redirect_url' => $redirectUrl,
        ];
    }

    // Webhook handler: Xendit calls this when payment succeeds
    // Uses x-callback-token header for verification
    // Events: payment.succeeded, payment.failed, payment.pending
}
```

### 7.5 Wallet System

```php
class WalletService
{
    public function debit(User $user, float $amount, string $description, ?string $referenceId = null): WalletTransaction
    {
        return DB::transaction(function () use ($user, $amount, $description, $referenceId) {
            // Lock user row to prevent race conditions
            $user = User::lockForUpdate()->find($user->id);

            if ($user->wallet_balance < $amount) {
                throw new InsufficientBalanceException();
            }

            $user->decrement('wallet_balance', $amount);

            return WalletTransaction::create([
                'user_id' => $user->id,
                'type' => 'payment',
                'amount' => -$amount,
                'balance_after' => $user->wallet_balance,
                'reference_id' => $referenceId,
                'description' => $description,
            ]);
        });
    }

    public function credit(User $user, float $amount, string $type, string $description, ?string $referenceId = null): WalletTransaction
    {
        return DB::transaction(function () use ($user, $amount, $type, $description, $referenceId) {
            $user = User::lockForUpdate()->find($user->id);
            $user->increment('wallet_balance', $amount);

            return WalletTransaction::create([
                'user_id' => $user->id,
                'type' => $type, // 'refund', 'top_up', 'bonus'
                'amount' => $amount,
                'balance_after' => $user->wallet_balance,
                'reference_id' => $referenceId,
                'description' => $description,
            ]);
        });
    }
}
```

### 7.6 Runner Payouts

```
Errand completed
    │
    ├── Calculate runner payout:
    │   runner_payout = total_amount × runner_payout_percentage (85%)
    │
    ├── For CASH errands:
    │   Runner already collected cash
    │   Platform fee = total_amount × 15%
    │   Deducted from runner's accumulated earnings
    │
    ├── For NON-CASH errands:
    │   runner_payout credited to runner's internal earnings balance
    │
    └── Payout schedule:
        ├── Auto payout: Every Monday for previous week's earnings
        │   → Transfer to runner's bank account or e-wallet
        │
        └── Instant payout: Runner requests anytime
            → ₱15 processing fee
            → Transfer within minutes to e-wallet
```

### 7.7 Refund Flow

```
Refund triggered (cancellation or dispute resolution)
    │
    ├── CARD payment → Xendit refund (full or partial)
    │   → Appears on customer's card in 5–10 business days
    │
    ├── GCASH payment → Xendit refund API
    │   → Credited back to GCash wallet
    │
    ├── MAYA payment → Xendit refund API
    │   → Credited back to Maya wallet
    │
    ├── WALLET payment → Instant credit back to app wallet
    │
    └── CASH → No refund needed (no charge was made)

Admin can also issue goodwill credits (wallet bonus) for disputes.
```

### 7.8 Pricing Engine

```php
class PricingService
{
    /**
     * Vehicle type → column mapping for per-km rates.
     * Each errand_type has 4 rate columns: per_km_walk, per_km_bicycle, per_km_motorcycle, per_km_car.
     */
    private const VEHICLE_COLUMNS = [
        'walk'       => 'per_km_walk',
        'bicycle'    => 'per_km_bicycle',
        'motorcycle' => 'per_km_motorcycle',
        'car'        => 'per_km_car',
    ];

    /**
     * Full estimate — returns pricing for ALL vehicle types so the customer can compare.
     */
    public function estimateAll(ErrandType $type, float $distanceKm, ?PromoCode $promo = null): array
    {
        $rates = [];
        foreach (self::VEHICLE_COLUMNS as $vehicle => $column) {
            $rates[$vehicle] = $this->calculateForVehicle($type, $distanceKm, $type->{$column}, $promo);
        }

        // Negotiate range: min = cheapest vehicle total, max = most expensive vehicle total
        $allTotals = array_column($rates, 'total');
        $recommended = $rates['bicycle']['total']; // middle-ground recommendation

        return [
            'distance_km'   => $distanceKm,
            'base_fee'      => $type->base_fee,
            'surcharge'     => $type->surcharge,
            'rates_by_vehicle' => $rates,
            'promo_discount' => $rates['motorcycle']['promo_discount'], // same across vehicles
            'negotiate_range' => [
                'min'         => max(min($allTotals), $type->min_negotiate_fee),
                'max'         => max($allTotals),
                'recommended' => round($recommended, 2),
            ],
        ];
    }

    /**
     * Single-vehicle estimate — used when booking is confirmed with a specific vehicle type.
     */
    public function estimate(ErrandType $type, float $distanceKm, string $vehicleType = 'motorcycle', ?PromoCode $promo = null): PriceBreakdown
    {
        $column = self::VEHICLE_COLUMNS[$vehicleType] ?? 'per_km_motorcycle';
        $perKm = $type->{$column};
        $result = $this->calculateForVehicle($type, $distanceKm, $perKm, $promo);

        return new PriceBreakdown(...$result, distanceKm: $distanceKm, vehicleType: $vehicleType);
    }

    /**
     * Validate a customer's negotiate offer.
     * Floor: ₱30 (min_negotiate_fee) or cheapest vehicle total — whichever is higher.
     * Ceiling warning: if offer > 3× recommended, show confirmation.
     */
    public function validateNegotiateOffer(ErrandType $type, float $distanceKm, float $offer): array
    {
        $all = $this->estimateAll($type, $distanceKm);
        $floor = max($type->min_negotiate_fee, $all['negotiate_range']['min']);
        $ceiling = $all['negotiate_range']['recommended'] * 3;

        return [
            'valid'            => $offer >= $floor,
            'floor'            => $floor,
            'ceiling_warning'  => $offer > $ceiling,
            'recommended_min'  => $all['negotiate_range']['min'],
            'recommended_max'  => $all['negotiate_range']['max'],
            'recommended'      => $all['negotiate_range']['recommended'],
        ];
    }

    private function calculateForVehicle(ErrandType $type, float $distanceKm, float $perKm, ?PromoCode $promo): array
    {
        $baseFee = $type->base_fee;
        $distanceFee = round($distanceKm * $perKm, 2);
        $surcharge = $type->surcharge;
        $subtotal = $baseFee + $distanceFee + $surcharge;
        $serviceFee = round($subtotal * 0.08, 2); // 8% service fee

        $promoDiscount = 0;
        if ($promo) {
            $promoDiscount = $promo->discount_type === 'fixed'
                ? min($promo->discount_value, $subtotal)
                : min($subtotal * $promo->discount_value / 100, $promo->max_discount ?? PHP_FLOAT_MAX);
        }

        $total = max($subtotal + $serviceFee - $promoDiscount, 0);

        return [
            'per_km'         => $perKm,
            'base_fee'       => $baseFee,
            'distance_fee'   => $distanceFee,
            'surcharge'      => $surcharge,
            'service_fee'    => $serviceFee,
            'promo_discount' => $promoDiscount,
            'total'          => round($total, 2),
        ];
    }
}
```

---

## 8. Security Architecture

### 8.1 Security Layers Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Transport Security                                 │
│  HTTPS/TLS 1.3 everywhere, HSTS, certificate pinning       │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Authentication                                     │
│  Sanctum tokens, OTP verification, social OAuth 2.0        │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Authorization (RBAC)                               │
│  Role middleware, policy classes, RLS in Supabase           │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: Input Validation & Sanitization                    │
│  Laravel Form Requests, parameterized queries, XSS filter  │
├─────────────────────────────────────────────────────────────┤
│ Layer 5: Rate Limiting & Abuse Prevention                   │
│  Throttle middleware, per-endpoint limits, brute-force lock │
├─────────────────────────────────────────────────────────────┤
│ Layer 6: Data Protection                                    │
│  Bcrypt passwords, encrypted sensitive fields, no PII logs  │
├─────────────────────────────────────────────────────────────┤
│ Layer 7: Monitoring & Incident Response                     │
│  Structured logging, anomaly alerts, audit trail            │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Authentication Security

#### Token Management (Laravel Sanctum)
```
- Tokens are hashed (SHA-256) before storage — raw token never stored in DB
- Token format: {id}|{random_40_chars} → only user sees full token
- Tokens stored securely on device via expo-secure-store (Keychain/Keystore)
- Token expiry: 30 days inactive, or on explicit logout
- One active token per device (new login revokes previous on same device)
- All tokens revoked on password change
```

#### OTP Security
```
- OTP length: 6 digits
- OTP expiry: 5 minutes
- Max attempts: 5 per OTP (then invalidate)
- Rate limit: 3 OTP requests per phone/email per hour
- OTPs hashed before storage (bcrypt)
- Delivered via SMS gateway (Twilio/Semaphore) or email (Mailgun)
```

#### Social Login
```
- Google: Verify ID token server-side with Google's tokeninfo endpoint
- Facebook: Verify access token server-side with Facebook Graph API
- Never trust client-provided user info — always verify with provider
- Link social account to existing account by verified email match
```

#### Password Policy
```
- Minimum 8 characters
- At least 1 uppercase, 1 lowercase, 1 number, 1 special character
- Hashed with bcrypt (cost factor 12)
- Passwords checked against HaveIBeenPwned API (k-anonymity model)
- No password reuse (last 5 passwords stored as hashes)
```

### 8.3 Authorization (RBAC)

#### Role-Based Middleware
```php
// routes/api.php
Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/bookings', [BookingController::class, 'store']);
    // ...customer-only routes
});

Route::middleware(['auth:sanctum', 'role:runner', 'runner.approved'])->group(function () {
    Route::post('/runner/errand/{id}/accept', [RunnerController::class, 'accept']);
    // ...runner-only routes
});

Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function () {
    Route::get('/users', [AdminUserController::class, 'index']);
    // ...admin-only routes
});
```

#### Policy Classes (Resource Authorization)
```php
class BookingPolicy
{
    // Customer can only view their own bookings
    public function view(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            || $user->id === $booking->runner_id;
    }

    // Only the customer who created it can cancel
    public function cancel(User $user, Booking $booking): bool
    {
        return $user->id === $booking->customer_id
            && in_array($booking->status, ['pending', 'matched', 'accepted']);
    }
}
```

#### Supabase RLS (Database Level)
```
- RLS enabled on all user-facing tables (see Section 4.3)
- Even if API is bypassed, DB enforces row-level access
- Admin operations use a service_role key (bypasses RLS) — only from backend
- anon key has no INSERT/UPDATE/DELETE on any table
```

### 8.4 Input Validation & Injection Prevention

#### Laravel Form Requests
```php
class CreateBookingRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'errand_type_id'      => 'required|uuid|exists:errand_types,id',
            'pickup_address'      => 'required|string|max:500',
            'pickup_lat'          => 'required|numeric|between:-90,90',
            'pickup_lng'          => 'required|numeric|between:-180,180',
            'pickup_contact_name' => 'nullable|string|max:100',
            'pickup_contact_phone'=> 'nullable|string|regex:/^\+?[0-9]{10,15}$/',
            'dropoff_address'     => 'required|string|max:500',
            'dropoff_lat'         => 'required|numeric|between:-90,90',
            'dropoff_lng'         => 'required|numeric|between:-180,180',
            'description'         => 'nullable|string|max:1000',
            'special_instructions'=> 'nullable|string|max:500',
            'estimated_item_value'=> 'nullable|numeric|min:0|max:100000',
            'schedule_type'       => 'required|in:now,scheduled',
            'scheduled_at'        => 'required_if:schedule_type,scheduled|date|after:now',
            'payment_method'      => 'required|in:card,gcash,maya,wallet,cash',
            'payment_method_id'   => 'required_if:payment_method,card,maya|uuid|exists:payment_methods,id',
            'promo_code'          => 'nullable|string|max:30',
        ];
    }
}
```

#### SQL Injection Prevention
```
- Eloquent ORM with parameterized queries (no raw string concatenation)
- DB::raw() prohibited except via approved query scopes
- All user input goes through validation before any DB operation
```

#### XSS Prevention
```
- All text output HTML-escaped by default in API responses
- Strip HTML tags from user-generated content (names, descriptions)
- Image uploads validated (MIME type check, file header inspection)
- Content-Security-Policy headers on admin web dashboard
```

#### File Upload Security
```
- Allowed types: JPEG, PNG, WEBP (images only)
- Max size: 5 MB per file
- Server-side MIME validation (not just extension)
- Files stored in Supabase Storage with unique UUIDs (no user-controlled paths)
- Images resized server-side (max 1200px) to prevent abuse
- Virus scan on upload (ClamAV integration for production)
```

### 8.5 Rate Limiting

```php
// Laravel rate limiter configuration
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
});

RateLimiter::for('auth', function (Request $request) {
    return Limit::perMinute(10)->by($request->ip());
});

RateLimiter::for('otp', function (Request $request) {
    return Limit::perHour(3)->by($request->input('phone') . $request->ip());
});

RateLimiter::for('location', function (Request $request) {
    return Limit::perMinute(15)->by($request->user()->id); // ~1 per 4 seconds
});

RateLimiter::for('booking', function (Request $request) {
    return Limit::perMinute(5)->by($request->user()->id);
});
```

#### Brute Force Protection
```
- 5 failed login attempts → account locked for 15 minutes
- Progressive delays: 1s, 2s, 4s, 8s, 15s between retries
- Suspicious IP patterns (many accounts from same IP) → CAPTCHA required
- Admin login: 3 failed attempts → account locked, email alert sent
```

### 8.6 Data Protection

#### Sensitive Data Handling
```
Field                     Storage                      Notes
─────────────────────────────────────────────────────────────────
Passwords                 Bcrypt hash (cost 12)         Never stored in plain text
Bank account numbers      AES-256-GCM encrypted         App-level encryption
Payment tokens            Gateway-provided tokens       Never store raw card data
OTP codes                 Bcrypt hash                   Deleted after use
User phone/email          Plain (needed for lookup)     Excluded from logs
GPS coordinates           Plain                         Deleted after 24h (tracking)
Chat messages             Plain                         Auto-deleted 30 days post-completion
```

#### Encryption at Rest
```
- Supabase: PostgreSQL encryption at rest (AES-256)
- Supabase Storage: Server-side encryption for uploaded files
- App-level encryption for bank details using Laravel's Crypt facade (APP_KEY)
- Backups encrypted with separate key
```

#### Secure Storage on Device
```typescript
// expo-secure-store for tokens and sensitive data
import * as SecureStore from 'expo-secure-store';

await SecureStore.setItemAsync('auth_token', token, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

// Never store sensitive data in AsyncStorage (unencrypted)
// Never log tokens, passwords, payment data
```

### 8.7 API Security Headers

```php
// Middleware: SecurityHeaders
class SecurityHeaders
{
    public function handle($request, $next)
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('X-XSS-Protection', '0'); // Modern browsers use CSP
        $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'geolocation=(self), camera=(self)');

        return $response;
    }
}
```

### 8.8 Logging & Monitoring

```
What we log:
  ✓ Authentication events (login, logout, failed attempts, OTP sent)
  ✓ Authorization failures (forbidden access attempts)
  ✓ Booking lifecycle events (created, status changes, cancellations)
  ✓ Payment events (charges, captures, refunds, failures)
  ✓ Admin actions (user suspension, dispute resolution, config changes)
  ✓ Rate limit hits
  ✓ API errors (4xx, 5xx)

What we NEVER log:
  ✗ Passwords or password hashes
  ✗ Full payment card numbers
  ✗ Authentication tokens
  ✗ OTP codes
  ✗ Bank account numbers
  ✗ Raw request bodies with sensitive fields

Log format: Structured JSON → shipped to centralized logging (e.g., Grafana Loki)
Retention: 90 days for application logs, 1 year for audit logs
Alerts: Slack/email for failed payment spikes, auth failures > threshold, 5xx errors
```

### 8.9 Security Checklist

```
[x] HTTPS enforced everywhere (HSTS preload)
[x] Sanctum tokens hashed in DB, stored in Keychain/Keystore on device
[x] Bcrypt passwords with cost factor 12
[x] Role-based access control (middleware + policies + RLS)
[x] Input validation on every endpoint (Form Requests)
[x] Parameterized queries only (no raw SQL with user input)
[x] Rate limiting on all endpoints (stricter on auth/OTP)
[x] File upload validation (MIME, size, type)
[x] No sensitive data in logs
[x] Encrypted sensitive fields at app level
[x] Supabase anon key: read-only where allowed, zero write access
[x] Service role key: server-side only, never exposed to client
[x] Webhook token verification (Xendit)
[x] CORS restricted to admin dashboard domain only
[x] Admin 2FA enforced
[x] Audit trail for admin actions
[x] Dependency vulnerability scanning (composer audit, npm audit)
```

---

## 9. Performance & Stability

### 9.1 State Management (Zustand)

#### Store Architecture
```
stores/
├── useAuthStore.ts          # User auth state, token, profile
├── useBookingStore.ts       # Active booking, booking form, history
├── useTrackingStore.ts      # Runner position, ETA, status timeline
├── useRunnerStore.ts        # Runner dashboard, online/offline, incoming requests
├── useChatStore.ts          # Messages per booking
├── useWalletStore.ts        # Balance, transactions
├── useNotificationStore.ts  # Notifications, unread count
└── useAppStore.ts           # App-level state (network, theme, config)
```

#### Design Principles
```typescript
// 1. Minimal state — only store what you can't derive
// 2. Selectors for derived data — prevents unnecessary re-renders
// 3. Actions co-located with state — no separate action files
// 4. Persist critical state — auth token and user profile survive app restart

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (credentials: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      get isAuthenticated() { return !!get().token; },

      login: async (credentials) => {
        const { data } = await api.post('/auth/login', credentials);
        // Store token in secure storage (not persisted in Zustand)
        await SecureStore.setItemAsync('auth_token', data.token);
        set({ user: data.user, token: data.token });
      },

      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        await SecureStore.deleteItemAsync('auth_token');
        set({ user: null, token: null });
      },
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user }), // Don't persist token in AsyncStorage
    }
  )
);
```

#### Preventing Unnecessary Re-Renders
```typescript
// BAD: Component re-renders on ANY store change
const { user, bookings, notifications } = useAuthStore();

// GOOD: Component only re-renders when selected value changes
const userName = useAuthStore((s) => s.user?.full_name);
const unreadCount = useNotificationStore((s) => s.unreadCount);

// GOOD: Shallow comparison for objects
const runnerPosition = useTrackingStore(
  (s) => ({ lat: s.lat, lng: s.lng }),
  shallow
);
```

### 9.2 Network Resilience

#### Axios Instance with Retry & Timeout
```typescript
import axios from 'axios';
import axiosRetry from 'axios-retry';
import NetInfo from '@react-native-community/netinfo';

const api = axios.create({
  baseURL: 'https://api.errandguy.app/api/v1',
  timeout: 15000, // 15 second timeout
  headers: { 'Content-Type': 'application/json' },
});

// Auto-retry on network errors and 5xx (up to 3 retries with exponential backoff)
axiosRetry(api, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,   // 1s, 2s, 4s
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error)
      || (error.response?.status ?? 0) >= 500;
  },
});

// Attach auth token to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally (token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      router.replace('/login');
    }
    return Promise.reject(error);
  }
);
```

#### Offline State Detection
```typescript
// useAppStore — network state
interface AppState {
  isOnline: boolean;
  pendingActions: QueuedAction[];
  setOnline: (online: boolean) => void;
  queueAction: (action: QueuedAction) => void;
  flushQueue: () => Promise<void>;
}

// Listen for network changes
NetInfo.addEventListener((state) => {
  const wasOffline = !useAppStore.getState().isOnline;
  useAppStore.getState().setOnline(state.isConnected ?? false);

  if (wasOffline && state.isConnected) {
    // Back online — flush queued actions
    useAppStore.getState().flushQueue();
    // Re-fetch critical data
    useBookingStore.getState().refreshActiveBooking();
  }
});
```

#### Offline UI Patterns
```
┌─────────────────────────────────────────┐
│ 🔴 You are offline                      │  ← Persistent banner at top
│ Some features may be unavailable        │
└─────────────────────────────────────────┘

When offline:
  ✓ Show cached booking details and history
  ✓ Show last known runner position on map
  ✓ Queue chat messages for sending when back online
  ✓ Show "Retry" button on failed actions
  ✗ Disable booking creation
  ✗ Disable payment actions
  ✗ Show clear "offline" indicator on real-time features
```

### 9.3 Error Handling Strategy

#### Frontend Error Boundaries
```typescript
// Global error boundary wrapping the entire app
class GlobalErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Report to error tracking service (Sentry)
    reportError(error, info);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallbackScreen onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

// Per-screen error boundaries for graceful degradation
// If tracking screen crashes, home screen still works
```

#### API Error Handling
```typescript
// Centralized error handler
const handleApiError = (error: AxiosError<ApiError>) => {
  const status = error.response?.status;
  const message = error.response?.data?.message;

  switch (status) {
    case 400:
    case 422:
      // Validation error — show field-level errors
      return { type: 'validation', errors: error.response?.data?.errors };
    case 401:
      // Handled by interceptor (auto-logout)
      return null;
    case 403:
      showToast('You don\'t have permission to do that', 'error');
      return { type: 'forbidden' };
    case 404:
      showToast('Resource not found', 'error');
      return { type: 'not_found' };
    case 429:
      showToast('Too many requests. Please wait a moment.', 'warning');
      return { type: 'rate_limited' };
    case 500:
      showToast('Something went wrong. Please try again.', 'error');
      return { type: 'server_error' };
    default:
      if (!error.response) {
        showToast('No internet connection', 'warning');
        return { type: 'network' };
      }
      showToast(message || 'An error occurred', 'error');
      return { type: 'unknown' };
  }
};
```

#### Backend Error Handling
```php
// app/Exceptions/Handler.php
class Handler extends ExceptionHandler
{
    public function render($request, Throwable $e)
    {
        if ($e instanceof ValidationException) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors(),
            ], 422);
        }

        if ($e instanceof ModelNotFoundException) {
            return response()->json([
                'success' => false,
                'message' => 'Resource not found',
            ], 404);
        }

        if ($e instanceof InsufficientBalanceException) {
            return response()->json([
                'success' => false,
                'message' => 'Insufficient wallet balance',
            ], 422);
        }

        // Log unexpected errors but don't expose internals
        Log::error($e->getMessage(), [
            'exception' => get_class($e),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'user_id' => $request->user()?->id,
        ]);

        return response()->json([
            'success' => false,
            'message' => 'An unexpected error occurred',
        ], 500);
    }
}
```

### 9.4 Performance Optimizations

#### Frontend
```
Image Optimization:
  - Use expo-image (faster than <Image>, supports caching)
  - Thumbnails for lists (200px), full-res on detail screens
  - Progressive loading with blurhash placeholders

List Performance:
  - FlashList instead of FlatList (recycling, 5x faster)
  - Paginated API responses (20 items per page)
  - Pull-to-refresh + infinite scroll

Map Performance:
  - Debounce runner location updates (render at most 1x per second)
  - Limit polyline points (use Douglas-Peucker simplification)
  - Only render visible markers (clustering for admin view)

Animation:
  - react-native-reanimated for 60fps UI thread animations
  - Lottie for complex animations (loading, success, empty)
  - Avoid layout animations on large lists

Bundle Size:
  - Tree-shaking unused code
  - Lazy load screens (React.lazy + Suspense via Expo Router)
  - Hermes engine enabled (faster startup, lower memory)
```

#### Backend
```
Database:
  - Proper indexes on all filtered/sorted columns (see Section 4)
  - Eager loading relationships (prevent N+1 queries)
  - Database connection pooling (PgBouncer for Supabase)
  - Paginate all list endpoints
  - Soft deletes (keep referential integrity)

Caching:
  - Redis for:
    ├── Active runner locations (geo-indexed for matching)
    ├── App config / errand types (invalidate on admin update)
    ├── Rate limiter counters
    └── Session data
  - Cache headers for static config endpoints (5 min TTL)

Queue (Laravel Horizon):
  - Push notifications → queued (don't block API response)
  - Payment webhooks → queued processing
  - Runner matching → queued with timeout
  - Email/SMS delivery → queued
  - Analytics aggregation → scheduled job

Location Data:
  - runner_locations table: auto-cleanup of records > 24h old
  - Use Redis Geospatial for real-time runner proximity queries
  - Batch location inserts if multiple come in quick succession
```

### 9.5 App Lifecycle Handling

```typescript
import { AppState } from 'react-native';

AppState.addEventListener('change', (nextState) => {
  if (nextState === 'active') {
    // App came to foreground
    // 1. Reconnect Supabase Realtime channels
    // 2. Refresh active booking status (HTTP fallback)
    // 3. Fetch unread notification count
    // 4. Update FCM token if changed
  }

  if (nextState === 'background') {
    // App went to background
    // 1. Reduce location tracking frequency (runner)
    // 2. Keep Realtime connection alive (OS permitting)
    // 3. FCM handles push delivery while backgrounded
  }
});
```

### 9.6 Testing Strategy

```
Frontend:
  - Unit tests: Zustand stores, utility functions (Jest)
  - Component tests: Key screens & components (React Native Testing Library)
  - E2E tests: Critical flows — booking, payment, tracking (Detox)

Backend:
  - Unit tests: Services, pricing engine, business rules (PHPUnit)
  - Feature tests: Full API endpoint tests with auth (PHPUnit)
  - Integration tests: Payment gateway mocking (Xendit test mode)

Coverage targets:
  - Services/business logic: 90%+
  - API endpoints: 85%+
  - UI components: 70%+
  - E2E critical paths: booking, login, payment
```

---

## 10. Task Breakdown for Development

Each task below is designed to be **focused on one feature**, **completable in one prompt**, and **independent** where possible. Tasks are ordered by dependency (build foundational pieces first).

### Phase 1: Project Setup & Foundation

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 1.1 | **Expo project init** | Frontend | SPEC.md | Expo Router project with TypeScript, folder structure, ESLint, Prettier, theme config |
| 1.2 | **Laravel project init** | Backend | SPEC.md | Laravel 12 project with Sanctum, CORS config, base middleware, API route structure |
| 1.3 | **Supabase schema setup** | Database | Section 4 | All tables, indexes, RLS policies created via migrations |
| 1.4 | **Design system & shared components** | Frontend | Section 3.6, 3.7 | Button, Input, Card, Toast, Avatar, Badge, Skeleton, EmptyState components |
| 1.5 | **Zustand store scaffolding** | Frontend | Section 9.1 | All store files with types and initial state (no API calls yet) |
| 1.6 | **Axios API client setup** | Frontend | Section 9.2 | Configured Axios instance with interceptors, retry, auth header, error handler |

### Phase 2: Authentication

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 2.1 | **Registration API** | Backend | Section 5.4.1 | `POST /auth/register` with validation, user creation, OTP send |
| 2.2 | **Login API** | Backend | Section 5.4.1 | `POST /auth/login` with Sanctum token generation |
| 2.3 | **OTP send & verify API** | Backend | Section 5.4.1 | `POST /auth/send-otp`, `POST /auth/verify-otp` with rate limiting |
| 2.4 | **Social login API (Google)** | Backend | Section 8.2 | `POST /auth/social-login` with server-side token verification |
| 2.5 | **Welcome & onboarding screens** | Frontend | Section 3.3 | Welcome slides, navigation to login/register |
| 2.6 | **Registration screen** | Frontend | Section 3.3 | Registration form with validation, calls register API |
| 2.7 | **Login screen** | Frontend | Section 3.3 | Login form, calls login API, stores token securely |
| 2.8 | **OTP verification screen** | Frontend | Section 3.3 | OTP input with countdown timer, resend, calls verify API |
| 2.9 | **Auth state management** | Frontend | Section 9.1 | useAuthStore: login, logout, persist user, auto-login on app start |
| 2.10 | **Role selection screen** | Frontend | Section 3.3 | Choose Customer or Runner after first registration |

### Phase 3: Customer Core

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 3.1 | **Customer home screen** | Frontend | Section 3.4 | Home layout with greeting, quick actions, active errand card, recent errands |
| 3.2 | **Customer bottom tabs** | Frontend | Section 3.3 | Tab navigator: Home, Activity, Notifications, Profile |
| 3.3 | **Errand types API** | Backend | Section 5.4.8 | `GET /errand-types` returning active types with pricing |
| 3.4 | **Booking Step 1: Type selection** | Frontend | Section 3.4 | Errand type grid/list (incl. Transportation), select and proceed |
| 3.5 | **Booking Step 2: Details & locations** | Frontend | Section 3.4 | Map picker, address search, description, photo upload. Transportation mode: simplified input (pickup + destination only, no item details) |
| 3.6 | **Booking Step 3: Schedule** | Frontend | Section 3.4 | Now / Scheduled toggle, date/time picker |
| 3.7 | **Price estimation API** | Backend | Section 5.4.3 | `POST /bookings/estimate` with per-vehicle-type pricing breakdown |
| 3.8 | **Booking Step 4: Review & confirm (Fixed Price)** | Frontend | Section 3.4 | Vehicle rate comparison cards, price breakdown, payment method, confirm |
| 3.8b | **Booking Step 4: Negotiate mode UI** | Frontend | Section 3.4 | Pricing mode toggle, suggested range display, custom offer input with slider, "Send Offer" CTA |
| 3.9 | **Create booking API (fixed + negotiate)** | Backend | Section 5.4.3 | `POST /bookings` supporting `pricing_mode`, `customer_offer`, negotiate validation |
| 3.9b | **Negotiate offer validation** | Backend | Section 7.8 | `PricingService::validateNegotiateOffer()` — floor ₱30, ceiling warning, range check |
| 3.10 | **Booking confirmation screen** | Frontend | Section 3.4 | "Searching for runner" animation, transitions to tracking |
| 3.11 | **Booking history screen** | Frontend | Section 3.3 | Paginated list of past bookings with status, amount |
| 3.12 | **Booking history API** | Backend | Section 5.4.3 | `GET /bookings` with filters, pagination |

### Phase 4: Runner Core

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 4.1 | **Runner registration flow** | Frontend | Section 2.3 | Document upload screens (ID, selfie, vehicle) |
| 4.2 | **Runner document upload API** | Backend | Section 5.4.4 | `POST /runner/documents` with file validation and storage |
| 4.3 | **Runner profile API** | Backend | Section 5.4.4 | `GET/PUT /runner/profile` with verification status |
| 4.4 | **Runner dashboard screen** | Frontend | Section 3.5 | Online/offline toggle, today's stats, recent errands |
| 4.5 | **Runner online/offline API** | Backend | Section 5.4.4 | `PUT /runner/online` with location |
| 4.6 | **Incoming errand request modal (fixed)** | Frontend | Section 3.5 | Request popup with 30s countdown timer, accept/decline |
| 4.6b | **Negotiate feed screen** | Frontend | Section 3.5 | Available negotiate bookings list with offer, range, distance, expiry countdown, accept CTA |
| 4.7 | **Accept/decline errand API** | Backend | Section 5.4.4 | `POST /runner/errand/{id}/accept` and `/decline` — atomic lock for negotiate (first-come-first-served) |
| 4.7b | **Available negotiate bookings API** | Backend | Section 5.4.4 | `GET /runner/errand/available` — nearby negotiate bookings with distance, expiry |
| 4.8 | **Active errand screen (runner)** | Frontend | Section 3.3 | Navigation, status update buttons, chat access |
| 4.9 | **Errand status update API** | Backend | Section 5.4.4 | `POST /runner/errand/{id}/status` with photo proof |
| 4.10 | **Runner earnings screen** | Frontend | Section 3.5 | Daily/weekly/monthly breakdown, per-errand detail |
| 4.11 | **Runner earnings API** | Backend | Section 5.4.4 | `GET /runner/earnings` with summary and history |

### Phase 5: Real-Time Features

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 5.1 | **Runner location broadcast** | Backend | Section 6.1 | `POST /runner/location` — saves to DB, triggers Realtime |
| 5.2 | **Runner location tracking (runner)** | Frontend | Section 6.2 | Foreground GPS service, sends location every 5s via API |
| 5.3 | **Live tracking screen (customer)** | Frontend | Section 3.4 | Map with runner marker, ETA, status timeline. Transportation variant with ride PIN, SOS button, trip share |
| 5.4 | **Supabase Realtime: location channel** | Frontend | Section 6.2 | Subscribe to runner_locations, update map marker in real-time |
| 5.5 | **Supabase Realtime: status channel** | Frontend | Section 6.2 | Subscribe to booking status changes, update timeline |
| 5.6 | **Runner matching service (fixed price)** | Backend | Section 6.3.1 | MatchingService: find nearest runner, assign, 30s timeout, retry up to 3 runners |
| 5.6b | **Negotiate broadcast service** | Backend | Section 6.3.2 | MatchingService::broadcastNegotiate — area channel broadcast, 5-min expiry job, atomic accept lock |
| 5.7 | **Supabase Realtime: runner requests (fixed)** | Frontend | Section 6.2 | Runner receives incoming fixed-price request via Channel 4 |
| 5.7b | **Supabase Realtime: negotiate feed (broadcast)** | Frontend | Section 6.2 | Runner subscribes to area negotiate channel (Channel 4b), live add/remove bookings |
| 5.8 | **Connection management & reconnect** | Frontend | Section 6.4 | Auto-reconnect, app foreground/background handling |

### Phase 6: Chat & Communication

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 6.1 | **Chat API** | Backend | Section 5.4.6 | `GET/POST /chat/{bookingId}/messages` with pagination |
| 6.2 | **Chat screen** | Frontend | Section 3.6 | Chat UI with bubbles, timestamps, image support |
| 6.3 | **Real-time chat via Supabase** | Frontend | Section 6.2 | New messages appear instantly via Realtime subscription |
| 6.4 | **Chat store (Zustand)** | Frontend | Section 9.1 | useChatStore: messages, send, receive, mark-read |

### Phase 7: Payments

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 7.1 | **Xendit integration (backend)** | Backend | Section 7.3 | Payment Request create/refund via Xendit REST API |
| 7.2 | **Card payment input (frontend)** | Frontend | Section 7.3 | Add card via Xendit API, tokenize, save to backend |
| 7.3 | **GCash integration** | Backend | Section 7.4 | Xendit e-wallet payment request, webhook handling |
| 7.4 | **Maya integration** | Backend | Section 7.4 | Xendit e-wallet payment request (PAYMAYA channel), webhook handling |
| 7.5 | **Wallet system** | Backend | Section 7.5 | WalletService: debit, credit, top-up, balance check |
| 7.6 | **Wallet screen** | Frontend | Section 3.3 | Balance display, transaction history, top-up flow |
| 7.7 | **Payment method management screen** | Frontend | Section 3.3 | List/add/remove/set-default payment methods |
| 7.8 | **Cash on delivery flow** | Backend | Section 7.2 | Runner confirms cash received, platform fee tracking |
| 7.9 | **Refund service** | Backend | Section 7.7 | Refund processing per payment method type |
| 7.10 | **Runner payout system** | Backend | Section 7.6 | Payout calculation, scheduled/instant payouts |

### Phase 8: Notifications

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 8.1 | **Push notification setup (FCM)** | Backend | Section 1.2 | Laravel FCM integration, send push via queue jobs |
| 8.2 | **Expo push notification setup** | Frontend | Section 1.2 | Register FCM token, handle foreground/background push |
| 8.3 | **Notification center screen** | Frontend | Section 3.3 | List notifications, read/unread, tap to navigate |
| 8.4 | **Notification API** | Backend | Section 5.4.7 | `GET /notifications`, read/unread, count |
| 8.5 | **Real-time notification badge** | Frontend | Section 6.2 | Live unread count on tab bar via Supabase Realtime |

### Phase 9: Ratings & Reviews

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 9.1 | **Review API** | Backend | Section 5.4.3 | `POST /bookings/{id}/review` with rating calculation |
| 9.2 | **Rating screen** | Frontend | Section 3.3 | Star selector, comment input, submit after completion |
| 9.3 | **Rating display on profiles** | Frontend | Section 3.6 | Show avg rating on runner cards, profile screens |

### Phase 10: Admin Panel

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 10.1 | **Admin auth (web)** | Backend | Section 5.4.9 | Admin login with 2FA, separate admin guard |
| 10.2 | **Admin dashboard API** | Backend | Section 5.4.9 | Stats: active bookings, revenue, users, runners online |
| 10.3 | **User management API** | Backend | Section 5.4.9 | List, search, suspend/ban users |
| 10.4 | **Runner verification API** | Backend | Section 5.4.9 | Pending queue, approve/reject with notes |
| 10.5 | **Booking management API** | Backend | Section 5.4.9 | List all bookings, detail view, dispute handling |
| 10.6 | **Promo code management API** | Backend | Section 5.4.9 | CRUD promo codes with validation rules |
| 10.7 | **System config API** | Backend | Section 5.4.9 | Update pricing, limits, feature flags |

### Phase 11: Polish & Production

| # | Task | Scope | Inputs | Expected Output |
|---|---|---|---|---|
| 11.1 | **Offline mode & network handling** | Frontend | Section 9.2 | Offline banner, cached data, queued actions |
| 11.2 | **Error boundaries** | Frontend | Section 9.3 | Global + per-screen error boundaries with fallback UI |
| 11.3 | **Dark mode** | Frontend | Section 3.1 | Full dark theme with system detection toggle |
| 11.4 | **Loading states & skeletons** | Frontend | Section 3.6 | Skeleton loaders for all list/detail screens |
| 11.5 | **Profile & settings screens** | Frontend | Section 2.2 | Edit profile, manage addresses, trusted contacts (emergency contacts for SOS/trip share), notification preferences |
| 11.6 | **User profile API** | Backend | Section 5.4.2 | `GET/PUT /user/profile`, avatar upload, FCM token, trusted contacts CRUD |
| 11.7 | **Promo code validation** | Both | Section 5.4.8, 7.8 | Validate and apply promo at booking |
| 11.8 | **Cancellation flow** | Both | Section 2.5 | Cancel booking with fee logic, refund processing |
| 11.9 | **SOS & safety features** | Both | Section 1.2, Module 10a | SOS button (persistent for Transportation), SOS confirmation modal, auto-dial emergency contact, live location sharing to trusted contacts via SMS + link, safety team alert API, route deviation detection, duration safety check, trip sharing for all errand types |
| 11.9b | **Ride PIN verification** | Both | Module 2, Module 10a | Generate 4-digit PIN per Transportation booking, display on customer screen, runner PIN entry UI, `POST /bookings/{id}/verify-pin` API |
| 11.9c | **Route deviation & duration alerts** | Backend | Module 10a | Background job: compare runner's live route to expected route every 30s during Transportation rides. If deviation >500m for >2 min or duration >2× ETA, push safety check notification to customer |
| 11.9d | **Trip sharing** | Both | Module 10a | `POST /bookings/{id}/share-trip` generates a public live-tracking link. Recipient sees runner info, live map, ETA. Link expires on errand completion. Share via SMS/messaging. Available for all errand types. |
| 11.10 | **App icon, splash, store assets** | Frontend | — | Production app icon, adaptive icon, splash screen |

### Task Dependency Graph

```
Phase 1 (Setup)
  └──► Phase 2 (Auth) ────────────────────────┐
         └──► Phase 3 (Customer Core) ────────┤
         └──► Phase 4 (Runner Core) ──────────┤
                └──► Phase 5 (Real-Time) ─────┤
                └──► Phase 6 (Chat) ──────────┤
         └──► Phase 7 (Payments) ─────────────┤
         └──► Phase 8 (Notifications) ────────┤
              Phase 9 (Ratings) ◄─────────────┘
              Phase 10 (Admin) — independent, parallel
              Phase 11 (Polish) — after all features done
```

### Summary

- **Total tasks:** ~83 focused, single-prompt tasks
- **Phase 1–2:** Foundation — must be done first
- **Phase 3–4:** Core features — can overlap (customer + runner in parallel)
- **Phase 5–8:** Enhancements — depend on core being complete
- **Phase 9–10:** Secondary — can be done in parallel with polish
- **Phase 11:** Final polish — after feature-complete

---

*End of Specification Document*
