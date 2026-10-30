import type { NotificationBehavior } from 'expo-notifications';

const SHOW: NotificationBehavior = {
  shouldShowAlert: true,
  shouldPlaySound: true,
  shouldSetBadge: true,
  shouldShowBanner: true,
  shouldShowList: true,
};

const QUIET: NotificationBehavior = {
  shouldShowAlert: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
  shouldShowBanner: false,
  shouldShowList: false,
};

/**
 * How a push that arrives while the app is open is presented.
 *
 * A chat push (`type: 'chat'`, ChatController::store) for the thread the
 * person is reading is the one exception: the message is already landing in
 * front of them over the realtime channel, so a banner and a buzz on top of it
 * only cover the conversation. Every other push — including chat from a
 * DIFFERENT errand — still shows.
 */
export function foregroundPresentation(
  data: Record<string, unknown> | null | undefined,
  openThreadId: string | null | undefined,
): NotificationBehavior {
  if (
    openThreadId &&
    data?.type === 'chat' &&
    data.booking_id != null &&
    String(data.booking_id) === openThreadId
  ) {
    return QUIET;
  }
  return SHOW;
}
