import type { Message } from '../types';
import { formatChatDayLabel } from './formatDate';

/**
 * One row in an inverted chat FlatList.
 * The list renders newest-first (because `inverted`), so visually the
 * day separator sits ABOVE the first message of that calendar day —
 * which is what every modern chat client (iMessage, WhatsApp, Telegram)
 * does.
 */
export type ChatRow =
  | { kind: 'msg'; message: Message }
  | { kind: 'day'; id: string; label: string };

/**
 * Build the inverted FlatList data array out of a chronological message
 * list (oldest -> newest). We:
 *   1. Reverse so the newest message becomes index 0 (FlatList `inverted`
 *      paints index 0 at the bottom of the screen — i.e. the spot the
 *      user is reading).
 *   2. Walk the reversed list and emit a `day` separator every time the
 *      calendar day differs from the next message (the "next" entry in
 *      the inverted array is the older one, so the separator visually
 *      anchors the START of that day's conversation block).
 *
 * Done out-of-render (cheap, O(n)) and memoized by callers so the
 * FlatList `data` reference is stable while the message list is.
 */
export function buildChatRows(messages: Message[]): ChatRow[] {
  if (messages.length === 0) return [];

  const reversed = [...messages].reverse();
  const rows: ChatRow[] = [];

  for (let i = 0; i < reversed.length; i++) {
    const m = reversed[i];
    rows.push({ kind: 'msg', message: m });

    const next = reversed[i + 1]; // the OLDER message in inverted order
    const currentDay = m.created_at?.slice(0, 10);
    const nextDay = next?.created_at?.slice(0, 10);

    // Insert a separator at the boundary between two different calendar
    // days (or at the very top of the conversation when we've walked past
    // the oldest entry). The separator carries the LABEL of the older
    // side of the boundary because that's the day whose messages are
    // about to begin scrolling into view as the user scrolls up.
    if (!next || currentDay !== nextDay) {
      const labelDate = next ? next.created_at : m.created_at;
      rows.push({
        kind: 'day',
        id: `day-${labelDate}`,
        label: formatChatDayLabel(labelDate),
      });
    }
  }

  return rows;
}
