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
