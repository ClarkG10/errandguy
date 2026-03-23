# ErrandGuy — UI Structure: Errand Runner

**Scope:** All screens accessible to the Errand Runner role  
**Platform:** Mobile (React Native + Expo)  
**Route Group:** `(runner)/`

---

## Page Hierarchy

```
(runner)/
├── (tabs)/
│   ├── Home (Dashboard — Online Toggle, Incoming Requests)
│   ├── Earnings (Daily / Weekly / Monthly Breakdown)
│   ├── History (Completed Errands)
│   └── Profile (Account, Documents, Settings)
├── errand/
│   └── [id] — Active Errand (Navigation, Status Updates, Chat)
├── chat/
│   └── [bookingId] — Chat with Customer
└── payout/
    └── index — Payout Settings & History
```

---

## Bottom Tab Bar

```
┌──────────────────────────────────────────────┐
│  🏠 Home    💰 Earnings    📋 History   👤   │
└──────────────────────────────────────────────┘
```

- **4 tabs**: Home, Earnings, History, Profile
- Active tab: `#2563EB` icon + label
- Inactive tab: `#475569` icon + label
- Icons: Lucide — `Home`, `Wallet`, `ClipboardList`, `User`
- Badge on Home: red dot `#EF4444` when incoming negotiate offers exist
- Tab bar: white surface, top hairline divider `#E2E8F0`

---

## 1. Runner Dashboard (Home — Offline State)

```
┌──────────────────────────────────────────┐
│  ErrandGuy Runner                  🔔 2  │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │     You are  [🔴 Offline]          │  │
│  │                                    │  │
│  │     Toggle to start receiving      │  │
│  │     errand requests                │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Today's Stats ──────────────────── │
│  ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │  ₱ 0     │ │  0       │ │  4.9   │  │
│  │ Earnings │ │ Errands  │ │ Rating │  │
│  └──────────┘ └──────────┘ └────────┘  │
│                                          │
│  ── Recent Errands ─────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  Delivery • ₱120 • 2:00 PM        │  │
│  │  3.2 km • ★ 5.0 from customer     │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  Purchase • ₱185 • 12:30 PM       │  │
│  │  5.1 km • ★ 4.0 from customer     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      No more recent errands.       │  │
│  │      Go online to start earning!   │  │
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  🏠 Home   💰 Earn   📋 Hist   👤      │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Header**
  - Left: "ErrandGuy Runner" — Montserrat Bold, 18px, `#0F172A`
  - Right: Lucide `Bell` icon + notification badge (red dot with count)
- **Online/Offline Toggle Card**
  - Full width card, centered content
  - Large toggle switch (56dp width, 32dp height)
  - Offline: red dot indicator `#EF4444`, "Offline" label
  - Online: green dot indicator `#22C55E`, "Online" label (see Online State below)
  - Subtitle: "Toggle to start receiving errand requests"
  - Font: 16px `#475569`
- **Today's Stats Row**
  - 3 stat cards in a horizontal row
  - Each card: `#F8FAFC` background, 14dp radius
  - Values: Montserrat Bold, 20px, `#0F172A`
  - Labels: 12px, `#475569`
  - Stats: Earnings (₱ total), Errands (count), Rating (avg stars)
- **Recent Errands List**
  - Component: `Card` per errand
  - Shows: errand type icon, payout in ₱, completion time, distance, customer rating
  - Max 5 shown, "View All →" link to History tab
- **Empty State** (when no recent errands)
  - Lottie animation or Lucide `Package` icon (muted)
  - "Go online to start earning!" — 14px, `#475569`

---

## 2. Runner Dashboard (Home — Online State)

```
┌──────────────────────────────────────────┐
│  ErrandGuy Runner                  🔔 2  │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │     You are  [🟢 Online]           │  │
│  │                                    │  │
│  │     Waiting for errand requests... │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Today's Stats ──────────────────── │
│  ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │  ₱ 620   │ │  5       │ │  4.9   │  │
│  │ Earnings │ │ Errands  │ │ Rating │  │
│  └──────────┘ └──────────┘ └────────┘  │
│                                          │
│  ── Negotiate Offers (3) ──────────── │
│  ┌────────────────────────────────────┐  │
│  │  📦 Delivery                       │  │
│  │  Offer: ₱80  (Rec: ₱65–₱115)      │  │
│  │  123 Main St → SM Mall             │  │
│  │  5.2 km • 1.3 km from you         │  │
│  │  ⏱️ Expires in 3:42                │  │
│  │  [Accept ₱80 →]                    │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  🛒 Purchase                       │  │
│  │  Offer: ₱150 (Rec: ₱90–₱160)      │  │
│  │  SM Megamall → Ayala Ave           │  │
│  │  8.1 km • 2.0 km from you         │  │
│  │  ⏱️ Expires in 1:15                │  │
│  │  [Accept ₱150 →]                   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Recent Errands ─────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  Delivery • ₱120 • 2:00 PM        │  │
│  │  3.2 km • ★ 5.0 from customer     │  │
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  🏠 Home   💰 Earn   📋 Hist   👤      │
└──────────────────────────────────────────┘
```

### Component Breakdown (Online State Additions)

- **Online Toggle Card**
  - Green dot indicator `#22C55E`, "Online" label
  - Subtitle: "Waiting for errand requests..."
  - Subtle pulsing animation on green dot (scale 1→1.3→1, loop)
- **Negotiate Offers Section** (conditional — shown when online + offers exist)
  - Section header: "Negotiate Offers (count)" with Lucide `Handshake` icon
  - Scrollable vertical list of offer cards
  - Each card:
    - Errand type icon + label
    - Customer's offered price (bold, `#0F172A`) vs recommended range (`#475569`)
    - Pickup → Drop-off addresses (Lucide `MapPin` icons)
    - Distance + runner's distance from pickup
    - Countdown timer: Lucide `Clock` + "Expires in X:XX" — turns red `#EF4444` below 1 min
    - "Accept ₱XX →" button: filled blue `#2563EB`, white label
  - Empty state: "No negotiate offers right now." — 14px, `#475569`

---

## 3. Incoming Errand Request — Fixed Price (Floating Modal)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                                        ░░
░░  ╔══════════════════════════════════╗  ░░
░░  ║                                  ║  ░░
░░  ║     ████████████████░░░░ 28s     ║  ░░
░░  ║                                  ║  ░░
░░  ║        New Errand Request        ║  ░░
░░  ║                                  ║  ░░
░░  ║  ──────────────────────────────  ║  ░░
░░  ║                                  ║  ░░
░░  ║  📦  Delivery                    ║  ░░
░░  ║                                  ║  ░░
░░  ║  📍 123 Main St                  ║  ░░
░░  ║     ↓  5.2 km                    ║  ░░
░░  ║  📍 SM City Mall                 ║  ░░
░░  ║                                  ║  ░░
░░  ║  ──────────────────────────────  ║  ░░
░░  ║                                  ║  ░░
░░  ║  Est. Payout        ₱120.00      ║  ░░
░░  ║  Pricing             Fixed       ║  ░░
░░  ║  Distance from you   1.3 km      ║  ░░
░░  ║                                  ║  ░░
░░  ║  [Decline]        [Accept →]     ║  ░░
░░  ║                                  ║  ░░
░░  ╚══════════════════════════════════╝  ░░
░░                                        ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

### Component Breakdown

- **Backdrop**: `rgba(15,23,42,0.45)`, blurs content behind card
- **Card**: White `#FFFFFF`, `borderRadius: 24`, no shadow, no border
- **Progress Bar**: Blue `#2563EB` strip at top of card, shrinks left-to-right over 30s
  - When < 10s remaining: bar turns `#EF4444` (danger red)
- **Title**: "New Errand Request" — Montserrat Bold, 18px, `#0F172A`, centered
- **Errand Type**: Icon + label — 16px, `#0F172A`
- **Locations**: Lucide `MapPin` icons, addresses in 14px `#0F172A`, distance in `#475569`
- **Details Grid**
  - Labels: 14px, `#475569` (left-aligned)
  - Values: 14px, Montserrat Bold, `#0F172A` (right-aligned)
  - Payout value slightly larger: 18px, `#2563EB`
- **Decline Button**: Ghost button (text only, `#475569`)
- **Accept Button**: Filled blue `#2563EB`, white label, Lucide `Check` icon
- **Sound + Vibration**: Alert sound plays on arrival, haptic feedback on accept/decline
- **Animation**: Card translates from Y+40→0, opacity 0→1 on mount; reverses on dismiss
- **Auto-decline**: If timer expires (30s) with no action → card dismisses automatically

---

## 4. Incoming Errand Request — Transportation (Floating Modal)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                                        ░░
░░  ╔══════════════════════════════════╗  ░░
░░  ║                                  ║  ░░
░░  ║     ████████████████░░░░ 28s     ║  ░░
░░  ║                                  ║  ░░
░░  ║     New Ride Request  🚗         ║  ░░
░░  ║                                  ║  ░░
░░  ║  ──────────────────────────────  ║  ░░
░░  ║                                  ║  ░░
░░  ║  🚗  Transportation              ║  ░░
░░  ║                                  ║  ░░
░░  ║  📍 Pick up passenger at:        ║  ░░
░░  ║     Ayala Triangle Gardens       ║  ░░
░░  ║     ↓  7.8 km                    ║  ░░
░░  ║  📍 Drop off at:                 ║  ░░
░░  ║     Greenbelt 5, Makati          ║  ░░
░░  ║                                  ║  ░░
░░  ║  ──────────────────────────────  ║  ░░
░░  ║                                  ║  ░░
░░  ║  Est. Payout        ₱185.00      ║  ░░
░░  ║  Pricing             Fixed       ║  ░░
░░  ║  Distance from you   2.1 km      ║  ░░
░░  ║  Vehicle Required    Motorcycle  ║  ░░
░░  ║                                  ║  ░░
░░  ║  ⚠️ Passenger ride — PIN         ║  ░░
░░  ║    verification required         ║  ░░
░░  ║                                  ║  ░░
░░  ║  [Decline]        [Accept →]     ║  ░░
░░  ║                                  ║  ░░
░░  ╚══════════════════════════════════╝  ░░
░░                                        ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

### Component Breakdown

- Same structure as Fixed Price modal above, with additions:
- **Title**: "New Ride Request" with Lucide `Car` icon
- **Labels**: "Pick up passenger at:" / "Drop off at:" (emphasizes passenger ride)
- **Vehicle Required row**: Shows which vehicle type the customer selected
- **PIN Notice**: Warning-style info row with Lucide `AlertTriangle` icon
  - "Passenger ride — PIN verification required"
  - Font: 13px, `#475569`
  - Background: `#DBEAFE` tint on the info row

---

## 5. Active Errand Screen — Standard Errand

```
┌──────────────────────────────────────────┐
│  [← Back]      Active Errand     [Chat]  │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │            MAP VIEW                │  │
│  │                                    │  │
│  │    ◉ Pickup                        │  │
│  │    │                               │  │
│  │    ╌╌╌╌ (route) ╌╌╌╌              │  │
│  │    │                               │  │
│  │    ▣ You (Runner)                  │  │
│  │    │                               │  │
│  │    ╌╌╌╌ (route) ╌╌╌╌              │  │
│  │    │                               │  │
│  │    ◉ Drop-off                      │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Errand Details ────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  📦 Delivery                       │  │
│  │  From: 123 Main St                 │  │
│  │  To:   SM City Mall               │  │
│  │  Items: Brown box, ~2 kg          │  │
│  │  Notes: Handle with care          │  │
│  │  Payout: ₱120.00                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Status Timeline ───────────────── │
│  ✅  Accepted                2:30 PM   │
│  ✅  En Route to Pickup      2:31 PM   │
│  🔵  At Pickup               now       │
│  ○   Picked Up                         │
│  ○   In Transit                        │
│  ○   Arrived                           │
│  ○   Completed                         │
│                                          │
│  ── Customer ────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  👤 Juan D.  ★ 4.7               │  │
│  │  [📞 Call]  [💬 Chat]             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      [ Arrived at Pickup ✓ ]       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      [ 🧭 Navigate ]              │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Header**
  - Left: Back arrow (Lucide `ArrowLeft`) → returns to Dashboard
  - Center: "Active Errand" — Montserrat Bold, 18px
  - Right: Lucide `MessageCircle` icon → Chat with customer
- **Map View** (top half ~ 40% of screen)
  - Component: `MapView` (Mapbox)
  - Shows: pickup pin, drop-off pin, runner marker (self), route polyline
  - Runner marker rotates to match heading
  - Polyline: dashed blue `#2563EB` 50% opacity (en route to pickup), solid blue (in transit)
  - Already-traveled route fades to `#DBEAFE`
  - Auto-centers to show all markers
- **Errand Details Card**
  - Errand type icon + label
  - Pickup and drop-off addresses with Lucide `MapPin`
  - Item description, special notes
  - Payout: Montserrat Bold, 18px, `#2563EB`
- **Status Timeline** (vertical stepper)
  - Component: `StatusTimeline`
  - Completed steps: ✅ green checkmark + timestamp
  - Current step: 🔵 blue filled circle + "now"
  - Upcoming steps: ○ empty circle, muted text `#94A3B8`
  - Steps: Accepted → En Route to Pickup → At Pickup → Picked Up → In Transit → Arrived → Completed
- **Customer Info Card**
  - Component: `Avatar` with name + star rating
  - Action buttons: Lucide `Phone` (Call) + Lucide `MessageCircle` (Chat)
  - Call uses VoIP or masked phone number for privacy
- **Primary Action Button** (context-sensitive, changes label per status)
  - At "En Route to Pickup" → shows **"Arrived at Pickup ✓"**
  - At "At Pickup" → shows **"Picked Up ✓"** (optional photo proof modal)
  - At "In Transit" → shows **"Arrived ✓"**
  - At "Arrived" → shows **"Complete Errand ✓"** (photo proof / signature modal)
  - Style: full width, blue `#2563EB`, white label, 52dp height, Lucide `CheckCircle` icon
  - Haptic feedback on tap
- **Navigate Button**
  - Secondary outline button, `#2563EB` border and text
  - Lucide `Navigation` icon
  - Tap → opens in-app navigation OR launches external maps app (user preference)

---

## 6. Active Errand Screen — Transportation (Passenger Ride)

```
┌──────────────────────────────────────────┐
│  [← Back]     Passenger Ride     [Chat]  │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │            MAP VIEW                │  │
│  │                                    │  │
│  │    ◉ Customer Location             │  │
│  │    │                               │  │
│  │    ╔════ (route) ════╗             │  │
│  │    │                               │  │
│  │    ▣ You (Runner)                  │  │
│  │    │                               │  │
│  │    ╔════ (route) ════╗             │  │
│  │    │                               │  │
│  │    ◉ Destination                   │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Ride Details ──────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  🚗 Transportation                 │  │
│  │  Pick up: Ayala Triangle Gardens   │  │
│  │  Drop off: Greenbelt 5, Makati     │  │
│  │  Notes: (none)                     │  │
│  │  Payout: ₱185.00                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── PIN Verification ────────────── │
│  ┌────────────────────────────────────┐  │
│  │  Enter the customer's 4-digit PIN  │  │
│  │                                    │  │
│  │     [ _ ] [ _ ] [ _ ] [ _ ]        │  │
│  │                                    │  │
│  │  Ask the passenger to share their  │  │
│  │  ride PIN before starting.         │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Status Timeline ───────────────── │
│  ✅  Accepted                2:30 PM   │
│  ✅  En Route to Customer    2:31 PM   │
│  🔵  Arrived at Customer     now       │
│  ○   Customer Picked Up                │
│  ○   In Transit                        │
│  ○   Arrived at Destination            │
│  ○   Completed                         │
│                                          │
│  ── Customer ────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  👤 Juan D.  ★ 4.7               │  │
│  │  [📞 Call]  [💬 Chat]             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │   [ Customer Picked Up ✓ ]         │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      [ 🧭 Navigate ]              │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown (Transportation Additions)

- **Header**: "Passenger Ride" instead of "Active Errand"
- **Map View**
  - Customer marker: white circle with blue border + Lucide `User` icon
  - Route: solid blue polyline (emphasis on passenger safety)
- **Ride Details Card**
  - Same as Errand Details but labels say "Pick up:" / "Drop off:"
  - No item description or photos (simplified for passenger rides)
- **PIN Verification Section** (shown when status = "Arrived at Customer")
  - 4 individual digit input boxes, evenly spaced
  - Each box: 52dp × 52dp, `#E2E8F0` border, `#0F172A` text, 24px font
  - On correct PIN entry: boxes turn `#2563EB` border, success checkmark animation
  - On incorrect PIN: boxes shake (spring animation), border turns `#EF4444` briefly
  - Helper text: "Ask the passenger to share their ride PIN before starting."
  - PIN verification is **required** before "Customer Picked Up" can be tapped
- **Status Timeline** (modified for Transportation)
  - Steps: Accepted → En Route to Customer → Arrived at Customer → Customer Picked Up → In Transit → Arrived at Destination → Completed
- **Primary Action Button** (context-sensitive)
  - At "Arrived at Customer" → **"Customer Picked Up ✓"** (disabled until PIN verified)
  - At "Customer Picked Up" → **"In Transit"** (auto-set)
  - At "In Transit" → **"Arrived at Destination ✓"**
  - At "Arrived at Destination" → **"Ride Completed ✓"**

---

## 7. Photo Proof Modal (Floating Modal)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                                        ░░
░░  ╔══════════════════════════════════╗  ░░
░░  ║                                  ║  ░░
░░  ║       📸  Photo Proof            ║  ░░
░░  ║                                  ║  ░░
░░  ║  Take a photo to confirm         ║  ░░
░░  ║  pickup / delivery.              ║  ░░
░░  ║                                  ║  ░░
░░  ║  ┌──────────────────────────┐    ║  ░░
░░  ║  │                          │    ║  ░░
░░  ║  │    [Camera Preview]      │    ║  ░░
░░  ║  │                          │    ║  ░░
░░  ║  │                          │    ║  ░░
░░  ║  └──────────────────────────┘    ║  ░░
░░  ║                                  ║  ░░
░░  ║  [Skip]          [📸 Capture]    ║  ░░
░░  ║                                  ║  ░░
░░  ╚══════════════════════════════════╝  ░░
░░                                        ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

### Component Breakdown

- **Backdrop**: `rgba(15,23,42,0.45)`
- **Card**: White `#FFFFFF`, `borderRadius: 24`
- **Title**: Lucide `Camera` icon + "Photo Proof" — Montserrat Bold, 18px
- **Subtitle**: "Take a photo to confirm pickup / delivery." — 14px, `#475569`
- **Camera Preview**: Embedded camera view, 16:9 aspect ratio, rounded corners
- **Skip Button**: Ghost text, `#475569` — available for pickup step (optional proof)
- **Capture Button**: Filled blue `#2563EB`, Lucide `Camera` icon, white label
- After capture: preview shown with "Retake" and "Confirm" buttons

---

## 8. Completion & Signature Modal (Floating Modal)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                                        ░░
░░  ╔══════════════════════════════════╗  ░░
░░  ║                                  ║  ░░
░░  ║      ✅  Complete Errand         ║  ░░
░░  ║                                  ║  ░░
░░  ║  ── Photo Proof ───────────────  ║  ░░
░░  ║  ┌──────────────────────────┐    ║  ░░
░░  ║  │  [Captured Photo ✓]      │    ║  ░░
░░  ║  └──────────────────────────┘    ║  ░░
░░  ║  [Retake]                        ║  ░░
░░  ║                                  ║  ░░
░░  ║  ── Signature (if required) ──  ║  ░░
░░  ║  ┌──────────────────────────┐    ║  ░░
░░  ║  │                          │    ║  ░░
░░  ║  │  [Sign here with finger] │    ║  ░░
░░  ║  │                          │    ║  ░░
░░  ║  └──────────────────────────┘    ║  ░░
░░  ║  [Clear]                         ║  ░░
░░  ║                                  ║  ░░
░░  ║  ┌──────────────────────────┐    ║  ░░
░░  ║  │     [ Confirm ✓ ]        │    ║  ░░
░░  ║  └──────────────────────────┘    ║  ░░
░░  ║                                  ║  ░░
░░  ╚══════════════════════════════════╝  ░░
░░                                        ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

### Component Breakdown

- **Photo Proof Section**: Thumbnail of captured delivery photo, "Retake" link
- **Signature Pad** (conditional — required for some errand types)
  - Canvas drawing area, customer signs with finger
  - "Clear" ghost button to reset
  - Bordered area: `#E2E8F0`, rounded 14dp
- **Confirm Button**: Full width, blue `#2563EB`, "Confirm ✓" — submits proof + marks complete
- **Haptic feedback**: Success vibration pattern on confirm

---

## 9. Chat with Customer

```
┌──────────────────────────────────────────┐
│  [← Back]     Juan D.           [📞]    │
│─────────────────────────────────────────│
│                                          │
│           ┌──────────────────┐           │
│           │ Today, 2:35 PM   │           │
│           └──────────────────┘           │
│                                          │
│  ┌──────────────────────┐                │
│  │ Hi, I'm on my way to │                │
│  │ pick up your package. │                │
│  │           2:35 PM  ✓✓ │                │
│  └──────────────────────┘                │
│                                          │
│                ┌──────────────────────┐   │
│                │ Great, thanks! The   │   │
│                │ package is at the    │   │
│                │ front desk.         │   │
│                │ 2:36 PM             │   │
│                └──────────────────────┘   │
│                                          │
│  ┌──────────────────────┐                │
│  │ 📷 [Image]           │                │
│  │           2:38 PM  ✓✓ │                │
│  └──────────────────────┘                │
│                                          │
│  ── Quick Messages ──────────────────── │
│  ┌────────┐ ┌──────────┐ ┌────────────┐ │
│  │I'm here│ │On my way │ │Running late│ │
│  └────────┘ └──────────┘ └────────────┘ │
│                                          │
│  ┌──────────────────────────────┬──┬──┐  │
│  │  Type a message...           │📷│ ➤│  │
│  └──────────────────────────────┴──┴──┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Header**
  - Left: Back arrow (Lucide `ArrowLeft`)
  - Center: Customer name — Montserrat Bold, 16px
  - Right: Lucide `Phone` icon for VoIP/masked call
- **Date Separator**: Rounded pill, `#F8FAFC` background, 12px `#475569` text, centered
- **Runner Messages (sent)** — left-aligned
  - Component: `ChatBubble`
  - Background: `#2563EB` (blue)
  - Text: white, 14px
  - Timestamp: 12px, white 70% opacity
  - Read receipts: ✓ (sent), ✓✓ (delivered/read) — white
- **Customer Messages (received)** — right-aligned
  - Background: `#F1F5F9` (light gray)
  - Text: `#0F172A`, 14px
  - Timestamp: 12px, `#475569`
- **Image Messages**: Rounded image thumbnail (max 200dp wide), tap to enlarge
- **Quick Messages Bar**
  - Horizontal scrollable row of pre-canned chips
  - Each chip: `#DBEAFE` background, `#2563EB` text, 12dp radius
  - Options: "I'm here", "On my way", "Running late", "At pickup", "Package collected"
  - Tap → instantly sends as message
- **Input Bar**
  - Text input: `#F8FAFC` background, rounded 24dp, placeholder "Type a message..."
  - Camera button: Lucide `Camera` icon — opens camera/gallery picker
  - Send button: Lucide `Send` icon, `#2563EB`, 44dp tap target
  - Send button disabled (muted) when input is empty

---

## 10. Earnings Screen

```
┌──────────────────────────────────────────┐
│  Earnings                                │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │          ₱ 3,240.00               │  │
│  │        This Week's Earnings        │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Period ───────────────────────────  │
│  ┌──────────┐┌──────────┐┌──────────┐  │
│  │  Today   ││  Week ●  ││  Month   │  │
│  └──────────┘└──────────┘└──────────┘  │
│                                          │
│  ── Breakdown ───────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  Base Earnings         ₱ 2,880.00  │  │
│  │  Tips                   ₱   360.00 │  │
│  │  Bonuses                ₱     0.00 │  │
│  │  ──────────────────────────────── │  │
│  │  Total                 ₱ 3,240.00  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Daily Chart ─────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │   ₱                               │  │
│  │   █                               │  │
│  │   █  █        █                    │  │
│  │   █  █  █     █  █                 │  │
│  │   █  █  █  █  █  █  █             │  │
│  │   M  T  W  T  F  S  S             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Per-Errand Earnings ─────────── │
│  ┌────────────────────────────────────┐  │
│  │  📦 Delivery          ₱120  2:00PM │  │
│  │  Base: ₱110 + Tip: ₱10            │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  🛒 Purchase           ₱185 12:30P│  │
│  │  Base: ₱170 + Tip: ₱15            │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [Request Payout →]                      │
│                                          │
├──────────────────────────────────────────┤
│  🏠 Home   💰 Earn   📋 Hist   👤      │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Earnings Hero Card**
  - Large amount: Montserrat Bold, 30px, `#0F172A`
  - Period label: 14px, `#475569`
  - Background: `#DBEAFE` tint, full width
- **Period Selector** (segmented control)
  - 3 segments: Today, Week, Month
  - Active: `#2563EB` background, white text
  - Inactive: `#F8FAFC` background, `#475569` text
  - Switching recalculates all values + chart
- **Breakdown Card**
  - Labels: 14px, `#475569` (left-aligned)
  - Values: 14px, `#0F172A` (right-aligned)
  - Total row: Montserrat Bold, 16px, `#0F172A`, top border `#E2E8F0`
- **Daily Chart** (bar chart)
  - Blue bars `#2563EB`, rounded tops
  - Day labels: 12px, `#475569`
  - Y-axis: earnings scale
  - Tap on bar → shows daily total in a `Popover`
- **Per-Errand Earnings List**
  - Each card: errand type icon, payout, time, base + tip breakdown
  - Scrollable, loads more on scroll
- **Request Payout Button**
  - Outline button, `#2563EB` border and text
  - Navigates to Payout screen

---

## 11. Errand History Screen

```
┌──────────────────────────────────────────┐
│  Errand History                          │
│─────────────────────────────────────────│
│                                          │
│  ── Filters ─────────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │ 🔍 Search errands...              │  │
│  └────────────────────────────────────┘  │
│  ┌────────┐ ┌─────────┐ ┌───────────┐  │
│  │All Type│ │All Status│ │ Date Range│  │
│  └────────┘ └─────────┘ └───────────┘  │
│                                          │
│  ── This Week ───────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  📦  Delivery                      │  │
│  │  123 Main St → SM City Mall        │  │
│  │  Mar 24, 2:00 PM • ₱120            │  │
│  │  ★ 5.0 from Juan D.               │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  🛒  Purchase & Deliver            │  │
│  │  SM Megamall → Ayala Ave           │  │
│  │  Mar 23, 12:30 PM • ₱185           │  │
│  │  ★ 4.0 from Maria S.              │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Last Week ───────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  🚗  Transportation                │  │
│  │  Ayala Triangle → Greenbelt 5      │  │
│  │  Mar 18, 4:15 PM • ₱185            │  │
│  │  ★ 5.0 from Carlos R.             │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📄  Document Processing           │  │
│  │  City Hall → Customer Address      │  │
│  │  Mar 16, 10:00 AM • ₱95            │  │
│  │  ★ 4.5 from Anna T.               │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│                                          │
│          ── Load More ──                 │
│                                          │
├──────────────────────────────────────────┤
│  🏠 Home   💰 Earn   📋 Hist   👤      │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Search Bar**
  - Lucide `Search` icon + text input
  - Placeholder: "Search errands..."
  - Background: `#F8FAFC`, rounded 14dp
  - Searches by customer name, address, errand type
- **Filter Chips** (horizontal row)
  - "All Types" dropdown: filters by errand category
  - "All Status" dropdown: Completed, Cancelled
  - "Date Range" dropdown: opens calendar date range picker
  - Active filter: `#2563EB` fill, white text
  - Inactive: `#F8FAFC` fill, `#475569` text
- **Date Group Headers**
  - "This Week", "Last Week", "March 2026", etc.
  - Font: Montserrat Bold, 14px, `#475569`
- **Errand Cards**
  - Errand type icon + label
  - Pickup → Drop-off addresses
  - Date, time, payout amount
  - Customer rating received (stars + customer name)
  - Status badge: `Completed` (green `#22C55E`), `Cancelled` (red `#EF4444`)
  - Tap → opens Errand Detail screen (expanded timeline, chat log, payment detail)
- **Load More**: Ghost text button, loads next page of results
- **Empty State**: Lottie animation + "No completed errands yet." text

---

## 12. Errand Detail (Expanded History Item)

```
┌──────────────────────────────────────────┐
│  [← Back]       Errand Detail            │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📦  Delivery          ✅ Completed │  │
│  │  Mar 24, 2026 • 2:00 PM           │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Route ───────────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  📍 123 Main St                    │  │
│  │     ↓  5.2 km                      │  │
│  │  📍 SM City Mall                   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Status Timeline ──────────────── │
│  ✅  Accepted               2:30 PM    │
│  ✅  En Route to Pickup     2:31 PM    │
│  ✅  At Pickup              2:40 PM    │
│  ✅  Picked Up              2:42 PM    │
│  ✅  In Transit             2:42 PM    │
│  ✅  Arrived                2:55 PM    │
│  ✅  Completed              2:56 PM    │
│                                          │
│  ── Earnings ────────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  Base Payout             ₱110.00   │  │
│  │  Tip                      ₱10.00   │  │
│  │  ──────────────────────────────── │  │
│  │  Total Earned            ₱120.00   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Customer ────────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  👤 Juan D.    ★ 4.7              │  │
│  │  Rating given: ★ 5.0              │  │
│  │  Rating received: ★ 5.0           │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Proof ───────────────────────────  │
│  ┌────────────────────────────────────┐  │
│  │  📷 Pickup Photo    📷 Delivery    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [Report an Issue]                       │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Header Card**: errand type, status badge, date/time
- **Route Section**: pickup/drop-off with Lucide `MapPin`, distance
- **Status Timeline**: complete timeline with all timestamps
- **Earnings Card**: base payout, tip, total — uses `PriceBreakdown` component
- **Customer Card**: `Avatar` + name, star ratings (given and received)
- **Proof Section**: thumbnails of captured photos (tap to enlarge in a lightbox)
- **Report an Issue**: ghost button, `#EF4444` text, navigates to issue report form

---

## 13. Runner Profile Screen

```
┌──────────────────────────────────────────┐
│  Profile                                 │
│─────────────────────────────────────────│
│                                          │
│         ┌──────────────┐                 │
│         │              │                 │
│         │   👤 Photo   │                 │
│         │              │                 │
│         └──────────────┘                 │
│         Mark Dela Cruz                   │
│         ★ 4.9 • 248 errands             │
│         ✅ Verified Runner               │
│                                          │
│  ── Performance ─────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  Acceptance Rate        92%        │  │
│  │  Completion Rate        98%        │  │
│  │  Avg. Rating           4.9 ★       │  │
│  │  Total Errands          248        │  │
│  │  Member Since       Jan 2026       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Account ─────────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  👤  Edit Profile               →  │  │
│  │  ──────────────────────────────── │  │
│  │  📄  Documents & Verification   →  │  │
│  │  ──────────────────────────────── │  │
│  │  🚗  Vehicle Information        →  │  │
│  │  ──────────────────────────────── │  │
│  │  💰  Payout Settings            →  │  │
│  │  ──────────────────────────────── │  │
│  │  📋  Preferred Errand Types     →  │  │
│  │  ──────────────────────────────── │  │
│  │  📍  Working Areas              →  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Settings ────────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  🔔  Notification Preferences   →  │  │
│  │  ──────────────────────────────── │  │
│  │  🌙  Dark Mode          [Toggle]  │  │
│  │  ──────────────────────────────── │  │
│  │  ❓  Help & Support             →  │  │
│  │  ──────────────────────────────── │  │
│  │  📜  Terms & Privacy            →  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │          Log Out                   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │        Delete Account              │  │
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  🏠 Home   💰 Earn   📋 Hist   👤      │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Profile Header**
  - Component: `Avatar` — large (80dp), tap to change photo
  - Name: Montserrat Bold, 20px, `#0F172A`
  - Stats line: "★ 4.9 • 248 errands" — 14px, `#475569`
  - Verified badge: `Badge` component, `#2563EB` background, "Verified Runner" label
- **Performance Card**
  - Grid of key metrics
  - Labels: 14px, `#475569`; Values: 14px, Montserrat Bold, `#0F172A`
  - Acceptance/Completion rates: show warning below threshold (orange text)
- **Account Menu**
  - List of navigation items, each with Lucide icon + label + chevron right (`ChevronRight`)
  - Dividers: `#E2E8F0` hairlines
  - Tap → navigates to sub-screen:
    - **Edit Profile**: name, phone, email, photo, date of birth, address
    - **Documents & Verification**: view uploaded docs, upload new/renewal, verification status
    - **Vehicle Information**: vehicle type, plate number, photo — edit/update
    - **Payout Settings**: → navigates to Payout screen
    - **Preferred Errand Types**: toggle which errand types to receive
    - **Working Areas**: map with geofence to set preferred zones
- **Settings Menu**
  - Same list style as Account menu
  - Dark Mode: inline toggle switch (Lucide `Moon` icon)
  - Help & Support: links to FAQ + in-app support
  - Terms & Privacy: opens in-app webview
- **Log Out Button**: Outline button, `#475569` text
  - Confirmation dialog before logout
- **Delete Account Button**: Ghost text, `#EF4444` (danger red)
  - Triggers confirmation modal explaining 30-day soft delete grace period

---

## 14. Documents & Verification Screen

```
┌──────────────────────────────────────────┐
│  [← Back]   Documents & Verification     │
│─────────────────────────────────────────│
│                                          │
│  ── Verification Status ─────────────── │
│  ┌────────────────────────────────────┐  │
│  │  ✅  Verified                       │  │
│  │  Approved on Jan 15, 2026          │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Government ID ───────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  ┌─────────────┐ ┌─────────────┐  │  │
│  │  │  ID Front   │ │  ID Back    │  │  │
│  │  │   [✓]       │ │   [✓]      │  │  │
│  │  └─────────────┘ └─────────────┘  │  │
│  │  Status: ✅ Approved               │  │
│  │  [Update ID →]                     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Selfie with ID ──────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  ┌─────────────┐                  │  │
│  │  │  Selfie     │                  │  │
│  │  │   [✓]       │                  │  │
│  │  └─────────────┘                  │  │
│  │  Status: ✅ Approved               │  │
│  │  [Retake Selfie →]                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Vehicle Documents ───────────────── │
│  ┌────────────────────────────────────┐  │
│  │  ┌─────────────┐                  │  │
│  │  │  Vehicle    │                  │  │
│  │  │  Photo [✓] │                  │  │
│  │  └─────────────┘                  │  │
│  │  Type: Motorcycle                  │  │
│  │  Plate: ABC-1234                   │  │
│  │  Status: ✅ Approved               │  │
│  │  [Update Vehicle Info →]           │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Admin Notices ───────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  No admin notices at this time.    │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Verification Status Banner**
  - Approved: green `#22C55E` background tint, checkmark icon
  - Pending: blue `#DBEAFE` background tint, clock icon
  - Rejected: red `#FEE2E2` background tint, `X` icon + rejection reason
- **Document Sections** (repeating pattern for each document type)
  - Thumbnail preview of uploaded image(s)
  - Checkmark overlay on approved documents
  - Status badge: Approved, Pending Review, Rejected, Expired
  - Action link: "Update ID →", "Retake Selfie →", "Update Vehicle Info →"
  - Tap thumbnail → opens full-screen image viewer
- **Admin Notices Section**
  - Shows any messages from admin regarding documents
  - Empty state: "No admin notices at this time."

---

## 15. Payout Settings & History Screen

```
┌──────────────────────────────────────────┐
│  [← Back]        Payouts                 │
│─────────────────────────────────────────│
│                                          │
│  ── Available Balance ───────────────── │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │         ₱ 1,850.00                │  │
│  │      Available for payout          │  │
│  │                                    │  │
│  │  [Request Instant Payout]          │  │
│  │  ₱15 fee applies                   │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Payout Method ───────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  💰  GCash  •••• 7890             │  │
│  │  Primary payout method             │  │
│  │  [Change →]                        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Next Scheduled Payout ───────────── │
│  ┌────────────────────────────────────┐  │
│  │  📅  Monday, Mar 30, 2026         │  │
│  │  Estimated: ₱1,850.00             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Payout History ──────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  Mar 23 • Weekly Payout            │  │
│  │  ₱3,240.00 → GCash •••• 7890      │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  Mar 16 • Instant Payout           │  │
│  │  ₱1,500.00 → GCash •••• 7890      │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  Mar 9 • Weekly Payout             │  │
│  │  ₱2,880.00 → GCash •••• 7890      │  │
│  │  Status: ✅ Completed               │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Available Balance Card**
  - Large amount: Montserrat Bold, 30px, `#0F172A`
  - "Available for payout" — 14px, `#475569`
  - Background: `#DBEAFE` tint
  - "Request Instant Payout" button: filled blue `#2563EB`
  - Fee notice: 12px, `#475569`, "₱15 fee applies"
  - Tap → confirmation modal with payout amount and fee
- **Payout Method Card**
  - Icon: payment method logo (GCash, bank icon, etc.)
  - Masked account number
  - "Primary payout method" label
  - "Change →" link → opens payout method setup
    - Options: Bank account, GCash, PayPal e-wallet
    - Form: account name, account number, verification
- **Next Scheduled Payout**
  - Calendar icon + date
  - Estimated payout amount
  - "Weekly payouts process every Monday"
- **Payout History List**
  - Each card: date, payout type (Weekly / Instant), amount, method, status
  - Status: Completed (green), Processing (blue), Failed (red)
  - Scrollable, paginated

---

## 16. Preferred Errand Types Screen

```
┌──────────────────────────────────────────┐
│  [← Back]    Preferred Errand Types      │
│─────────────────────────────────────────│
│                                          │
│  Choose which errand types you want      │
│  to receive requests for.                │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📦  Delivery              [✓ On]  │  │
│  │  ──────────────────────────────── │  │
│  │  🛒  Purchase & Deliver    [✓ On]  │  │
│  │  ──────────────────────────────── │  │
│  │  💰  Bills Payment         [✓ On]  │  │
│  │  ──────────────────────────────── │  │
│  │  ⏳  Queue / Line Waiting  [  Off] │  │
│  │  ──────────────────────────────── │  │
│  │  📄  Document Processing   [✓ On]  │  │
│  │  ──────────────────────────────── │  │
│  │  🚗  Transportation        [✓ On]  │  │
│  │  ──────────────────────────────── │  │
│  │  ⚙️   Custom Errand         [✓ On]  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ℹ️ At least one type must be enabled.    │
│                                          │
│  [Save Preferences]                      │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Subtitle**: "Choose which errand types you want to receive requests for." — 14px, `#475569`
- **Toggle List**: Each row has errand type icon + label + toggle switch
  - On: toggle is `#2563EB`, label in `#0F172A`
  - Off: toggle is `#E2E8F0`, label in `#94A3B8`
  - Dividers: `#E2E8F0` hairlines
  - At least 1 must remain on — toggling the last one off shows a `Toast` warning
- **Info Note**: Lucide `Info` icon + text, `#475569`, 13px
- **Save Button**: Full width, blue `#2563EB`, "Save Preferences"
  - Success: `Toast` confirmation "Preferences saved"

---

## 17. Working Areas Screen

```
┌──────────────────────────────────────────┐
│  [← Back]       Working Areas            │
│─────────────────────────────────────────│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │            MAP VIEW                │  │
│  │                                    │  │
│  │     ┌─── ─── ─── ─── ┐            │  │
│  │     │   Your working  │            │  │
│  │     │     area        │            │  │
│  │     │  (blue shaded)  │            │  │
│  │     └─── ─── ─── ─── ┘            │  │
│  │                                    │  │
│  │        📍 You are here             │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Your Working Areas ──────────────── │
│  ┌────────────────────────────────────┐  │
│  │  📍 Makati CBD           [✏️] [🗑️] │  │
│  │  ~5 km radius                      │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  📍 BGC, Taguig          [✏️] [🗑️] │  │
│  │  ~3 km radius                      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [+ Add Working Area]                    │
│                                          │
│  ℹ️ You'll only receive errand requests   │
│    from within your working areas.       │
│                                          │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Map View** (top 50% of screen)
  - Component: `MapView` (Mapbox)
  - Shows shaded blue geofenced areas (`#2563EB` at 15% opacity, `#2563EB` border)
  - Runner's current location pin
  - Tap on map to add/adjust area center point
- **Working Areas List**
  - Each card: location name, radius
  - Edit button (Lucide `Pencil`): opens area adjustment (radius slider + map repositioning)
  - Delete button (Lucide `Trash2`): confirmation before removing
- **Add Working Area Button**: Outline button, Lucide `Plus` + "Add Working Area"
  - Tap → map enters selection mode, tap to place center → radius slider appears
- **Info Note**: "You'll only receive errand requests from within your working areas."

---

## 18. Notification Center (Runner)

```
┌──────────────────────────────────────────┐
│  Notifications                           │
│─────────────────────────────────────────│
│                                          │
│  ── Today ───────────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  🟢 New errand near you!           │  │
│  │  A ₱120 Delivery request is        │  │
│  │  available 1.3 km from you.        │  │
│  │  2 min ago                         │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  ✅ Errand completed               │  │
│  │  ₱185 has been added to your       │  │
│  │  earnings for Purchase errand.     │  │
│  │  1 hour ago                        │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  ⭐ New rating received            │  │
│  │  Juan D. rated you 5 stars!        │  │
│  │  2 hours ago                       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ── Yesterday ───────────────────────── │
│  ┌────────────────────────────────────┐  │
│  │  💰 Weekly payout processed        │  │
│  │  ₱3,240.00 sent to GCash          │  │
│  │  •••• 7890                         │  │
│  │  Yesterday, 6:00 AM               │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  📢 New announcement               │  │
│  │  Weekend bonus: Earn extra ₱20     │  │
│  │  per errand this Saturday!         │  │
│  │  Yesterday, 10:00 AM              │  │
│  └────────────────────────────────────┘  │
│                                          │
│         Mark all as read                 │
│                                          │
├──────────────────────────────────────────┤
│  🏠 Home   💰 Earn   📋 Hist   👤      │
└──────────────────────────────────────────┘
```

### Component Breakdown

- **Header**: "Notifications" — Montserrat Bold, 20px
- **Date Group Headers**: "Today", "Yesterday", "Mar 22" — 14px, Montserrat Bold, `#475569`
- **Notification Cards**
  - Unread: white background with left blue dot indicator (4dp, `#2563EB`)
  - Read: `#F8FAFC` background, no dot
  - Icon: contextual (errand, payment, rating, announcement)
  - Title: Montserrat Bold, 14px, `#0F172A`
  - Body: 13px, `#475569`, max 2 lines
  - Timestamp: 12px, `#94A3B8`
  - Tap → navigates to relevant screen (errand detail, earnings, etc.)
  - Swipe left → dismiss / mark as read
- **Mark All as Read**: ghost text button, `#2563EB`, centered
- **Empty State**: Lucide `Bell` icon (muted) + "No notifications yet."

---

## 19. Rate Customer (Floating Modal)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                                        ░░
░░  ╔══════════════════════════════════╗  ░░
░░  ║                                  ║  ░░
░░  ║     Rate Your Customer           ║  ░░
░░  ║                                  ║  ░░
░░  ║  ┌──────────────┐                ║  ░░
░░  ║  │  👤 Juan D.  │                ║  ░░
░░  ║  └──────────────┘                ║  ░░
░░  ║                                  ║  ░░
░░  ║     ☆  ☆  ☆  ☆  ☆               ║  ░░
░░  ║                                  ║  ░░
░░  ║  How was your experience?        ║  ░░
░░  ║  ┌──────────────────────────┐    ║  ░░
░░  ║  │  (Optional comment...)   │    ║  ░░
░░  ║  │                          │    ║  ░░
░░  ║  └──────────────────────────┘    ║  ░░
░░  ║                                  ║  ░░
░░  ║  [Skip]         [Submit ★]       ║  ░░
░░  ║                                  ║  ░░
░░  ╚══════════════════════════════════╝  ░░
░░                                        ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

### Component Breakdown

- **Backdrop**: `rgba(15,23,42,0.45)`
- **Card**: White `#FFFFFF`, `borderRadius: 24`
- **Title**: "Rate Your Customer" — Montserrat Bold, 18px, `#0F172A`
- **Customer Info**: `Avatar` + name
- **Star Rating**: Component: `RatingStars` (interactive)
  - 5 stars, tap to select rating (1–5)
  - Empty: `#E2E8F0` outline stars
  - Filled: `#2563EB` solid stars
  - Haptic feedback on each star tap
- **Comment Input**: Textarea, optional
  - Placeholder: "Tell us about your experience... (optional)"
  - Background: `#F8FAFC`, rounded 14dp, max 200 characters
- **Skip Button**: Ghost text, `#475569`
- **Submit Button**: Filled blue `#2563EB`, Lucide `Star` icon, white label
  - Disabled until rating is selected (at least 1 star)
  - On submit: success Lottie animation → return to Dashboard

---

## Figma Structure Note

> For the corresponding Figma design file, organize the Runner screens under:
> ```
> ErrandGuy/
> └── Runner/
>     ├── Dashboard (Offline)
>     ├── Dashboard (Online + Negotiate Feed)
>     ├── Incoming Request — Fixed Price (Modal)
>     ├── Incoming Request — Transportation (Modal)
>     ├── Active Errand — Standard
>     ├── Active Errand — Transportation (PIN)
>     ├── Photo Proof Modal
>     ├── Completion & Signature Modal
>     ├── Chat with Customer
>     ├── Earnings
>     ├── Errand History
>     ├── Errand Detail
>     ├── Profile
>     ├── Documents & Verification
>     ├── Payout Settings & History
>     ├── Preferred Errand Types
>     ├── Working Areas
>     ├── Notification Center
>     └── Rate Customer (Modal)
> ```
> Use auto-layout frames, consistent spacing (8dp grid), and the color tokens from Section 3.2 of SPEC.md.
