# ErrandGuy — Client Overview

**Version:** 1.0
**Date:** March 20, 2026
**Platform:** Android & iOS Mobile App

---

## What is ErrandGuy?

ErrandGuy is a mobile app that connects people who need tasks done (customers) with people who are willing to do those tasks for pay (errand runners). Think of it like a ride-hailing app — but instead of booking a car, you're booking someone to run your errands.

Whether you need something picked up and delivered, a bill paid at a payment center, someone to queue in line for you, or even groceries purchased and brought to your door — ErrandGuy makes it possible by connecting you with a nearby, verified runner in minutes.

---

## Who Uses ErrandGuy?

There are three types of people in the system:

| Who | What They Do |
|---|---|
| **Customer** | Posts errands and pays for them through the mobile app |
| **Errand Runner** | Accepts errands, completes them, and earns money |
| **Admin / Super Admin** | Manages the platform — users, payments, disputes, and settings — through a separate web dashboard |

---

## What Kinds of Errands Can Be Booked?

Customers can choose from these errand categories:

- **Delivery** — Pick up an item from one place and bring it to another
- **Purchase & Deliver** — Buy something (e.g., groceries, medicine) and deliver it
- **Bills Payment** — Pay a bill on behalf of the customer at a payment center
- **Queue / Line Waiting** — Hold a spot in line so the customer doesn't have to wait
- **Document Processing** — File, claim, or submit documents at an office or agency
- **Transportation** — Book a runner to pick you up and bring you to your destination (passenger ride)
- **Custom Errand** — Describe any other task in the customer's own words

---

## How the App Works — Step by Step

### For Customers

#### 1. Sign Up
The customer downloads the app and creates an account using their phone number or email. A one-time password (OTP) is sent to verify identity. They can also sign in with Google or Facebook.

#### 2. Book an Errand
The customer taps "Book an Errand" and goes through a simple step-by-step booking process:

1. **Choose the errand type** (Delivery, Purchase, Bills, etc.)
2. **Enter task details** — pickup location, drop-off location, item description, photos (optional), and any special instructions
3. **Choose a schedule** — "Now" (ASAP) or a future date and time (up to 7 days ahead)
4. **Choose how to price the errand:**
   - **Fixed Price** — The app calculates the price automatically based on distance and the runner's vehicle type. The customer sees a full price breakdown before confirming.
   - **Negotiate** — The customer sets their own offered price. The system shows a recommended range to guide them. Nearby runners can then accept or skip the offer.
5. **Choose payment method** — Credit/Debit Card, GCash, Maya, Cash on Delivery, or in-app Wallet
6. **Confirm** — The booking is submitted

#### 3. Getting Matched with a Runner
- **Fixed Price bookings:** The system automatically assigns the nearest available runner. The runner has 30 seconds to accept or decline.
- **Negotiate bookings:** The offer is broadcast to all nearby runners. The first runner to accept gets the job. If no one accepts within 5 minutes, the customer is prompted to raise their offer or switch to Fixed Price.

#### 4. Live Tracking
Once a runner accepts, the customer can see the runner's live location on a map in real time. The runner's position updates every 5 seconds. The customer also sees a status timeline:

> **Accepted → En Route to Pickup → At Pickup → In Transit → Arrived → Completed**

#### 5. Completion & Payment
When the errand is done, the payment is processed automatically (or the customer pays in cash). A receipt is shown in the app.

#### 6. Rate the Runner
After completion, the customer rates the runner from 1 to 5 stars and can leave a written review.

---

### For Errand Runners

#### 1. Sign Up & Verification
Runners go through a more thorough registration process because they are handling tasks on behalf of customers. After signing up, they must:

- Submit a valid government ID (front and back)
- Take a selfie holding their ID
- Provide vehicle information (if they'll use one)

The admin team reviews and approves or rejects the application within 1–48 hours. Only verified runners can go online and receive errands.

#### 2. Going Online
Runners open their app and toggle themselves "Online" when they're ready to accept jobs. They can go offline anytime.

#### 3. Receiving Errand Requests
- **Fixed Price errands** appear as a pop-up with a 30-second countdown. The runner sees the errand type, pickup/drop-off locations, distance, and their payout. They tap Accept or Decline.
- **Negotiate errands** appear as cards in a live feed. No countdown — the runner reads the customer's offer and taps "Accept" if they want it, or simply scrolls past.

#### 4. Completing the Errand
The runner follows the step-by-step flow:
1. Navigate to the pickup location
2. Tap "Arrived at Pickup" when they arrive
3. Collect the item or complete the pickup task → Tap "Picked Up" (optional photo proof)
4. Navigate to the drop-off location
5. Tap "Arrived" at the destination
6. Complete the delivery → Tap "Completed" (photo proof or signature may be required)

#### 5. Getting Paid
The runner's earnings are credited automatically. They can:
- View earnings daily, weekly, or monthly
- Request an instant payout (small fee applies) or wait for the scheduled weekly payout
- Set up a bank account or e-wallet to receive funds

#### 6. Rate the Customer
After each errand, the runner can also rate the customer (1–5 stars).

---

## How Transportation (Passenger Rides) Work

When a customer selects **Transportation** as the errand type, they are booking a ride for themselves — the runner picks them up and drives/rides them to their destination.

Here's how it works:

1. **Select "Transportation"** as the errand type
2. **Set your pickup location** (where you want to be picked up)
3. **Set your destination** (where you want to go)
4. **Choose your vehicle** — Motorcycle or Car only (Walk and Bicycle are not available for passenger rides)
5. **Choose pricing mode** — Fixed Price or Negotiate, same as other errands
6. **Confirm** — A nearby runner with the right vehicle is matched to you

Once the runner arrives:
- The customer gets in the vehicle
- The runner taps "Passenger Picked Up"
- **Live tracking and enhanced safety features activate** — the SOS button, trip sharing, and emergency contact alerts are all available throughout the ride
- On arrival, the runner taps "Completed" and payment is processed

Transportation follows the same pricing structure as other errands (base fee + distance + service fee), but only Motorcycle and Car transport types are available since the customer is riding along.

---

## Choosing a Transport / Vehicle Type

When booking an errand, the customer can choose what kind of runner they want based on transport type. This choice directly affects the price and speed of the errand:

| Transport Type | Best For | Cost |
|---|---|---|
| **Walk (On Foot)** | Short distances, small lightweight items | Cheapest |
| **Bicycle** | Nearby errands, eco-friendly option | Low |
| **Motorcycle** | Medium distances, fast delivery, passenger rides | Medium |
| **Car** | Large or heavy items, longer distances, passenger rides | Highest |

> **Note:** Transportation (passenger rides) are only available with **Motorcycle** and **Car** runners.

The customer sees the price comparison for all available transport types before confirming, so they can pick the one that fits their budget and needs.

**Example — same errand, different prices by transport type:**

| Transport Type | Total Price |
|---|---|
| Walk | ₱88.13 |
| Bicycle | ₱99.36 |
| Motorcycle | ₱110.59 |
| Car | ₱127.44 |

The selected transport type determines which runners can accept the errand — only runners using that vehicle type will be matched.

---

## How Pricing Works

### Fixed Price (System-Calculated)

The price is automatically calculated using:

| Factor | Description |
|---|---|
| Base fee | A fixed starting fee per errand type |
| Distance fee | A per-kilometer rate based on the road distance between pickup and drop-off |
| Transport type rate | Walk (cheapest) → Bicycle → Motorcycle → Car (most expensive per km) |
| Service fee | 8% platform fee added on top |

The customer sees a full breakdown before confirming. Prices are shown in Philippine Peso (₱).

**Example breakdown (Motorcycle):**

| Item | Amount |
|---|---|
| Base fee | ₱40.00 |
| Distance (5.2 km) | ₱62.40 |
| Service fee (8%) | ₱8.19 |
| **Total** | **₱110.59** |

### Negotiate Price (Customer-Set Offer)

- The customer types in how much they want to pay
- The app shows the recommended price range (e.g., ₱65 – ₱115) to guide them
- The minimum offer is ₱30
- If the offer seems unusually high (3× the recommended price), the app shows a warning
- Lower offers may take longer to find a runner

---

## Communication Between Customer and Runner

Once an errand is matched, the customer and runner can:

- **Chat** inside the app (text messages and photos)
- Use **pre-written quick messages** like "I'm here" or "Running late" for fast replies
- **Call each other** through the app — their real phone numbers are kept private for safety

---

## Safety Features

ErrandGuy is built with trust and safety in mind:

- **Verified Runners Only** — All runners go through identity verification before they can work
- **Live GPS Tracking** — Customers see the runner's real-time location throughout the errand
- **Two-Way Ratings** — Both customers and runners rate each other after every errand, keeping the community accountable
- **Emergency SOS Button** — Available during any active errand for immediate assistance
- **Issue Reporting** — Customers can report a problem on any past booking directly from the app
- **Insurance Claim Flow** — A process is available for lost or damaged items

### Enhanced Safety for Transportation (Passenger Rides)

Because the customer is physically inside the vehicle during a transportation booking, extra safety features are activated:

- **SOS Emergency Button** — A prominent SOS button is always visible on the screen during a ride. When pressed, it immediately:
  1. **Calls the customer's emergency contact** — The customer can set up one or more trusted contacts (family, friends, etc.) in their profile. Pressing SOS auto-dials the selected emergency contact.
  2. **Shares live location with trusted contacts** — The customer's real-time GPS location is instantly sent to their chosen trusted contacts via SMS/notification, including a live map link that updates continuously until the ride ends or the customer manually stops sharing.
  3. **Alerts the ErrandGuy safety team** — A distress alert is sent to the platform's safety/support team for monitoring and potential intervention.
- **Trip Sharing** — Even without pressing SOS, the customer can proactively share their live ride with a friend or family member at any time during the trip. The recipient gets a link showing the route, runner details, and real-time position.
- **Trusted Contacts Setup** — Customers can save emergency contacts in their profile ahead of time, so they are ready when needed. These contacts are the ones notified when SOS is triggered.

---

## Notifications

The app sends push notifications so users are always informed:

- Booking confirmed / runner assigned
- Runner is en route, has arrived at pickup, is in transit, has arrived at destination
- Payment processed and receipt ready
- Promotions and special announcements

All notifications also appear in an in-app Notification Center.

---

## Wallet & Payments

Customers have an in-app **wallet** they can top up with funds and use to pay for errands. Refunds from cancelled bookings are credited back to the wallet by default. If a card refund is preferred, it takes 3–5 business days to process.

Accepted payment methods:
- Credit or Debit Card
- GCash
- Maya
- Cash on Delivery
- ErrandGuy Wallet

---

## Cancellations & Rules

| Situation | What Happens |
|---|---|
| Customer cancels within 1 minute of booking | Free cancellation, full refund |
| Customer cancels after runner accepts | ₱30 cancellation fee applies |
| Runner cancels too often (3+ times in a day) | Temporarily suspended from the platform |
| Runner doesn't arrive within 2× the estimated time | Booking is auto-cancelled, runner is penalized |
| Runner's average rating drops below 3.5 (after 20 errands) | Warning issued |
| Runner's average rating drops below 3.0 | Account suspended |
| Scheduled booking has no runner match within 30 min | Auto-cancelled, customer refunded |
| Negotiate offer gets no acceptance within 5 minutes | Customer is prompted to raise the offer or switch to Fixed Price |

---

## What Admins Can Do

Admins manage the entire platform from a separate **web-based dashboard** (not the mobile app). They can:

- **Monitor** all active errands and online runners in real time on a map
- **Manage users** — view profiles, suspend or ban accounts, reset credentials
- **Verify runners** — review submitted ID documents and approve or reject applications
- **Handle disputes** — review complaints, issue refunds, warn or suspend accounts
- **Set pricing rules** — configure base fees, per-km rates, and vehicle surcharges
- **Create promo codes** — generate discount codes with usage limits and expiry dates
- **Configure service areas** — define which geographic zones the service operates in
- **Manage content** — edit FAQs, terms of service, privacy policy, and in-app announcements
- **View analytics** — track bookings, revenue, active users, and usage heatmaps

---

## Summary

ErrandGuy is a complete on-demand errand platform with three core experiences:

1. **Customers** book any task through a simple mobile app, choose their price, pay securely, and track their runner live.
2. **Errand Runners** earn money by accepting and completing errands from verified, paying customers.
3. **Admins** keep the platform running safely and fairly through a web dashboard with full oversight and control.

The system is designed to be fast, transparent, and trustworthy — making everyday tasks easier for customers while providing a flexible earning opportunity for runners.
