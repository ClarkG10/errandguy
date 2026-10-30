import { readFileSync } from 'fs';
import { join } from 'path';
import { foregroundPresentation } from '../pushPresentation';

describe('foreground push presentation', () => {
  it('stays quiet for a chat push on the thread being read', () => {
    const b = foregroundPresentation({ type: 'chat', booking_id: 'b1' }, 'b1');
    expect(b.shouldShowBanner).toBe(false);
    expect(b.shouldShowList).toBe(false);
    expect(b.shouldPlaySound).toBe(false);
  });

  it('still shows chat from a DIFFERENT errand, and every other type', () => {
    expect(foregroundPresentation({ type: 'chat', booking_id: 'b2' }, 'b1').shouldShowBanner).toBe(true);
    expect(foregroundPresentation({ type: 'booking_update', booking_id: 'b1' }, 'b1').shouldShowBanner).toBe(true);
    expect(foregroundPresentation({ type: 'sos', booking_id: 'b1' }, 'b1').shouldPlaySound).toBe(true);
  });

  it('shows everything when no thread is open', () => {
    expect(foregroundPresentation({ type: 'chat', booking_id: 'b1' }, null).shouldShowBanner).toBe(true);
    expect(foregroundPresentation(undefined, null).shouldShowBanner).toBe(true);
  });

  it('is wired: the handler reads the open thread, and both chat screens claim it while focused', () => {
    const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
    expect(src('hooks/useNotifications.ts')).toMatch(
      /foregroundPresentation\([\s\S]*useChatStore\.getState\(\)\.openThreadId/,
    );
    expect(src('hooks/useOpenChatThread.ts')).toMatch(/useFocusEffect/);
    expect(src('app/(customer)/chat/[bookingId].tsx')).toMatch(/useOpenChatThread\(bookingId\)/);
    expect(src('app/(runner)/chat/[bookingId].tsx')).toMatch(/useOpenChatThread\(bookingId\)/);
  });
});
