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

describe('customer inbox — delete and older pages', () => {
  it('deletes in one step with Undo, like the runner inbox — no confirm dialog in front', () => {
    expect(INBOX).not.toContain('Delete notification?');
    expect(INBOX).not.toMatch(/deleteTarget|requestDelete/);
    expect(INBOX).toContain('onDelete={handleDelete}');
    const del = INBOX.slice(INBOX.indexOf('const handleDelete')).slice(0, 1600);
    expect(del).toContain('toast.info(DELETED_TOAST, {');
    expect(INBOX).toContain("const DELETED_TOAST = 'Notification deleted';");
    expect(del).toContain("actionLabel: 'Undo'");
  });

  it('a failed older page offers Try again and doesn’t page on its own until it’s tapped', () => {
    const fetchMore = INBOX.slice(INBOX.indexOf('const fetchMore'), INBOX.indexOf('const handleLoadMore'));
    expect(fetchMore).toContain('setLoadMoreFailed(true)');
    const loadMore = INBOX.slice(INBOX.indexOf('const handleLoadMore')).slice(0, 300);
    expect(loadMore).toMatch(/if \(!hasMore \|\| loadMoreFailed\) return;/);
    expect(INBOX).toContain('accessibilityLabel="Retry loading more notifications"');
    expect(INBOX).toContain('Couldn’t load more · Try again');
  });
});
