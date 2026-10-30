import type { Message } from '../types';
import { formatChatDayLabel, localDayKey } from './formatDate';

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
 *   2. Walk the reversed list and emit a `day` separator after the OLDEST
 *      message of each calendar day. Later indexes paint HIGHER in an
 *      inverted list, so that separator sits directly above the day's first
 *      message — the pill heads the block it names.
 *
 * Exactly one separator per day, labelled with that day. (The label used to
 * be taken from the OLDER neighbour, which named every boundary after the day
 * above it: a thread spanning yesterday and today showed "Yesterday" twice and
 * no "Today".) Messages are given a usable created_at by the chat store, and a
 * row that still has none is grouped with its newer neighbour rather than
 * opening a day of its own.
 *
 * Done out-of-render (cheap, O(n)) and memoized by callers so the
 * FlatList `data` reference is stable while the message list is.
 */
export function buildChatRows(messages: Message[]): ChatRow[] {
  if (messages.length === 0) return [];

  const reversed = [...messages].reverse();
  const rows: ChatRow[] = [];
  // Day of the most recent row that had a valid timestamp — the day an
  // undated row is filed under.
  let carriedDay: string | undefined;
  let carriedStamp: string | undefined;

  for (let i = 0; i < reversed.length; i++) {
    const m = reversed[i];
    rows.push({ kind: 'msg', message: m });

    // Group by LOCAL calendar day (matches formatChatDayLabel). Slicing the
    // raw UTC timestamp grouped by the UTC day, which drifts up to 8h from
    // the local day the label shows for PH users near midnight.
    const ownDay = dayOf(m.created_at);
    if (ownDay) {
      carriedDay = ownDay;
      carriedStamp = m.created_at;
    }
    const currentDay = ownDay ?? carriedDay;
    const next = reversed[i + 1]; // the OLDER message in inverted order
    const nextDay = next ? dayOf(next.created_at) ?? currentDay : undefined;

    if ((!next || nextDay !== currentDay) && currentDay && carriedStamp) {
      rows.push({
        kind: 'day',
        id: `day-${currentDay}`,
        label: formatChatDayLabel(carriedStamp),
      });
    }
  }

  return rows;
}

/** Local day key for a timestamp, or undefined when it isn't a real date. */
function dayOf(createdAt: string | null | undefined): string | undefined {
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return undefined;
  return localDayKey(createdAt);
}
