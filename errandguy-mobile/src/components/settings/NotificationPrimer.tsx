import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useNotificationStore } from '../../stores/notificationStore';
import { turnOnPush } from '../../services/pushPermission';
import { storage } from '../../utils/storage';

/** After "Not now", stay quiet this long before asking again. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = '@push_primer_snoozed_until';

/**
 * The app's own question before the OS notification prompt.
 *
 * The OS prompt used to fire cold the moment Home first rendered, with no
 * word on what the notifications are for — and it is a one-shot: a reflex
 * "Don't Allow" on iOS can only be undone in the phone's Settings. This asks
 * first, in plain words. "Not now" spends nothing: the OS prompt stays unused,
 * this asks again in a week, and Profile → Notifications can turn it on any
 * time. Only "Allow" shows the OS prompt.
 *
 * Self-gating: renders nothing unless `enabled` and the permission is
 * 'undetermined' (useNotifications records that instead of prompting).
 */
export function NotificationPrimer({ enabled }: { enabled: boolean }) {
  const undetermined = useNotificationStore((s) => s.pushPermission === 'undetermined');
  // null until the snooze has been read, so it never flashes up and away.
  const [snoozed, setSnoozed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    storage
      .get(SNOOZE_KEY)
      .then((raw) => {
        if (!cancelled) setSnoozed(Number(raw) > Date.now());
      })
      .catch(() => {
        if (!cancelled) setSnoozed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const snooze = useCallback(() => {
    setSnoozed(true);
    storage.set(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)).catch(() => {});
  }, []);

  const allow = useCallback(() => {
    // Hide first, so the OS dialog isn't stacked on top of this one. Snoozed
    // either way: a refusal at the OS prompt must not bring this straight back.
    snooze();
    void turnOnPush();
  }, [snooze]);

  return (
    <ConfirmModal
      visible={enabled && undetermined && snoozed === false}
      title="Get updates about your errands?"
      message="We’ll let you know when a runner accepts your errand, when it’s on the way and when it’s done — and when you get a message. You can turn this off any time."
      confirmLabel="Allow"
      cancelLabel="Not now"
      onConfirm={allow}
      onCancel={snooze}
    />
  );
}
