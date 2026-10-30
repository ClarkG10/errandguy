import { Linking } from 'react-native';
import { haptics } from '../../utils/haptics';
import { toast } from '../../stores/toastStore';

/** National emergency hotline (Philippines). Voice works where data doesn't. */
export const EMERGENCY_NUMBER = '911';

/**
 * Open the dialler on a number — 911 or a trusted contact. A call is the one
 * thing that still works with no data, so every SOS surface offers it. The
 * user places the call; nothing here contacts anyone on their behalf.
 */
export function dialNumber(number: string): void {
  haptics.warning();
  const tel = `tel:${number.replace(/[^0-9+#*]/g, '')}`;
  Linking.openURL(tel).catch(() => {
    toast.error(`Couldn’t open the dialler — call ${number}`);
  });
}
