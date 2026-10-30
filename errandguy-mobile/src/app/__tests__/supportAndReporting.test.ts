import fs from 'fs';
import path from 'path';

/**
 * The support entry points that used to dead-end:
 *   • "Report a problem" on an errand opened the EMPTY inbox (the composer
 *     ignored the params) — it now opens a new ticket linked to the errand;
 *   • there was no way to report the other person on an errand;
 *   • a "Support replied" notification opened nothing.
 * Pinned against the source (the screens can't be rendered here); the pure
 * pieces (prefill, route map, report payload) have their own unit tests.
 */
const APP = path.join(__dirname, '..');
const read = (...p: string[]) =>
  fs
    .readFileSync(path.join(APP, ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const TRACKING = read('(customer)', 'tracking', '[id].tsx');
const COCKPIT = read('(runner)', 'errand', '[id].tsx');
const SUPPORT = read('(customer)', 'support', 'index.tsx');
const CUSTOMER_INBOX = read('(customer)', '(tabs)', 'notifications.tsx');
const RUNNER_INBOX = read('(runner)', 'notifications.tsx');
const PUSH = fs.readFileSync(path.join(APP, '..', 'hooks', 'useNotifications.ts'), 'utf8');

describe('Report a problem → a new ticket about THAT errand', () => {
  it('the tracking screen sends the errand and asks for the composer', () => {
    expect(TRACKING).toMatch(/pathname: '\/\(customer\)\/support',\s*params: \{\s*compose: '1',\s*category,\s*booking_id: booking\.id,/);
  });

  it('the support screen opens its composer from the link and files booking_id', () => {
    expect(SUPPORT).toContain('composePrefillFromParams({');
    expect(SUPPORT).toContain('openCompose(prefill);');
    expect(SUPPORT).toContain('...(linkedErrand ? { booking_id: linkedErrand.id } : {})');
  });

  it('a draft about one errand is never restored into a ticket about another', () => {
    expect(SUPPORT).toContain('const sameErrand = (d.bookingId ?? null) === (errand?.id ?? null);');
    expect(SUPPORT).toContain('if (!composeOpen || !draftHydrated || !composeDirty) return;');
  });
});

describe('Report this person — both sides of the errand', () => {
  it('the customer reports the runner from tracking and the receipt', () => {
    expect(TRACKING).toContain('Report this person');
    expect(TRACKING).toContain('reportedUserId={booking.runner_id}');
    expect(TRACKING).toContain('counterpart="runner"');
    // One link block, rendered in both the live and the receipt layouts.
    expect(TRACKING.match(/\{reportProblemLink\}/g)?.length).toBe(2);
  });

  it('the runner reports the customer from the cockpit', () => {
    expect(COCKPIT).toContain('Report this person');
    expect(COCKPIT).toContain('reportedUserId={booking.customer_id}');
    expect(COCKPIT).toContain('counterpart="customer"');
  });
});

describe('notification taps go somewhere', () => {
  it('the push and both inboxes share one route map', () => {
    expect(PUSH).toContain("notificationRoute({ type: String(data.type), data }, role, 'push')");
    expect(CUSTOMER_INBOX).toContain("notificationRoute(notification, 'customer', 'inbox')");
    expect(RUNNER_INBOX).toContain("notificationRoute(n, 'runner', 'inbox')");
  });

  it('support replies, ticket updates and announcements are typed in both inboxes', () => {
    for (const inbox of [CUSTOMER_INBOX, RUNNER_INBOX]) {
      expect(inbox).toContain("support_reply: 'Support'");
      expect(inbox).toContain("support_status: 'Support'");
      expect(inbox).toContain("broadcast: 'ErrandGuy'");
    }
    // …and reachable through the customer's "More" filter chip.
    expect(CUSTOMER_INBOX).toMatch(/more: \[[\s\S]*'support_reply',[\s\S]*'broadcast',[\s\S]*\]/);
  });
});

describe('runners get trusted contacts too', () => {
  it('the runner profile links the shared trusted-contacts screen', () => {
    const PROFILE = read('(runner)', '(tabs)', 'profile.tsx');
    expect(PROFILE).toContain("route: '/(runner)/settings/trusted-contacts'");
    expect(fs.existsSync(path.join(APP, '(runner)', 'settings', 'trusted-contacts.tsx'))).toBe(true);
  });
});
