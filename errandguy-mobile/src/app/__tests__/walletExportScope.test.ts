import fs from 'fs';
import path from 'path';

/**
 * A transaction export must not misrepresent itself.
 *
 * The wallet list fetches one server page (20 rows) and has no load-more, so
 * "Export transactions" handed over a CSV of the 20 most recent rows under the
 * name "errandguy-transactions-<date>.csv" — a file that looks like a complete
 * financial record and silently isn't. A short on-screen list is visibly
 * short; an authoritative-looking export that omits ten months of spending is
 * the kind of thing someone reconciles their money against.
 *
 * The export now walks the full ledger. Guarded by source shape because the
 * screen needs expo-file-system, expo-sharing and the api graph to run.
 */
const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '(customer)', 'wallet', 'index.tsx'),
  'utf8',
);

describe('wallet export scope', () => {
  it('exports a freshly walked ledger, not the rows on screen', () => {
    expect(SOURCE).toContain('const rows = await fetchAllTransactions(txFilter)');
    expect(SOURCE).toContain('buildTransactionsCsv(rows.items)');
    // The old bug in one line: building straight from the on-screen page.
    expect(SOURCE).not.toContain('buildTransactionsCsv(txList)');
  });

  it('pages the request rather than asking for everything at once', () => {
    // One enormous request is what times out on a long history.
    expect(SOURCE).toMatch(/EXPORT_PAGE_SIZE\s*=\s*\d+/);
    expect(SOURCE).toContain('per_page: EXPORT_PAGE_SIZE');
    expect(SOURCE).toMatch(/for \(let page = 1; ; page\+\+\)/);
  });

  it('terminates on a short page AND on an empty one', () => {
    // The short-page check covers both: a final partial page and a server that
    // keeps answering 200 past the end.
    expect(SOURCE).toMatch(/batch\.length < EXPORT_PAGE_SIZE/);
  });

  it('is bounded, so a broken paginator cannot loop forever', () => {
    expect(SOURCE).toMatch(/EXPORT_MAX_ROWS\s*=\s*\d+/);
    expect(SOURCE).toMatch(/items\.length >= EXPORT_MAX_ROWS/);
  });

  it('SAYS SO when the file is not the complete history', () => {
    // Silent truncation is the exact defect being fixed; hitting the ceiling
    // must be reported, not swallowed.
    expect(SOURCE).toContain('truncated: true');
    expect(SOURCE).toMatch(/if \(rows\.truncated\)/);
    expect(SOURCE).toMatch(/most recent transactions/);
  });

  it('honours the active type filter', () => {
    expect(SOURCE).toMatch(/\.\.\.\(type \? \{ type \} : \{\}\)/);
    // …and the export callback depends on it, so switching filter can't leave
    // a stale closure exporting the wrong slice.
    expect(SOURCE).toMatch(/\[exporting, txList, txFilter\]/);
  });
});
