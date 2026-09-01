import type { ChecklistItem } from '../types/booking';

/**
 * Shared serialize / parse contract for the shopping checklist.
 *
 * The bookings API has NO structured items column — it stores only a
 * free-text `description`. So the customer's checklist is serialized into
 * that description as clean, human-readable text (readable as-is by a
 * runner or admin who never parses it), and the runner parses it back to
 * render tickable rows.
 *
 * This module is intentionally pure (no React Native imports) so it stays
 * trivially unit-testable and can run in any environment.
 */

/** First line of a serialized checklist. Used both to render and to detect. */
const HEADER = 'Shopping list:';

/** Bullet + multiplication glyphs used when rendering item lines. */
const BULLET = '•'; // •
const TIMES = '×'; // ×

/**
 * Matches a single item line, e.g. `• Milk ×2` — tolerant of a few bullet
 * variants and both the `×` glyph and a plain `x`, with flexible spacing.
 * The name is captured non-greedily so a trailing `×{qty}` binds to the
 * quantity rather than the name.
 */
const ITEM_RE = /^\s*[•·*-]\s+(.+?)\s*[×xX]\s*(\d+)\s*$/;

/**
 * Serialize a checklist into the canonical description text.
 *
 * Example output:
 *   Shopping list:
 *   • Milk ×2
 *   • Bread ×1
 *
 *   No plastic bags please
 *
 * An optional freeform `note` is appended after a blank line. Item names
 * are trimmed and quantities floored to at least 1.
 */
export function serializeChecklist(
  items: ChecklistItem[],
  note?: string | null,
): string {
  const lines: string[] = [HEADER];
  for (const item of items) {
    const name = (item.name ?? '').trim();
    if (!name) continue; // skip blank rows — never serialize an empty bullet
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    lines.push(`${BULLET} ${name} ${TIMES}${qty}`);
  }
  let text = lines.join('\n');
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    text += `\n\n${trimmedNote}`;
  }
  return text;
}

/**
 * Tolerant reverse of {@link serializeChecklist}.
 *
 * Returns `null` when `description` is not a serialized checklist (so the
 * runner UI can fall back to rendering the plain text). Round-trips
 * serialize → parse losslessly for item name + qty. Ids are regenerated
 * stably from the item's index on parse.
 */
export function parseChecklist(
  description: string | null | undefined,
): { items: ChecklistItem[]; note?: string } | null {
  if (!description) return null;

  const lines = description.replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 0) return null;
  // The header must be the very first line (trimmed) or this is plain text.
  if (lines[0].trim() !== HEADER) return null;

  const items: ChecklistItem[] = [];
  let i = 1;
  for (; i < lines.length; i++) {
    const match = lines[i].match(ITEM_RE);
    if (!match) break;
    items.push({
      id: `item-${items.length}`,
      name: match[1].trim(),
      qty: Math.max(1, parseInt(match[2], 10) || 1),
    });
  }

  // A header with no parseable items isn't a real checklist.
  if (items.length === 0) return null;

  const note = lines.slice(i).join('\n').trim();
  return note.length > 0 ? { items, note } : { items };
}

/**
 * A single line of the SERVER-synced checklist (`booking.shopping_items`),
 * as opposed to the {@link ChecklistItem} the customer's builder produces.
 * The tick fields are written only by the runner
 * (`PATCH /runner/errand/{id}/shopping-items`).
 */
export interface ShoppingProgressItem {
  id: string;
  name: string;
  qty: number;
  checked?: boolean;
  checked_at?: string | null;
}

/** Progress summary of a server-synced checklist. */
export interface ShoppingProgress {
  picked: number;
  total: number;
  /** 0–1. Zero when the list is empty, so callers never divide by zero. */
  ratio: number;
  /** True only when there is at least one item AND every one is ticked. */
  allPicked: boolean;
}

/**
 * Count how far along a runner is on a server-synced shopping list.
 *
 * Pure and tolerant of the wire shape: `checked` may be absent (a list the
 * runner has never touched), and the array itself may be null/undefined for a
 * non-shopping errand.
 */
export function shoppingProgress(
  items: ShoppingProgressItem[] | null | undefined,
): ShoppingProgress {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const picked = list.reduce((n, item) => n + (item?.checked ? 1 : 0), 0);
  return {
    picked,
    total,
    ratio: total > 0 ? picked / total : 0,
    allPicked: total > 0 && picked === total,
  };
}

/**
 * Shape of the realtime notification the runner's tick produces. Mirrors
 * `AppNotification` loosely on purpose so this stays testable without the
 * app's type barrel (and so an unrecognised `type` string can't fail to
 * type-check here the way it does against `NotificationType`).
 */
export interface ShoppingItemsSignal {
  type?: string | null;
  data?: Record<string, unknown> | null;
}

/** The notification type `ShoppingChecklistController::update` emits. */
export const SHOPPING_ITEMS_UPDATED = 'shopping_items_updated';

/**
 * Pull a refreshed checklist out of a `shopping_items_updated` notification.
 *
 * Every runner tick writes the WHOLE list back and pushes it to the customer
 * (ShoppingChecklistController → notifyInApp), so the customer's tracking
 * screen can patch its booking straight from the payload instead of spending a
 * request to re-read what it was just handed.
 *
 * Returns null — meaning "not for us, change nothing" — for any row that is a
 * different notification type, belongs to another booking, or carries a
 * payload we can't trust. An EMPTY array counts as untrustworthy: the tick
 * endpoint 422s on a booking with no list, so an empty broadcast can only be a
 * malformed one, and honouring it would blank the customer's card.
 */
export function shoppingItemsFromNotification(
  signal: ShoppingItemsSignal | null | undefined,
  bookingId: string | null | undefined,
): ShoppingProgressItem[] | null {
  if (!signal || !bookingId) return null;
  const data = signal.data ?? {};
  // The server writes the `type` column FROM data['type'], so the bag is the
  // more direct read and needs no client-side union to know the string.
  const type =
    typeof data.type === 'string' && data.type !== ''
      ? data.type
      : typeof signal.type === 'string'
        ? signal.type
        : '';
  if (type !== SHOPPING_ITEMS_UPDATED) return null;
  if (data.booking_id !== bookingId) return null;

  const raw = data.shopping_items;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const items: ShoppingProgressItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || row.id === '') return null;
    if (typeof row.name !== 'string') return null;
    const qty = Number(row.qty);
    items.push({
      id: row.id,
      name: row.name,
      qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1,
      checked: row.checked === true,
      checked_at: typeof row.checked_at === 'string' ? row.checked_at : null,
    });
  }

  return items;
}
