import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Archiving a notification hid it for good: no undo, and no archived view to
 * find it in again (the server has always served `?archived=1`). Guarded by
 * source shape — the inbox needs the gesture handler, realtime and the api
 * graph to render; the archive list itself is unit-tested in
 * hooks/__tests__/useArchivedNotifications.
 */
const INBOX = readFileSync(join(__dirname, '..', '(customer)', '(tabs)', 'notifications.tsx'), 'utf8');

describe('customer inbox — archive', () => {
  it('archiving offers Undo, like delete', () => {
    const archive = INBOX.slice(INBOX.indexOf('const handleArchive')).slice(0, 1600);
    expect(archive).toContain("toast.info('Notification archived', {");
    expect(archive).toContain("actionLabel: 'Undo'");
    // Undo waits for the archive to land, so the two can't cross on the wire.
    expect(archive).toMatch(/archiving\s*\.then\(\s*\(\) => notificationService\.unarchiveNotification\(item\.id\)/);
  });

  it('has an Archived view whose rows move back to the inbox', () => {
    expect(INBOX).toContain('useArchivedNotifications(userId, showArchived)');
    expect(INBOX).toContain('accessibilityLabel="Archived notifications"');
    expect(INBOX).toContain('onArchive={showArchived ? handleUnarchive : handleArchive}');
    expect(INBOX).toContain('notificationService.unarchiveNotification(item.id);');
  });

  it('the archive never feeds the inbox store or its badge', () => {
    const hook = readFileSync(join(__dirname, '..', '..', 'hooks', 'useArchivedNotifications.ts'), 'utf8');
    expect(hook).not.toContain('useNotificationStore');
  });
});
