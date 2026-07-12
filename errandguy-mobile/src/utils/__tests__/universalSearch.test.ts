import {
  MatchRank,
  normalizeText,
  scoreMatch,
  scoreFields,
  rankBy,
  rankAndCount,
  highlightSegments,
} from '../universalSearch';

describe('normalizeText', () => {
  it('lower-cases and trims', () => {
    expect(normalizeText('  HeLLo  ')).toBe('hello');
  });

  it('coerces non-strings and tolerates null/undefined', () => {
    expect(normalizeText(123)).toBe('123');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('scoreMatch', () => {
  it('ranks exact > prefix > substring > none', () => {
    expect(scoreMatch('doc', 'doc')).toBe(MatchRank.Exact);
    expect(scoreMatch('doc', 'document delivery')).toBe(MatchRank.Prefix);
    expect(scoreMatch('doc', 'my document')).toBe(MatchRank.Substring);
    expect(scoreMatch('doc', 'groceries')).toBe(MatchRank.None);
  });

  it('is case-insensitive on both sides', () => {
    expect(scoreMatch('DOC', 'doc')).toBe(MatchRank.Exact);
    expect(scoreMatch('doc', 'DOCUMENT')).toBe(MatchRank.Prefix);
  });

  it('scores an empty query or empty field as none', () => {
    expect(scoreMatch('', 'anything')).toBe(MatchRank.None);
    expect(scoreMatch('   ', 'anything')).toBe(MatchRank.None);
    expect(scoreMatch('doc', '')).toBe(MatchRank.None);
    expect(scoreMatch('doc', null)).toBe(MatchRank.None);
  });

  it('matches numeric-ish fields like amounts', () => {
    expect(scoreMatch('250', 250)).toBe(MatchRank.Exact);
    expect(scoreMatch('25', 250)).toBe(MatchRank.Prefix);
  });
});

describe('scoreFields', () => {
  it('returns the best score across fields', () => {
    expect(scoreFields('doc', ['groceries', 'a document', 'doc'])).toBe(
      MatchRank.Exact,
    );
    expect(scoreFields('doc', ['groceries', 'document run'])).toBe(
      MatchRank.Prefix,
    );
    expect(scoreFields('zzz', ['groceries', 'document'])).toBe(MatchRank.None);
  });
});

describe('rankBy', () => {
  interface Row {
    name: string;
    code: string;
  }
  const rows: Row[] = [
    { name: 'Grocery run', code: 'A1' }, // substring for "gro"? -> "grocery" prefix
    { name: 'Document delivery', code: 'B2' },
    { name: 'gro', code: 'C3' }, // exact for "gro"
    { name: 'The gro shop', code: 'D4' }, // substring for "gro"
    { name: 'Groceries', code: 'E5' }, // prefix for "gro"
  ];
  const getFields = (r: Row) => [r.name, r.code];

  it('orders exact, then prefix, then substring; drops non-matches', () => {
    const result = rankBy('gro', rows, getFields).map((r) => r.name);
    expect(result).toEqual([
      'gro', // exact
      'Grocery run', // prefix (original order before Groceries)
      'Groceries', // prefix
      'The gro shop', // substring
    ]);
    // "Document delivery" never matches and is dropped.
    expect(result).not.toContain('Document delivery');
  });

  it('is stable within a tier (preserves original order)', () => {
    const sameTier: Row[] = [
      { name: 'apple pie', code: '1' },
      { name: 'apple tart', code: '2' },
      { name: 'apple cake', code: '3' },
    ];
    // All three are prefix matches for "apple" — order must be untouched.
    const result = rankBy('apple', sameTier, (r) => [r.name]).map(
      (r) => r.code,
    );
    expect(result).toEqual(['1', '2', '3']);
  });

  it('returns nothing for an empty query', () => {
    expect(rankBy('', rows, getFields)).toEqual([]);
    expect(rankBy('   ', rows, getFields)).toEqual([]);
  });

  it('honours the limit option', () => {
    expect(rankBy('gro', rows, getFields, { limit: 2 })).toHaveLength(2);
  });
});

describe('rankAndCount', () => {
  const items = ['gro', 'grocery', 'groceries', 'the gro', 'unrelated'];
  const getFields = (s: string) => [s];

  it('caps items but reports the true total', () => {
    const { items: capped, total } = rankAndCount('gro', items, getFields, 2);
    expect(capped).toHaveLength(2);
    expect(total).toBe(4); // four rows match "gro", one is unrelated
  });

  it('total is zero when nothing matches', () => {
    const { items: capped, total } = rankAndCount('zzz', items, getFields, 8);
    expect(capped).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('highlightSegments', () => {
  it('marks a single case-insensitive occurrence', () => {
    expect(highlightSegments('gro', 'My Grocery run')).toEqual([
      { text: 'My ', hit: false },
      { text: 'Gro', hit: true },
      { text: 'cery run', hit: false },
    ]);
  });

  it('marks every occurrence, including back-to-back hits', () => {
    expect(highlightSegments('an', 'Banana Land')).toEqual([
      { text: 'B', hit: false },
      { text: 'an', hit: true },
      { text: 'an', hit: true },
      { text: 'a L', hit: false },
      { text: 'an', hit: true },
      { text: 'd', hit: false },
    ]);
  });

  it('handles hits at the start and end of the text', () => {
    expect(highlightSegments('doc', 'doc')).toEqual([{ text: 'doc', hit: true }]);
    expect(highlightSegments('run', 'grocery run')).toEqual([
      { text: 'grocery ', hit: false },
      { text: 'run', hit: true },
    ]);
  });

  it('returns one non-hit segment for an empty or whitespace query', () => {
    expect(highlightSegments('', 'hello')).toEqual([{ text: 'hello', hit: false }]);
    expect(highlightSegments('   ', 'hello')).toEqual([{ text: 'hello', hit: false }]);
  });

  it('returns an empty array for empty text', () => {
    expect(highlightSegments('doc', '')).toEqual([]);
  });

  it('concatenated segments always reproduce the original text', () => {
    const text = 'ErrandGuy grocery + Grocery GROCERY';
    const joined = highlightSegments('grocery', text)
      .map((s) => s.text)
      .join('');
    expect(joined).toBe(text);
  });
});
