# ErrandGuy — UI Structure: Admin Panel

**Scope:** Web dashboard for Admin & Super Admin roles  
**Platform:** Web (React + Tailwind CSS, hosted on Vercel)  
**Access:** Separate from mobile app — admin-only web portal

---

## Page Hierarchy

```
Admin Web Dashboard/
├── Auth/
│   ├── Login (Email + Password + 2FA)
│   └── 2FA Verification
├── Dashboard (Real-Time Overview)
├── Users/
│   ├── User List (Customers + Runners)
│   ├── User Detail Profile
│   └── Send Notification (Targeted)
├── Runner Verification/
│   ├── Pending Applications Queue
│   ├── Application Review Detail
│   └── Verification Metrics
├── Bookings/
│   ├── All Bookings List
│   ├── Booking Detail (Timeline, Chat, Payment)
│   └── Live Map View
├── Disputes/
│   ├── Dispute Queue
│   └── Dispute Detail & Resolution
├── Safety/
│   └── SOS Alerts Dashboard
├── Analytics/
│   ├── Overview (Revenue, Users, Bookings)
│   └── Heatmaps (Active Areas)
├── Configuration/
│   ├── Pricing Rules
│   ├── Promo Codes
│   ├── Service Areas (Geofences)
│   └── System Parameters
├── Content/
│   ├── FAQs Editor
│   ├── Terms & Privacy Editor
│   └── Announcements & Banners
└── Settings/
    ├── Admin Accounts & Roles
    └── Audit Log
```

---

## Global Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                        🔔 3   👤 Admin ▾ │
│  │ ErrandGuy│  Dashboard  Users  Bookings  Analytics  Config  ...      │
│  └──────────┘                                                          │
├──────────┬───────────────────────────────────────────────────────────────┤
│          │                                                              │
│  Sidebar │              Main Content Area                               │
│          │                                                              │
│  📊 Dash │              (page-specific content                          │
│  👥 Users│               loads here)                                    │
│  ✅ Verify│                                                             │
│  📋 Books│                                                              │
│  ⚠️ Disput│                                                             │
│  🚨 Safety│                                                             │
│  📈 Analyt│                                                             │
│  ⚙️ Config│                                                             │
│  📝 Conten│                                                             │
│  🔧 Settin│                                                             │
│          │                                                              │
│          │                                                              │
│          │                                                              │
│          │                                                              │
│          │                                                              │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Layout Breakdown

- **Top Navigation Bar**
  - Left: ErrandGuy logo (links to Dashboard)
  - Center: Breadcrumb trail (e.g., "Users > Juan Dela Cruz")
  - Right: Notification bell (Lucide `Bell`) with badge count + Admin avatar dropdown
  - Dropdown: Profile, Account Settings, Log Out
  - Background: white `#FFFFFF`, bottom border `#E2E8F0`
- **Sidebar** (left, fixed, collapsible)
  - Width: 240px expanded, 64px collapsed (icon-only)
  - Background: `#F8FAFC`
  - Active item: `#DBEAFE` background, `#2563EB` text + icon
  - Inactive item: `#475569` text + icon
  - Dividers between groups: `#E2E8F0`
  - Icons: Lucide — `LayoutDashboard`, `Users`, `ShieldCheck`, `ClipboardList`, `AlertTriangle`, `Siren`, `BarChart3`, `Settings`, `FileText`, `Wrench`
  - Collapse toggle at bottom: Lucide `ChevronsLeft` / `ChevronsRight`
- **Main Content Area**
  - Background: `#F8FAFC`
  - Padding: 24px
  - Max-width: 1440px, centered
  - Cards within: white `#FFFFFF`, border `#E2E8F0`, radius 14px

---

## 1. Login Screen

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                                                          │
│                                                                          │
│                    ┌──────────────────────────┐                          │
│                    │                          │                          │
│                    │      ErrandGuy Admin     │                          │
│                    │                          │                          │
│                    │  Email                   │                          │
│                    │  ┌──────────────────────┐│                          │
│                    │  │ admin@errandguy.com  ││                          │
│                    │  └──────────────────────┘│                          │
│                    │                          │                          │
│                    │  Password                │                          │
│                    │  ┌──────────────────────┐│                          │
│                    │  │ ••••••••••      👁️   ││                          │
│                    │  └──────────────────────┘│                          │
│                    │                          │                          │
│                    │  [Forgot Password?]      │                          │
│                    │                          │                          │
│                    │  ┌──────────────────────┐│                          │
│                    │  │      Sign In         ││                          │
│                    │  └──────────────────────┘│                          │
│                    │                          │                          │
│                    └──────────────────────────┘                          │
│                                                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Full Page Container**: centered card on `#F8FAFC` background, no sidebar/nav
- **Logo**: ErrandGuy wordmark + "Admin" label — centered, Montserrat Bold, 24px
- **Email Input**
  - Label: "Email" — 14px, `#475569`
  - Input: `#FFFFFF` background, border `#E2E8F0`, radius 10px
  - Placeholder: "admin@errandguy.com"
  - Validation: email format check
- **Password Input**
  - Label: "Password" — 14px, `#475569`
  - Input: same style, type password
  - Eye toggle: Lucide `Eye` / `EyeOff` to show/hide password
- **Forgot Password Link**: `#2563EB`, 14px — triggers password reset email flow
- **Sign In Button**: full width, `#2563EB` background, white label, radius 10px
  - Loading state: spinner replaces text
  - On success → navigates to 2FA Verification
- **Error State**: red `#EF4444` text below inputs for invalid credentials

---

## 2. Two-Factor Authentication (2FA)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                                                          │
│                    ┌──────────────────────────┐                          │
│                    │                          │                          │
│                    │   🔐 Two-Factor Auth     │                          │
│                    │                          │                          │
│                    │  Enter the 6-digit code  │                          │
│                    │  from your authenticator  │                          │
│                    │  app.                    │                          │
│                    │                          │                          │
│                    │  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐│                          │
│                    │  │  ││  ││  ││  ││  ││  ││                          │
│                    │  └──┘└──┘└──┘└──┘└──┘└──┘│                          │
│                    │                          │                          │
│                    │  ┌──────────────────────┐│                          │
│                    │  │      Verify           ││                          │
│                    │  └──────────────────────┘│                          │
│                    │                          │                          │
│                    │  [Use backup code]       │                          │
│                    │  [← Back to Login]       │                          │
│                    │                          │                          │
│                    └──────────────────────────┘                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Title**: Lucide `Lock` icon + "Two-Factor Auth" — Montserrat Bold, 20px
- **Subtitle**: "Enter the 6-digit code from your authenticator app." — 14px, `#475569`
- **OTP Input**: 6 individual digit boxes, auto-focus and auto-advance
  - Each box: 48px × 48px, `#E2E8F0` border, `#0F172A` text, 20px font
  - Active box: `#2563EB` border
  - Error: all boxes turn `#EF4444` border + shake animation
- **Verify Button**: full width, `#2563EB`, white label
  - Auto-submits when 6th digit is entered
- **Backup Code Link**: "Use backup code" — `#2563EB`, 14px
  - Opens text input for 8-character backup code
- **Back to Login Link**: `#475569`, 14px — returns to login screen

---

## 3. Dashboard (Real-Time Overview)

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Dashboard                              🔔 3   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 📊 Dash● │  ── Overview Cards ──────────────────────────────────────── │
│ 👥 Users │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ ✅ Verify │  │ 📋 142    │ │ ₱ 28,500 │ │ 👥 1,248  │ │ 🏃 87    │       │
│ 📋 Books │  │ Today's   │ │ Today's  │ │ Total    │ │ Online   │       │
│ ⚠️ Disput │  │ Bookings  │ │ Revenue  │ │ Users    │ │ Runners  │       │
│ 🚨 Safety │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│ 📈 Analyt │                                                             │
│ ⚙️ Config │  ── Live Map ───────────────────────────────────────────── │
│ 📝 Conten │  ┌──────────────────────────────────────────────────────┐  │
│ 🔧 Settin │  │                                                      │  │
│          │  │                    MAP VIEW                           │  │
│          │  │                                                      │  │
│          │  │    🟢 Runner (online)    🔵 Active errand            │  │
│          │  │    🟡 Runner (busy)      📍 Pickup/Dropoff           │  │
│          │  │                                                      │  │
│          │  │    Filters: [All] [Active] [Online Runners]          │  │
│          │  │                                                      │  │
│          │  └──────────────────────────────────────────────────────┘  │
│          │                                                              │
│          │  ── Recent Activity ──────── ── System Health ──────────── │
│          │  ┌──────────────────────┐    ┌───────────────────────────┐ │
│          │  │ 2:45 PM Booking #412 │    │ API Response    42ms ✅   │ │
│          │  │ Juan D. → Delivery   │    │ DB Connections  18/100 ✅ │ │
│          │  │                      │    │ WebSocket       Active ✅ │ │
│          │  │ 2:40 PM Runner #89   │    │ Storage         62% ✅   │ │
│          │  │ Mark D. went online  │    │ Push Service    Active ✅ │ │
│          │  │                      │    │                           │ │
│          │  │ 2:38 PM Dispute #22  │    │ Uptime: 99.97%           │ │
│          │  │ Filed by Maria S.    │    │                           │ │
│          │  │                      │    │                           │ │
│          │  │ [View All →]         │    │                           │ │
│          │  └──────────────────────┘    └───────────────────────────┘ │
│          │                                                              │
│          │  ── Pending Actions ─────────────────────────────────────  │
│          │  ┌──────────────────────────────────────────────────────┐  │
│          │  │ 🔴 5 Runner verifications pending                    │  │
│          │  │ 🔴 3 Disputes awaiting resolution                    │  │
│          │  │ 🟡 2 SOS alerts flagged for review                   │  │
│          │  └──────────────────────────────────────────────────────┘  │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Page Title**: "Dashboard" — Montserrat Bold, 24px, `#0F172A`
- **Overview Cards** (4-column grid)
  - Each card: white `#FFFFFF`, border `#E2E8F0`, radius 14px, padding 20px
  - Icon: Lucide icons in `#2563EB` — `ClipboardList`, `Banknote`, `Users`, `UserCheck`
  - Value: Montserrat Bold, 30px, `#0F172A`
  - Label: 14px, `#475569`
  - Trend indicator: small arrow + percentage vs yesterday (green up / red down)
  - Auto-refresh: values update every 30 seconds via WebSocket
- **Live Map** (Mapbox web embed)
  - Shows all active errands and online runners in real-time
  - Markers: green dots (online runners), blue dots (active errands), yellow dots (busy runners)
  - Filter bar above map: toggle visibility of marker types
  - Click marker → popover with runner/booking details
  - Zoom controls + full-screen toggle
- **Recent Activity Feed** (left column, bottom)
  - Live-updating list of platform events
  - Each entry: timestamp, event type icon, description, link
  - Types: new bookings, runner status changes, disputes, payments, SOS alerts
  - "View All →" link to full activity log
  - Max 10 visible, auto-scrolls on new entries
- **System Health Panel** (right column, bottom)
  - Key infrastructure metrics
  - Each row: label, value, status indicator (✅ green / ⚠️ yellow / 🔴 red)
  - Metrics: API response time, DB connections, WebSocket status, storage usage, push service
  - Uptime percentage at bottom
- **Pending Actions Banner**
  - Red badge `#EF4444` for urgent items (verifications, disputes)
  - Yellow badge for warnings (SOS reviews)
  - Each item is clickable → navigates to relevant queue
  - Auto-hides when no pending actions

---

## 4. User List (Customers + Runners)

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Users                                   🔔   👤 Admin ▾    │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 📊 Dash  │  ── Search & Filters ──────────────────────────────────── │
│ 👥 Users●│  ┌──────────────────────────────────────┐                   │
│ ✅ Verify │  │ 🔍 Search by name, email, phone...   │                   │
│ 📋 Books │  └──────────────────────────────────────┘                   │
│ ...      │  ┌──────┐ ┌────────┐ ┌────────┐ ┌──────────┐              │
│          │  │All   │ │Customer│ │Runner  │ │Status ▾  │              │
│          │  └──────┘ └────────┘ └────────┘ └──────────┘              │
│          │                                                              │
│          │  ── User Table ──────────────────────────────────────────  │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  □  Name           Role      Status   Rating  Joined  │ │
│          │  │  ─────────────────────────────────────────────────── │ │
│          │  │  □  Juan Dela Cruz Customer  Active   4.7 ★  Jan 15  │ │
│          │  │  □  Maria Santos   Customer  Active   4.9 ★  Feb 02  │ │
│          │  │  □  Mark Reyes     Runner    Active   4.8 ★  Jan 20  │ │
│          │  │  □  Ana Lopez      Runner    Suspended 3.2 ★ Mar 01  │ │
│          │  │  □  Carlo Mendoza  Customer  Active   5.0 ★  Mar 10  │ │
│          │  │  □  Sofia Garcia   Runner    Pending  —      Mar 22  │ │
│          │  │                                                        │ │
│          │  │  Showing 1–20 of 1,248       [← Prev]  1 2 3 [Next →]│ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Bulk Actions ──────────────────────────────────────── │
│          │  [Send Notification]  [Export CSV]                          │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Search Bar**: Lucide `Search` icon + text input, full width
  - Searches across name, email, phone number
  - Debounced search (300ms delay)
- **Filter Chips**: horizontal row
  - Role: All / Customer / Runner
  - Status dropdown: Active, Suspended, Banned, Pending, Deleted
  - Active filter: `#2563EB` fill, white text; inactive: `#F8FAFC`, `#475569` text
- **Data Table**
  - Columns: checkbox, Name (with avatar), Role, Status, Rating, Joined date
  - Sortable columns (click header to sort, Lucide `ArrowUpDown`)
  - Status badges:
    - Active: `#DBEAFE` bg, `#2563EB` text
    - Suspended: `#FEE2E2` bg, `#EF4444` text
    - Banned: `#EF4444` bg, white text
    - Pending: `#F8FAFC` bg, `#475569` text
  - Row hover: `#F8FAFC` background
  - Row click → navigates to User Detail
  - Checkbox for bulk selection
- **Pagination**: "Showing X–Y of Z" + page numbers + Prev/Next buttons
- **Bulk Actions** (visible when users selected)
  - "Send Notification": opens targeted notification composer
  - "Export CSV": downloads selected users as CSV

---

## 5. User Detail Profile

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  [← Users]    Juan Dela Cruz              🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  ┌──────┐                                              │ │
│          │  │  │  👤  │  Juan Dela Cruz                              │ │
│          │  │  │      │  Customer • Active                           │ │
│          │  │  └──────┘  ✉ juan@email.com • 📱 +63 917 123 4567     │ │
│          │  │            Joined: Jan 15, 2026 • Rating: ★ 4.7        │ │
│          │  │                                                        │ │
│          │  │  [Suspend] [Ban] [Reset Password] [Send Notification]  │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Tabs ─────────────────────────────────────────────── │
│          │  [ Bookings ]  [ Transactions ]  [ Ratings ]  [ Activity ] │
│          │                                                              │
│          │  ── Booking History ─────────────────────────────────────  │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  ID      Type        Date       Amount  Status         │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  #412   Delivery    Mar 24     ₱120   Completed       │ │
│          │  │  #398   Purchase    Mar 23     ₱250   Completed       │ │
│          │  │  #385   Transport   Mar 21     ₱185   Completed       │ │
│          │  │  #370   Delivery    Mar 19     ₱95    Cancelled       │ │
│          │  │                                                        │ │
│          │  │  Showing 1–10 of 34          [← Prev]  1 2 [Next →]  │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **User Header Card**
  - Large avatar (64px) with fallback initials
  - Name: Montserrat Bold, 24px, `#0F172A`
  - Role + Status badges (styled same as user list)
  - Contact info: email + phone — Lucide `Mail`, `Phone` icons
  - Join date + average rating
- **Action Buttons** (in header card)
  - **Suspend**: outline button, `#EF4444` border/text — opens confirmation modal with reason input
  - **Ban**: filled `#EF4444` button, white text — opens confirmation modal with reason (irreversible warning)
  - **Reset Password**: outline `#475569` — sends password reset email
  - **Send Notification**: outline `#2563EB` — opens notification composer
  - For suspended users: shows **"Reactivate"** button instead of Suspend
- **Tab Navigation**
  - Tabs: Bookings, Transactions, Ratings, Activity
  - Active tab: `#2563EB` text, blue underline bar (2px)
  - Inactive: `#475569`, no underline
- **Booking History Tab** (default)
  - Data table: ID, Type, Date, Amount, Status
  - Click row → opens Booking Detail in a side panel or new page
- **Transactions Tab**: wallet top-ups, payments, refunds with amounts and dates
- **Ratings Tab**: all ratings given/received, star display, reviewer name, comments
- **Activity Tab**: login history, account changes, support tickets

---

## 6. Suspend / Ban Confirmation Modal

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░                                                                        ░░
░░          ╔══════════════════════════════════════╗                       ░░
░░          ║                                      ║                       ░░
░░          ║   ⚠️  Suspend User                    ║                       ░░
░░          ║                                      ║                       ░░
░░          ║   You are about to suspend            ║                       ░░
░░          ║   Juan Dela Cruz (Customer).          ║                       ░░
░░          ║                                      ║                       ░░
░░          ║   Reason (required):                 ║                       ░░
░░          ║   ┌────────────────────────────────┐ ║                       ░░
░░          ║   │ Select reason...           ▾   │ ║                       ░░
░░          ║   └────────────────────────────────┘ ║                       ░░
░░          ║                                      ║                       ░░
░░          ║   Additional notes:                  ║                       ░░
░░          ║   ┌────────────────────────────────┐ ║                       ░░
░░          ║   │                                │ ║                       ░░
░░          ║   │                                │ ║                       ░░
░░          ║   └────────────────────────────────┘ ║                       ░░
░░          ║                                      ║                       ░░
░░          ║   [Cancel]       [Confirm Suspend]   ║                       ░░
░░          ║                                      ║                       ░░
░░          ╚══════════════════════════════════════╝                       ░░
░░                                                                        ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

### Component Breakdown

- **Backdrop**: `rgba(15,23,42,0.45)`
- **Modal Card**: white `#FFFFFF`, radius 14px, max-width 480px, centered
- **Title**: Lucide `AlertTriangle` icon + "Suspend User" — Montserrat Bold, 18px
  - For Ban: icon `ShieldAlert` + "Ban User" title, red `#EF4444` accent
- **User identification**: name + role displayed for verification
- **Reason Dropdown** (required):
  - Options: "Policy violation", "Fraudulent activity", "Inappropriate behavior", "Spam/abuse", "Other"
  - Must select one before submit is enabled
- **Additional Notes Textarea**: optional, placeholder "Add any additional context..."
- **Cancel Button**: ghost, `#475569`
- **Confirm Suspend**: filled `#EF4444`, white text — disabled until reason selected
  - For Ban: "Confirm Ban" with extra warning text "This action is difficult to reverse."

---

## 7. Runner Verification — Pending Queue

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Runner Verification                    🔔   👤 Admin ▾    │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 📊 Dash  │  ── Verification Metrics ──────────────────────────────── │
│ 👥 Users │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ ✅ Vrfy● │  │ 🔴 5      │ │ ⏱️ 4.2 hr │ │ ✅ 92%    │ │ ❌ 8%    │       │
│ 📋 Books │  │ Pending   │ │ Avg Time │ │ Approval │ │ Rejection│       │
│ ...      │  │ Reviews   │ │ to Review│ │ Rate     │ │ Rate     │       │
│          │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│          │                                                              │
│          │  ── Pending Applications ───────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Name              Submitted     Vehicle  Status       │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  Sofia Garcia      2 hours ago   Motor.   Pending     │ │
│          │  │  Roberto Cruz      5 hours ago   Car      Pending     │ │
│          │  │  Elena Villanueva  8 hours ago   Bicycle  Pending     │ │
│          │  │  James Tan         1 day ago     Motor.   Re-submit   │ │
│          │  │  Andrea Reyes      1 day ago     Walk     Pending     │ │
│          │  │                                                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Recently Reviewed ──────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Mark Reyes        Mar 23        Motor.   ✅ Approved  │ │
│          │  │  Lisa Santos       Mar 22        Car      ❌ Rejected  │ │
│          │  │  Paulo Bautista    Mar 22        Bicycle  ✅ Approved  │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Verification Metrics** (4-column grid)
  - Pending Reviews: count with red `#EF4444` badge if > 0
  - Avg Time to Review: hours/days
  - Approval Rate: percentage
  - Rejection Rate: percentage
  - Same card style as Dashboard overview cards
- **Pending Applications Table**
  - Columns: Name (with small avatar), Submitted (relative time), Vehicle type, Status
  - Status badges: Pending (`#DBEAFE`), Re-submit (`#FEF3C7` amber bg, `#92400E` text)
  - Sorted by oldest first (FIFO queue)
  - Row click → opens Application Review Detail
  - Unreviewed rows have subtle left blue dot indicator (unread style)
- **Recently Reviewed Section**
  - Last 10 reviewed applications
  - Status: Approved (green `#22C55E`) / Rejected (red `#EF4444`)
  - Click → opens review detail (read-only)

---

## 8. Application Review Detail

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  [← Verification]  Sofia Garcia          🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Personal Information ──────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Full Name:     Sofia Garcia                           │ │
│          │  │  Date of Birth: April 12, 1995                         │ │
│          │  │  Phone:         +63 917 555 8888                       │ │
│          │  │  Email:         sofia.garcia@email.com                  │ │
│          │  │  Address:       123 Rizal St, Makati City               │ │
│          │  │  Submitted:     Mar 24, 2026 — 10:30 AM                │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Government ID ────────────── ── Selfie with ID ──── │
│          │  ┌──────────────┐┌──────────────┐ ┌──────────────────┐    │
│          │  │              ││              │ │                  │    │
│          │  │  ID Front    ││  ID Back     │ │  Selfie Photo    │    │
│          │  │              ││              │ │                  │    │
│          │  │  [🔍 Zoom]   ││  [🔍 Zoom]   │ │  [🔍 Zoom]       │    │
│          │  └──────────────┘└──────────────┘ └──────────────────┘    │
│          │                                                              │
│          │  ── Vehicle Information ────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Vehicle Type:  Motorcycle                             │ │
│          │  │  Plate Number:  ABC-1234                                │ │
│          │  │  ┌──────────────┐                                      │ │
│          │  │  │ Vehicle Photo│                                      │ │
│          │  │  │  [🔍 Zoom]   │                                      │ │
│          │  │  └──────────────┘                                      │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Admin Notes ──────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Add notes about this application...                   │ │
│          │  │                                                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ┌────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│          │  │  ❌ Reject  │  │ 🔄 Request Resubm │  │  ✅ Approve    │ │
│          │  └────────────┘  └──────────────────┘  └────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Personal Information Card**: read-only data grid, labels in `#475569`, values in `#0F172A`
- **Document Images** (side by side)
  - Thumbnail previews: 200px × 140px, rounded 10px, border `#E2E8F0`
  - Zoom button: Lucide `ZoomIn` — opens full-screen lightbox overlay
  - Lightbox: black backdrop, high-res image, zoom/pan controls, close button
- **Vehicle Information Card**: type, plate number, vehicle photo — same image style
- **Admin Notes Textarea**
  - Placeholder: "Add notes about this application..."
  - Persists across review sessions
  - Optional but recommended
- **Action Buttons** (bottom, equal width row)
  - **Reject**: filled `#EF4444`, white text, Lucide `X` icon
    - Opens rejection reason modal (required reason dropdown + notes)
    - Sends notification to runner with rejection reason
  - **Request Resubmission**: outline `#2563EB`, Lucide `RefreshCw` icon
    - Opens modal to specify which documents need re-submission
    - Sets runner status to "Re-submit"
  - **Approve**: filled `#22C55E` (success green), white text, Lucide `Check` icon
    - Confirmation prompt: "Approve Sofia Garcia as a verified runner?"
    - On confirm: status → Approved, runner can go online

---

## 9. All Bookings List

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Bookings                                🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 📊 Dash  │  ── Filters ─────────────────────────────────────────────  │
│ 👥 Users │  ┌──────────────────────────────────────┐                   │
│ ✅ Verify │  │ 🔍 Search by booking ID, name...     │                   │
│ 📋 Bks● │  └──────────────────────────────────────┘                   │
│ ...      │  ┌──────┐┌────────┐┌──────┐┌────────┐┌────────────────┐   │
│          │  │All   ││Type ▾  ││Status││Runner ▾││  📅 Date Range │   │
│          │  └──────┘└────────┘└──────┘└────────┘└────────────────┘   │
│          │                                                              │
│          │  ── Bookings Table ──────────────────────────────────────  │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ ID     Type       Customer    Runner     Amt    Status│ │
│          │  │ ─────────────────────────────────────────────────────│ │
│          │  │ #412  Delivery   Juan D.     Mark R.   ₱120  Active  │ │
│          │  │ #411  Purchase   Maria S.    Ana L.    ₱250  Compl.  │ │
│          │  │ #410  Transport  Carlos R.   Mark R.   ₱185  Compl.  │ │
│          │  │ #409  Delivery   Sofia G.    —         ₱95   Cancel  │ │
│          │  │ #408  Bills Pay  Elena V.    James T.  ₱65   Compl.  │ │
│          │  │ #407  Custom     Andrea R.   Paulo B.  ₱200  Dispute │ │
│          │  │                                                        │ │
│          │  │ Showing 1–20 of 4,721      [← Prev]  1 2 3 [Next →] │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Search Bar**: searches by booking ID, customer name, runner name
- **Filter Row**
  - Type dropdown: All, Delivery, Purchase, Bills, Queue, Documents, Transportation, Custom
  - Status filter: All, Active, Completed, Cancelled, Disputed
  - Runner dropdown: searchable runner name filter
  - Date Range: calendar picker (start date – end date)
- **Bookings Data Table**
  - Columns: Booking ID, Type (with icon), Customer name, Runner name (or "—" if unmatched), Amount, Status
  - Status badges:
    - Active: `#2563EB` text on `#DBEAFE`
    - Completed: `#22C55E` text on `#F0FDF4`
    - Cancelled: `#475569` text on `#F8FAFC`
    - Disputed: `#EF4444` text on `#FEE2E2`
  - Sortable by all columns
  - Row click → opens Booking Detail
- **Pagination**: standard page controls

---

## 10. Booking Detail

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  [← Bookings]   Booking #412             🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Booking Overview ────────────── ── Map ───────────── │
│          │  ┌──────────────────────────┐       ┌────────────────────┐ │
│          │  │  📦 Delivery             │       │                    │ │
│          │  │  Status: ✅ Completed     │       │     MAP VIEW       │ │
│          │  │  Date: Mar 24, 2:00 PM   │       │                    │ │
│          │  │                          │       │  ◉ Pickup          │ │
│          │  │  Customer: Juan D.       │       │  ╌╌╌ (route) ╌╌╌  │ │
│          │  │  Runner: Mark R.         │       │  ◉ Drop-off        │ │
│          │  │                          │       │                    │ │
│          │  │  From: 123 Main St       │       │                    │ │
│          │  │  To:   SM City Mall      │       └────────────────────┘ │
│          │  │  Distance: 5.2 km        │                              │
│          │  │                          │                              │
│          │  │  Pricing: Fixed          │                              │
│          │  │  Vehicle: Motorcycle     │                              │
│          │  └──────────────────────────┘                              │
│          │                                                              │
│          │  ── Tabs ─────────────────────────────────────────────────  │
│          │  [ Timeline ]  [ Chat Log ]  [ Payment ]  [ Rating ]       │
│          │                                                              │
│          │  ── Status Timeline ──────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  ✅  Accepted               2:30 PM                    │ │
│          │  │  ✅  En Route to Pickup     2:31 PM                    │ │
│          │  │  ✅  At Pickup              2:40 PM                    │ │
│          │  │  ✅  Picked Up              2:42 PM  📷               │ │
│          │  │  ✅  In Transit             2:42 PM                    │ │
│          │  │  ✅  Arrived                2:55 PM                    │ │
│          │  │  ✅  Completed              2:56 PM  📷               │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Admin Actions ────────────────────────────────────── │
│          │  [Issue Refund]  [Open Dispute]  [Contact Customer]       │
│          │  [Contact Runner]  [Flag Booking]                          │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Booking Overview Card** (left column)
  - Errand type icon + label
  - Status badge
  - Date/time
  - Customer and runner names (clickable → link to their User Detail)
  - Pickup/drop-off addresses
  - Distance, pricing mode, vehicle type
- **Map View** (right column, 300px height)
  - Shows route between pickup and drop-off
  - Markers: pickup pin + drop-off pin + runner's final path
  - Static map (no live tracking for completed bookings)
- **Tab Navigation**
  - **Timeline tab**: full status timeline with timestamps
    - 📷 camera icon next to steps with photo proof — click to view images
  - **Chat Log tab**: complete chat history between customer and runner
    - Read-only, timestamped messages with sender labels
    - Image messages shown inline
  - **Payment tab**: full payment breakdown
    - Base fee, distance fee, service fee, promo discount, total
    - Payment method used, transaction ID, payment status
    - Refund history if any
  - **Rating tab**: ratings from both sides
    - Customer → Runner: stars + comment
    - Runner → Customer: stars + comment
- **Admin Actions**
  - **Issue Refund**: opens refund modal (full/partial amount input, reason)
  - **Open Dispute**: creates a dispute ticket linked to this booking
  - **Contact Customer / Runner**: opens email composer pre-filled with booking context
  - **Flag Booking**: marks booking for further review with tags

---

## 11. Dispute Queue

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Disputes                                🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ ⚠️ Dspt● │  ── Summary ─────────────────────────────────────────────  │
│          │  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│          │  │ 🔴 3      │ │ 🟡 2      │ │ ✅ 128    │                     │
│          │  │ Open     │ │ In Review│ │ Resolved │                     │
│          │  └──────────┘ └──────────┘ └──────────┘                     │
│          │                                                              │
│          │  ── Filters ──────────────────────────────────────────────  │
│          │  ┌──────┐ ┌──────────┐ ┌────────────────────┐              │
│          │  │Open  │ │In Review │ │ Resolved           │              │
│          │  └──────┘ └──────────┘ └────────────────────┘              │
│          │                                                              │
│          │  ── Open Disputes ────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ #22  Booking #407   Andrea Reyes → Paulo Bautista     │ │
│          │  │     "Item arrived damaged"                             │ │
│          │  │     Filed: Mar 24, 1:30 PM        Priority: High      │ │
│          │  │ ──────────────────────────────────────────────────── │ │
│          │  │ #21  Booking #395   Maria Santos → Mark Reyes         │ │
│          │  │     "Runner was rude and unprofessional"               │ │
│          │  │     Filed: Mar 23, 5:00 PM        Priority: Medium    │ │
│          │  │ ──────────────────────────────────────────────────── │ │
│          │  │ #20  Booking #389   Carlos Ramos → Ana Lopez          │ │
│          │  │     "Overcharged, price doesn't match quote"           │ │
│          │  │     Filed: Mar 23, 11:00 AM       Priority: Medium    │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Summary Cards** (3 columns)
  - Open: red badge count, Lucide `AlertCircle`
  - In Review: yellow/amber badge, Lucide `Clock`
  - Resolved: green count, Lucide `CheckCircle`
- **Status Filter Tabs**: Open / In Review / Resolved
  - Active tab: `#2563EB` background, white text
  - Inactive: `#F8FAFC`, `#475569` text
- **Dispute Cards**
  - Dispute ID + linked booking ID (clickable → Booking Detail)
  - Names: Customer → Runner (both clickable → User Detail)
  - Complaint preview: first line of complaint text, 14px `#0F172A`
  - Filed date + relative time
  - Priority badge: High (`#EF4444`), Medium (`#2563EB`), Low (`#475569`)
  - Card click → opens Dispute Detail

---

## 12. Dispute Detail & Resolution

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  [← Disputes]  Dispute #22               🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Dispute Info ──────────────── ── Booking Context ──  │
│          │  ┌──────────────────────────────┐ ┌──────────────────────┐ │
│          │  │  Status: 🔴 Open              │ │ Booking #407         │ │
│          │  │  Filed by: Andrea Reyes       │ │ Custom Errand        │ │
│          │  │  Against: Paulo Bautista      │ │ Mar 24, 10:00 AM     │ │
│          │  │  Filed: Mar 24, 1:30 PM       │ │ Amount: ₱200         │ │
│          │  │  Priority: High               │ │ [View Full Detail →] │ │
│          │  └──────────────────────────────┘ └──────────────────────┘ │
│          │                                                              │
│          │  ── Complaint ────────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  "The item I asked the runner to purchase arrived      │ │
│          │  │   damaged. The box was crushed and the item inside     │ │
│          │  │   was broken. I paid ₱200 for this errand and the     │ │
│          │  │   item cost ₱1,500."                                   │ │
│          │  │                                                        │ │
│          │  │  Attachments:                                          │ │
│          │  │  📷 photo1.jpg   📷 photo2.jpg                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Evidence (Booking Data) ─────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Chat Log: [View Chat →]                               │ │
│          │  │  Proof Photos: 📷 Pickup  📷 Delivery                 │ │
│          │  │  Runner Rating (by customer): ★ 1.0                    │ │
│          │  │  Payment: ₱200 via GCash — Completed                   │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Resolution ───────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Action:                                               │ │
│          │  │  ┌──────────────────────────────────────┐              │ │
│          │  │  │ Select action...                  ▾  │              │ │
│          │  │  └──────────────────────────────────────┘              │ │
│          │  │                                                        │ │
│          │  │  Refund Amount:                                        │ │
│          │  │  ┌───────────┐  of ₱200 total                         │ │
│          │  │  │ ₱ 200.00  │  [Full] [Partial]                      │ │
│          │  │  └───────────┘                                         │ │
│          │  │                                                        │ │
│          │  │  Resolution Notes:                                     │ │
│          │  │  ┌──────────────────────────────────────┐              │ │
│          │  │  │  Describe the resolution...          │              │ │
│          │  │  │                                      │              │ │
│          │  │  └──────────────────────────────────────┘              │ │
│          │  │                                                        │ │
│          │  │  [Save as Draft]         [Resolve Dispute ✓]           │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Dispute Info Card** (left)
  - Status badge, filer + accused names (clickable → User Detail)
  - Filed timestamp, priority level
- **Booking Context Card** (right)
  - Linked booking summary + "View Full Detail →" link
- **Complaint Section**
  - Full complaint text in a card
  - Attachment thumbnails: click to view in lightbox
- **Evidence Section**
  - Links to chat log, proof photos from the booking
  - Runner's rating from the customer
  - Payment info
- **Resolution Section**
  - **Action Dropdown** (required):
    - "Issue full refund" / "Issue partial refund" / "Warn runner" / "Suspend runner" / "No action (dismiss)" / "Escalate"
  - **Refund Amount**: input field
    - Quick buttons: "Full" (fills total), "Partial" (custom amount)
    - Max = booking total, validation against amount
  - **Resolution Notes**: required textarea
  - **Save as Draft**: outline `#475569` — saves progress without resolving
  - **Resolve Dispute**: filled `#2563EB`, white text — requires action + notes
    - Triggers notification to both customer and runner with outcome
    - Status changes to "Resolved"

---

## 13. SOS Alerts Dashboard

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  🚨 SOS Alerts                           🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 🚨 Safe●│  ── Active SOS Alerts ─────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ 🔴 ACTIVE — Booking #415  Transportation              │ │
│          │  │ Customer: Maria Santos    Runner: Roberto Cruz         │ │
│          │  │ Triggered: 2 min ago      Vehicle: Motorcycle ABC-123 │ │
│          │  │                                                        │ │
│          │  │ ┌──────────────────────────────────────────────┐       │ │
│          │  │ │              LIVE MAP                         │       │ │
│          │  │ │     🔴 Customer + Runner (live position)     │       │ │
│          │  │ │     ╌╌╌╌ expected route ╌╌╌╌                │       │ │
│          │  │ │     ◉ Pickup    ◉ Destination                │       │ │
│          │  │ └──────────────────────────────────────────────┘       │ │
│          │  │                                                        │ │
│          │  │ [📞 Call Customer]  [📞 Call Runner]  [📋 Details]     │ │
│          │  │ [🚔 Escalate to Authorities]  [✅ Mark Resolved]       │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Recent SOS History ──────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ Booking #410  Mar 23, 4:30 PM  Resolved — false alarm │ │
│          │  │ Booking #402  Mar 21, 8:15 PM  Escalated to authoritie│ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Active SOS Alert Cards** (priority — top of page)
  - Red pulsing indicator: `#EF4444` dot, animation pulse
  - Booking ID + errand type
  - Customer name, runner name (both clickable → User Detail)
  - Trigger time (relative) + vehicle details (plate number)
  - **Live Map**: embedded Mapbox showing real-time GPS of customer + runner
    - Expected route overlay
    - Deviation highlighted if route diverged
    - Auto-updates every 5 seconds
  - **Action Buttons**:
    - Call Customer: initiates phone call or VoIP link
    - Call Runner: same
    - Details: opens full Booking Detail in side panel
    - Escalate to Authorities: logs escalation, opens local emergency contact info
    - Mark Resolved: closes SOS alert with resolution notes
  - Card background: `#FEE2E2` (light red tint) for active alerts
- **SOS History**
  - Past SOS alerts with outcome
  - Status: Resolved (with reason), Escalated, False alarm
  - Click → opens historical detail view

---

## 14. Analytics — Overview

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Analytics                               🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 📈 Anlt●│  ── Period Selector ───────────────────────────────────── │
│          │  ┌────────┐┌────────┐┌────────┐┌────────┐ 📅 Custom Range  │
│          │  │ Today  ││ Week   ││ Month ●││ Year   │                  │
│          │  └────────┘└────────┘└────────┘└────────┘                  │
│          │                                                              │
│          │  ── Key Metrics ──────────────────────────────────────── │
│          │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│          │  │₱ 285,000 │ │  3,420   │ │  1,248   │ │   248    │       │
│          │  │ Revenue  │ │ Bookings │ │Customers │ │ Runners  │       │
│          │  │ ↑ 12%    │ │ ↑ 8%     │ │ ↑ 15%    │ │ ↑ 5%     │       │
│          │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│          │                                                              │
│          │  ── Revenue Chart ────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  ₱                                                     │ │
│          │  │  │                            ╱─╲                      │ │
│          │  │  │                     ╱─────╱   ╲                     │ │
│          │  │  │              ╱─────╱                                │ │
│          │  │  │       ╱─────╱                                       │ │
│          │  │  │──────╱                                              │ │
│          │  │  └──────────────────────────────────────────────        │ │
│          │  │    Mar 1    Mar 8    Mar 15    Mar 22                   │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Bookings by Type ──────── ── Bookings by Status ──  │
│          │  ┌──────────────────────────┐ ┌──────────────────────────┐ │
│          │  │     (Donut Chart)        │ │     (Donut Chart)        │ │
│          │  │                          │ │                          │ │
│          │  │  📦 Delivery     42%     │ │  ✅ Completed    89%     │ │
│          │  │  🛒 Purchase     18%     │ │  ❌ Cancelled     7%     │ │
│          │  │  🚗 Transport    15%     │ │  ⚠️ Disputed      4%     │ │
│          │  │  💰 Bills        10%     │ │                          │ │
│          │  │  📄 Docs          8%     │ │                          │ │
│          │  │  ⏳ Queue         4%     │ │                          │ │
│          │  │  ⚙️ Custom        3%     │ │                          │ │
│          │  └──────────────────────────┘ └──────────────────────────┘ │
│          │                                                              │
│          │  ── Top Runners ──────────── ── New User Growth ──────  │
│          │  ┌──────────────────────────┐ ┌──────────────────────────┐ │
│          │  │ 1. Mark Reyes   ★4.9     │ │     (Bar Chart)          │ │
│          │  │    87 errands  ₱12,400   │ │                          │ │
│          │  │ 2. Ana Lopez    ★4.8     │ │  █ Customers             │ │
│          │  │    72 errands  ₱10,800   │ │  █ Runners               │ │
│          │  │ 3. James Tan    ★4.7     │ │                          │ │
│          │  │    65 errands  ₱9,200    │ │  Mar 1  Mar 8  Mar 15    │ │
│          │  └──────────────────────────┘ └──────────────────────────┘ │
│          │                                                              │
│          │  [📥 Export Report (CSV)]  [📥 Export Report (PDF)]        │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Period Selector**: segmented control (Today / Week / Month / Year) + calendar icon for custom range
  - Active: `#2563EB` background, white text
  - Custom Range: opens date picker modal with start/end dates
- **Key Metrics Cards** (4-column grid)
  - Same style as Dashboard overview cards
  - Trend indicator: ↑ green `#22C55E` for positive, ↓ red `#EF4444` for negative
  - Percentage comparison vs previous period
- **Revenue Line Chart**
  - Blue line `#2563EB`, filled area below at 10% opacity
  - X-axis: date labels; Y-axis: revenue in ₱
  - Hover/tap on points → tooltip with exact value
  - Responsive, resizes with container
- **Bookings by Type** (donut chart, left)
  - Blue shades for segments (different blue tints per type)
  - Legend with errand type icons + labels + percentages
  - Center: total bookings count
- **Bookings by Status** (donut chart, right)
  - Completed: `#22C55E`, Cancelled: `#475569`, Disputed: `#EF4444`
- **Top Runners Leaderboard**
  - Ranked list: name, rating, errand count, total earnings
  - Avatar thumbnails
  - Click → User Detail
- **New User Growth** (stacked bar chart)
  - Customers bar: `#2563EB`, Runners bar: `#93C5FD`
  - Weekly or monthly bars depending on period
- **Export Buttons**: outline `#2563EB`, Lucide `Download` icon
  - CSV: raw data export
  - PDF: formatted report with charts

---

## 15. Analytics — Heatmaps

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Analytics > Heatmaps                    🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Filters ──────────────────────────────────────────────  │
│          │  ┌────────────────┐ ┌──────────┐ ┌────────────────────────┐│
│          │  │ Booking Density│ │ All Types│ │  📅 This Month        ││
│          │  └────────────────┘ └──────────┘ └────────────────────────┘│
│          │                                                              │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │                                                        │ │
│          │  │                                                        │ │
│          │  │                  HEATMAP VIEW                          │ │
│          │  │                 (Full-width Map)                       │ │
│          │  │                                                        │ │
│          │  │    🔴 High density   🟡 Medium   🔵 Low               │ │
│          │  │                                                        │ │
│          │  │                                                        │ │
│          │  │                                                        │ │
│          │  │                                                        │ │
│          │  │                                                        │ │
│          │  │                                                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Hot Zones ────────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ 1. Makati CBD          1,240 bookings    ₱148,000     │ │
│          │  │ 2. BGC, Taguig          890 bookings    ₱106,000     │ │
│          │  │ 3. Ortigas Center       650 bookings    ₱ 78,000     │ │
│          │  │ 4. Quezon City Circle   480 bookings    ₱ 57,600     │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Filter Bar**
  - Heatmap type: Booking Density / Runner Availability / Revenue
  - Errand type: All or specific type
  - Date range: preset periods + custom
- **Heatmap** (Mapbox web with heatmap layer)
  - Full-width, ~60% of viewport height
  - Color gradient: blue (low) → yellow (medium) → red (high)
  - Zoom-responsive: clusters aggregate at zoom-out, granular at zoom-in
  - Click on area → popover with zone stats (bookings, revenue, active runners)
- **Hot Zones Table**
  - Ranked list of highest-activity areas
  - Columns: rank, zone name, booking count, total revenue
  - Click → zooms map to that area

---

## 16. Configuration — Pricing Rules

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Configuration > Pricing Rules           🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ ⚙️ Conf● │  ── Base Fees by Errand Type ─────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Errand Type          Base Fee                         │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  📦 Delivery          ₱ [  40.00  ]                   │ │
│          │  │  🛒 Purchase          ₱ [  50.00  ]                   │ │
│          │  │  💰 Bills Payment     ₱ [  35.00  ]                   │ │
│          │  │  ⏳ Queue             ₱ [  45.00  ]                   │ │
│          │  │  📄 Documents         ₱ [  40.00  ]                   │ │
│          │  │  🚗 Transportation    ₱ [  50.00  ]                   │ │
│          │  │  ⚙️ Custom            ₱ [  40.00  ]                   │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Per-Kilometer Rates by Vehicle ─────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Vehicle Type         Rate per km                      │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  🚶 Walk              ₱ [   8.00  ]                   │ │
│          │  │  🚲 Bicycle           ₱ [  10.00  ]                   │ │
│          │  │  🏍️ Motorcycle        ₱ [  12.00  ]                   │ │
│          │  │  🚗 Car               ₱ [  15.00  ]                   │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Platform Fee ─────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Service Fee:   [ 8  ] %                               │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Errand Type Surcharges ──────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Type                  Surcharge                       │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  Transportation        ₱ [  10.00  ]                  │ │
│          │  │  Purchase              ₱ [   5.00  ]                  │ │
│          │  │  Bills Payment         ₱ [   0.00  ]                  │ │
│          │  │  (others)              ₱ [   0.00  ]                  │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  Last updated: Mar 20, 2026 by Admin                       │
│          │                                                              │
│          │  [Reset to Defaults]              [Save Changes ✓]         │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Base Fees Table**: editable input fields per errand type
  - Each row: errand type icon + label + ₱ input (number, 2 decimal places)
  - Validation: minimum ₱0, max ₱10,000
- **Per-Km Rates Table**: editable input fields per vehicle type
  - Same style, rate per kilometer
- **Platform Fee**: single percentage input
  - Validation: 0–50%, must be integer or one decimal
- **Surcharges Table**: optional extra fees per errand type
- **Audit trail**: "Last updated" timestamp + admin name
- **Reset to Defaults**: outline `#475569` button — confirmation modal before reset
- **Save Changes**: filled `#2563EB`, Lucide `Check` icon
  - Validates all fields before save
  - Success → `Toast` notification "Pricing rules updated"
  - Changes take effect immediately for new bookings

---

## 17. Configuration — Promo Codes

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Configuration > Promo Codes              🔔   👤 Admin ▾  │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  [+ Create Promo Code]                                      │
│          │                                                              │
│          │  ── Active Promos ────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ Code       Discount   Max Uses  Used   Expires  Status│ │
│          │  │ ─────────────────────────────────────────────────────│ │
│          │  │ FIRST50    ₱50 off    500       142    Mar 31  Active │ │
│          │  │ RIDE20     20% off    200       88     Apr 15  Active │ │
│          │  │ WELCOME    ₱30 off    ∞         1,204  —       Active │ │
│          │  │ SUMMER10   10% off    1000      1000   Mar 20  Expired│ │
│          │  │                                                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Create / Edit Promo ─────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Code:         [ NEWPROMO    ]                         │ │
│          │  │  Type:         [● Fixed ₱] [○ Percentage %]           │ │
│          │  │  Discount:     ₱ [ 50.00 ]  or  [ 10 ] %             │ │
│          │  │  Max Uses:     [ 500 ]   (0 = unlimited)              │ │
│          │  │  Min Booking:  ₱ [ 100.00 ]  (minimum order)          │ │
│          │  │  Valid From:   📅 [ Mar 25, 2026 ]                    │ │
│          │  │  Valid Until:  📅 [ Apr 25, 2026 ]                    │ │
│          │  │  Errand Types: [✓ All] or select specific             │ │
│          │  │                                                        │ │
│          │  │  [Cancel]                     [Save Promo Code ✓]      │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Create Button**: filled `#2563EB`, Lucide `Plus` icon + "Create Promo Code"
  - Scrolls to / reveals the Create form below
- **Promo Table**
  - Columns: Code, Discount, Max Uses, Used, Expires, Status
  - Status badges: Active (`#22C55E`), Expired (`#475569`), Deactivated (`#EF4444`)
  - Row actions (hover/click): Edit, Deactivate/Activate, Delete
  - Click row → populates edit form below
- **Create / Edit Form**
  - Code: uppercase text input, alphanumeric only, max 20 chars
  - Type: radio — Fixed amount or Percentage
  - Discount: number input (context changes based on type)
  - Max Uses: integer (0 = unlimited)
  - Min Booking: minimum order amount to apply promo
  - Valid dates: calendar date pickers
  - Errand Types: checkbox list or "All"
  - Cancel: ghost button; Save: filled `#2563EB`

---

## 18. Configuration — Service Areas (Geofences)

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Configuration > Service Areas            🔔   👤 Admin ▾  │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │                                                        │ │
│          │  │                    MAP VIEW                            │ │
│          │  │                                                        │ │
│          │  │    ┌─── ─── ─── ─── ─── ─── ┐                        │ │
│          │  │    │  Metro Manila            │                        │ │
│          │  │    │  (blue shaded polygon)   │                        │ │
│          │  │    └─── ─── ─── ─── ─── ─── ┘                        │ │
│          │  │                                                        │ │
│          │  │    ┌─── ─── ─── ┐                                     │ │
│          │  │    │  Cebu City  │                                     │ │
│          │  │    └─── ─── ─── ┘                                     │ │
│          │  │                                                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Service Zones ────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  📍 Metro Manila    Status: Active    [Edit] [Disable]│ │
│          │  │  📍 Cebu City       Status: Active    [Edit] [Disable]│ │
│          │  │  📍 Davao City      Status: Disabled  [Edit] [Enable] │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  [+ Add Service Area]                                      │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Map View** (Mapbox web, ~50% viewport)
  - Shows all active service area polygons in `#2563EB` at 15% opacity with border
  - Disabled zones in `#94A3B8` at 10% opacity
  - Click on zone → highlights and shows zone details popover
  - Draw mode: polygon drawing tool to create new zones
- **Service Zones List**
  - Each row: zone name, status badge, action buttons
  - Edit: opens polygon editing on map + name/settings panel
  - Enable/Disable: toggle with confirmation
- **Add Service Area**: opens map in draw mode to define polygon
  - Name input, confirm save

---

## 19. Configuration — System Parameters

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Configuration > System Parameters       🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Booking Parameters ───────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Max booking distance (km):      [ 50    ]             │ │
│          │  │  Cancellation window (min):      [ 1     ]             │ │
│          │  │  Cancellation fee:               ₱[ 30.00 ]           │ │
│          │  │  Negotiate timeout (min):        [ 5     ]             │ │
│          │  │  Negotiate min price:            ₱[ 30.00 ]           │ │
│          │  │  Negotiate ceiling multiplier:   [ 3     ] ×           │ │
│          │  │  Fixed price accept timeout (s): [ 30    ]             │ │
│          │  │  Scheduled booking match (min):  [ 30    ]             │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Runner Parameters ────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Max active errands per runner:  [ 1     ]             │ │
│          │  │  Max cancels/day before suspend: [ 3     ]             │ │
│          │  │  No-show ETA multiplier:         [ 2     ] ×           │ │
│          │  │  Min rating warning threshold:   [ 3.5   ]             │ │
│          │  │  Min rating suspend threshold:   [ 3.0   ]             │ │
│          │  │  Min errands for rating review:  [ 20    ]             │ │
│          │  │  GPS broadcast interval (sec):   [ 5     ]             │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Payout Parameters ────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Payout schedule:       [Weekly ▾]  (Weekly/Biweekly) │ │
│          │  │  Payout day:            [Monday ▾]                    │ │
│          │  │  Instant payout fee:    ₱[ 15.00 ]                    │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Safety Parameters ────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Route deviation threshold (m):  [ 500   ]             │ │
│          │  │  Route deviation time (min):     [ 2     ]             │ │
│          │  │  Ride duration alert multiplier: [ 2     ] ×           │ │
│          │  │  SOS auto-dial timeout (sec):    [ 15    ]             │ │
│          │  │  SOS live link expiry (min):     [ 60    ]             │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  Last updated: Mar 18, 2026 by Super Admin                 │
│          │                                                              │
│          │  [Reset to Defaults]              [Save Parameters ✓]      │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Parameter Groups** (grouped cards with form inputs)
  - Each group: white card, section heading, editable fields
  - Label: 14px, `#475569`; Input: number/select, right-aligned
  - Units shown next to inputs (km, min, sec, ₱, ×)
- **Booking Parameters**: all business rules from Section 2.5 of SPEC
- **Runner Parameters**: performance thresholds, GPS settings
- **Payout Parameters**: schedule, fee settings; dropdown for day selection
- **Safety Parameters**: transportation safety thresholds
- **Audit trail**: last updated timestamp + admin name
- **Reset to Defaults**: outline ghost, confirmation required
- **Save Parameters**: filled `#2563EB`, validates all inputs
  - Super Admin only — regular Admin sees read-only view

---

## 20. Content — FAQs Editor

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Content > FAQs                          🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 📝 Cont●│  [+ Add FAQ]                                                │
│          │                                                              │
│          │  ── Customer FAQs ────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  ☰ How do I book an errand?              [Edit] [🗑️]  │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  ☰ How does pricing work?                [Edit] [🗑️]  │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  ☰ How do I cancel a booking?            [Edit] [🗑️]  │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  ☰ What payment methods are accepted?    [Edit] [🗑️]  │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Runner FAQs ──────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  ☰ How do I become a runner?             [Edit] [🗑️]  │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  ☰ How do payouts work?                  [Edit] [🗑️]  │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  ☰ What are the rating requirements?     [Edit] [🗑️]  │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Edit FAQ ─────────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Category:  [Customer ▾]                               │ │
│          │  │  Question:  [ How do I book an errand?             ]   │ │
│          │  │  Answer:                                               │ │
│          │  │  ┌──────────────────────────────────────────────────┐  │ │
│          │  │  │  B I U  |  • ─ |  🔗  📷                       │  │ │
│          │  │  │─────────────────────────────────────────────── │  │ │
│          │  │  │  Tap "Book an Errand" on the home screen...    │  │ │
│          │  │  │                                                 │  │ │
│          │  │  └──────────────────────────────────────────────────┘  │ │
│          │  │                                                        │ │
│          │  │  [Cancel]                     [Save FAQ ✓]             │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Add FAQ Button**: filled `#2563EB`, Lucide `Plus` + "Add FAQ"
- **FAQ Lists** (grouped by category)
  - Category headers: "Customer FAQs", "Runner FAQs"
  - Each FAQ row: drag handle (☰ Lucide `GripVertical`), question text, Edit + Delete buttons
  - Drag-to-reorder within category
  - Delete: Lucide `Trash2`, confirmation modal before delete
  - Edit: populates the edit form below
- **Edit Form**
  - Category dropdown: Customer / Runner
  - Question: text input
  - Answer: rich text editor (bold, italic, underline, lists, links, images)
  - Cancel: ghost; Save: filled `#2563EB`
  - Preview mode toggle to see formatted output

---

## 21. Content — Terms & Privacy Editor

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Content > Terms & Privacy               🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Document Selector ────────────────────────────────── │
│          │  ┌────────────────┐ ┌────────────────┐                     │
│          │  │ Terms of Svc ● │ │ Privacy Policy │                     │
│          │  └────────────────┘ └────────────────┘                     │
│          │                                                              │
│          │  ── Editor ───────────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  B I U H1 H2 | • # ─ | 🔗 📷 📋                      │ │
│          │  │─────────────────────────────────────────────────────── │ │
│          │  │                                                        │ │
│          │  │  Terms of Service                                      │ │
│          │  │                                                        │ │
│          │  │  Last updated: March 15, 2026                          │ │
│          │  │                                                        │ │
│          │  │  1. Acceptance of Terms                                │ │
│          │  │  By using ErrandGuy, you agree to these terms...       │ │
│          │  │                                                        │ │
│          │  │  2. User Responsibilities                              │ │
│          │  │  ...                                                   │ │
│          │  │                                                        │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  Version: 3.2   Last saved: Mar 15, 2026 by Super Admin   │
│          │                                                              │
│          │  [Preview]  [View History]         [Publish Changes ✓]     │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Document Tabs**: Terms of Service / Privacy Policy
- **Rich Text Editor**: full-featured WYSIWYG
  - Toolbar: bold, italic, underline, headings (H1-H3), lists, links, images, code blocks
  - Markdown shortcut support
- **Version info**: current version number, last saved date + admin
- **Preview**: opens rendered preview in a modal
- **View History**: shows version history with diff view between versions
- **Publish Changes**: filled `#2563EB` — publishes to live and increments version
  - Confirmation modal: "This will update the Terms of Service for all users."

---

## 22. Content — Announcements & Banners

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Content > Announcements                 🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  [+ Create Announcement]                                    │
│          │                                                              │
│          │  ── Active Announcements ──────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  🎉 Weekend Bonus — Earn extra ₱20/errand!            │ │
│          │  │  Target: Runners  •  Expires: Mar 30  •  Status: Live │ │
│          │  │  [Edit] [Deactivate]                                   │ │
│          │  │ ───────────────────────────────────────────────────── │ │
│          │  │  🏷️ Use code FIRST50 for ₱50 off your first errand!   │ │
│          │  │  Target: Customers  •  Expires: Mar 31  • Status: Live│ │
│          │  │  [Edit] [Deactivate]                                   │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Create / Edit ────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Title:     [ Weekend Bonus!                     ]     │ │
│          │  │  Message:   [ Earn extra ₱20 per errand...      ]     │ │
│          │  │  Type:      [● Banner] [○ Push Notification] [○ Both] │ │
│          │  │  Target:    [○ All] [● Customers] [○ Runners]         │ │
│          │  │  Start:     📅 [ Mar 25, 2026 ]                       │ │
│          │  │  End:       📅 [ Mar 30, 2026 ]                       │ │
│          │  │  Link (opt):[ https://...                        ]     │ │
│          │  │                                                        │ │
│          │  │  [Cancel]                [Publish Announcement ✓]      │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Create Button**: filled `#2563EB`, Lucide `Plus`
- **Active Announcements List**
  - Each card: title, target audience, expiry, status
  - Edit: populates form; Deactivate: removes from live display
  - Expired items: grouped separately below with "Expired" badge
- **Create / Edit Form**
  - Title: text input (max 100 chars)
  - Message: textarea (max 250 chars)
  - Type: Banner (in-app), Push Notification, or Both
  - Target: All users, Customers only, Runners only
  - Start/End date: calendar pickers
  - Link: optional URL for banners (e.g., promo page)
  - Publish: filled `#2563EB` — goes live immediately or at start date

---

## 23. Admin Settings — Accounts & Roles

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Settings > Admin Accounts               🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│ 🔧 Sett●│  [+ Invite Admin]                                           │
│          │                                                              │
│          │  ── Admin Users ──────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ Name              Email               Role      Status│ │
│          │  │ ─────────────────────────────────────────────────────│ │
│          │  │ Clark Dalauta     clark@errand.com    Super     Active│ │
│          │  │ Sarah Admin       sarah@errand.com    Admin     Active│ │
│          │  │ Mike Support      mike@errand.com     Admin     Active│ │
│          │  │ Jane Viewer       jane@errand.com     Viewer   Invited│ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  ── Role Permissions ──────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │  Permission          Super Admin  Admin    Viewer     │ │
│          │  │  ──────────────────────────────────────────────────── │ │
│          │  │  Dashboard             ✓            ✓        ✓       │ │
│          │  │  User Management       ✓            ✓        Read    │ │
│          │  │  Runner Verification   ✓            ✓        Read    │ │
│          │  │  Bookings              ✓            ✓        Read    │ │
│          │  │  Disputes              ✓            ✓        —       │ │
│          │  │  SOS Alerts            ✓            ✓        —       │ │
│          │  │  Analytics             ✓            ✓        ✓       │ │
│          │  │  Configuration         ✓            Read     —       │ │
│          │  │  Content Management    ✓            ✓        —       │ │
│          │  │  Admin Settings        ✓            —        —       │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Invite Admin Button** (Super Admin only): filled `#2563EB`, Lucide `UserPlus`
  - Opens modal: email input + role selector (Admin / Viewer)
  - Sends invite email with setup link
- **Admin Users Table**
  - Columns: Name, Email, Role badge, Status
  - Role badges: Super (`#0F172A` bg, white text), Admin (`#2563EB` bg), Viewer (`#475569` bg)
  - Status: Active, Invited (pending), Disabled
  - Row actions: Edit Role, Disable, Remove (Super Admin only)
  - Cannot edit own role or remove self
- **Role Permissions Matrix**
  - Visual reference table showing permission levels
  - ✓ = full access, Read = view-only, — = no access
  - Super Admin only can modify roles (not shown as editable to regular Admin)

---

## 24. Admin Settings — Audit Log

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│          │  Settings > Audit Log                    🔔   👤 Admin ▾   │
│ Sidebar  │─────────────────────────────────────────────────────────────│
│          │                                                              │
│          │  ── Filters ──────────────────────────────────────────────  │
│          │  ┌──────────────────────────────┐ ┌──────┐ ┌────────────┐  │
│          │  │ 🔍 Search actions...         │ │All ▾ │ │📅 Date     │  │
│          │  └──────────────────────────────┘ └──────┘ └────────────┘  │
│          │                                                              │
│          │  ── Activity Log ─────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────────────┐ │
│          │  │ Timestamp          Admin          Action               │ │
│          │  │ ─────────────────────────────────────────────────────│ │
│          │  │ Mar 24, 2:45 PM   Sarah Admin    Approved runner      │ │
│          │  │                                   Sofia Garcia         │ │
│          │  │ Mar 24, 1:30 PM   Sarah Admin    Issued refund ₱200   │ │
│          │  │                                   Booking #407         │ │
│          │  │ Mar 24, 11:00 AM  Clark Dalauta  Updated pricing      │ │
│          │  │                                   rules (base fees)    │ │
│          │  │ Mar 23, 5:00 PM   Mike Support   Suspended user       │ │
│          │  │                                   Ana Lopez (Runner)   │ │
│          │  │ Mar 23, 3:00 PM   Clark Dalauta  Created promo code   │ │
│          │  │                                   RIDE20               │ │
│          │  │                                                        │ │
│          │  │ Showing 1–20 of 892       [← Prev]  1 2 3 [Next →]   │ │
│          │  └────────────────────────────────────────────────────────┘ │
│          │                                                              │
│          │  [📥 Export Log (CSV)]                                      │
│          │                                                              │
└──────────┴───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

- **Filters**
  - Search: free text search across actions
  - Admin dropdown: filter by specific admin user
  - Date range: calendar picker
- **Activity Log Table**
  - Columns: Timestamp, Admin name, Action description
  - Action descriptions: human-readable, include related entity names/IDs
  - All changes are immutable — log entries cannot be edited or deleted
  - Linked entities: clickable names/IDs navigate to relevant detail pages
- **Pagination**: standard controls
- **Export**: CSV download of filtered results, outline `#2563EB`

---

## Figma Structure Note

> For the corresponding Figma design file, organize the Admin screens under:
> ```
> ErrandGuy/
> └── Admin (Web Dashboard)/
>     ├── Auth/
>     │   ├── Login
>     │   └── 2FA Verification
>     ├── Dashboard (Real-Time Overview)
>     ├── Users/
>     │   ├── User List
>     │   ├── User Detail Profile
>     │   └── Suspend/Ban Modal
>     ├── Runner Verification/
>     │   ├── Pending Queue
>     │   └── Application Review Detail
>     ├── Bookings/
>     │   ├── All Bookings List
>     │   └── Booking Detail
>     ├── Disputes/
>     │   ├── Dispute Queue
>     │   └── Dispute Detail & Resolution
>     ├── Safety/
>     │   └── SOS Alerts Dashboard
>     ├── Analytics/
>     │   ├── Overview (Charts + Metrics)
>     │   └── Heatmaps
>     ├── Configuration/
>     │   ├── Pricing Rules
>     │   ├── Promo Codes
>     │   ├── Service Areas (Geofences)
>     │   └── System Parameters
>     ├── Content/
>     │   ├── FAQs Editor
>     │   ├── Terms & Privacy Editor
>     │   └── Announcements & Banners
>     └── Settings/
>         ├── Admin Accounts & Roles
>         └── Audit Log
> ```
> Use a responsive grid layout (max-width 1440px), consistent spacing (8px grid), and the color tokens from Section 3.2 of SPEC.md. Web-specific: use Lucide icons (`lucide-react`), Inter or Montserrat font, and standard web form elements.
