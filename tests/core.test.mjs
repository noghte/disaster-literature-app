import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCSV, prepareRecords } from '../scripts/prepare-data.mjs';
import { DEFAULTS, validateFilters, valuesFor, matches, counts, crossCounts, summarize, rankRecords, csvExport } from '../public/core.js';

const article = { pmid: '1', title: 'Resilience after floods', authors: 'García A', year: 2020, analysis: true, disaster_type_primary: 'multiple', disaster_type_all: 'flood; earthquake; flood', mental_health_outcome_primary: 'resilience/growth', mental_health_outcome_all: '', participant_country_primary: 'Japan', sample_size: '120' };

test('CSV handles Unicode, quoted delimiters, escaped quotes, multiline text, and empty cells', () => {
  assert.deepEqual(parseCSV('id,text,empty\r\n1,"café, \"\"quoted\"\"\nline",\r\n2,NA,""'), [['id', 'text', 'empty'], ['1', 'café, "quoted"\nline', ''], ['2', 'NA', '']]);
  assert.throws(() => parseCSV('a\n"open'), /Unterminated/);
});

test('screening follows title, DOI, parse-error, relevance order and retains first records', () => {
  const columns = ['pmid', 'title', 'doi', 'year', 'day', 'parse_error', 'article_relevance'];
  const row = (pmid, title, doi, parse = 'NA', relevance = 'disaster and mental health') => [pmid, title, doi, '2020', 'NA', parse, relevance];
  const { records, exclusions } = prepareRecords([columns, row('1', 'A', '10.1/a'), row('2', 'A', '10.1/b'), row('3', 'B', '10.1/a'), row('4', 'C', 'NA', 'TRUE'), row('5', 'D', '', 'NA', 'mental health only'), row('6', 'E', '')]);
  assert.deepEqual(records.map(r => r.analysis), [true, false, false, false, false, true]);
  assert.deepEqual(exclusions, { duplicate_title: 1, duplicate_doi: 1, parse_error: 1, out_of_scope: 1 });
  assert.equal(records[0].day, null);
  assert.throws(() => prepareRecords([columns, row('1', 'A', ''), row('1', 'B', '')]), /duplicate PMID/);
});

test('filters combine with AND, support phrases and accented authors, and preserve undated records', () => {
  assert.equal(matches(article, { ...DEFAULTS, disaster: 'flood', outcome: 'resilience/growth', q: '"after floods" Garcia' }), true);
  assert.equal(matches(article, { ...DEFAULTS, disaster: 'flood', country: 'Canada' }), false);
  assert.equal(matches({ ...article, year: null }, DEFAULTS), true);
  assert.equal(matches({ ...article, year: null }, { ...DEFAULTS, start: '2000' }), false);
  assert.equal(matches(article, { ...DEFAULTS, q: 'longitudinal' }, { 1: 'A longitudinal cohort' }), false);
  assert.equal(matches(article, { ...DEFAULTS, q: 'longitudinal', abstracts: true }, { 1: 'A longitudinal cohort' }), true);
  assert.equal(matches({ ...article, analysis: false }, DEFAULTS), false);
  assert.equal(matches({ ...article, analysis: false }, { ...DEFAULTS, scope: 'all' }), true);
  assert.equal(matches(article, { ...DEFAULTS, minSample: '121' }), false);
  assert.equal(matches({ ...article, sample_size: '1150 to 1644' }, { ...DEFAULTS, minSample: '1' }), false);
});

test('category and cross-tab counts count an article once per category with explicit primary fallback', () => {
  assert.deepEqual(valuesFor(article, 'disaster'), ['flood', 'earthquake']);
  assert.deepEqual(valuesFor(article, 'outcome'), ['resilience/growth']);
  assert.deepEqual(valuesFor(article, 'disaster', 'primary'), ['multiple']);
  assert.deepEqual(counts([article], 'disaster'), [['earthquake', 1], ['flood', 1]]);
  assert.equal(crossCounts([article], 'disaster', 'outcome').get(JSON.stringify(['flood', 'resilience/growth'])), 1);
});

test('summary handles empty selections, median sample sizes, and missing participant countries', () => {
  const summary = summarize([article, { ...article, pmid: '2', year: null, sample_size: '200', participant_country_primary: 'unclear' }]);
  assert.equal(summary.medianSample, 160);
  assert.equal(summary.samples, 2);
  assert.equal(summary.unspecifiedCountry, 1);
  assert.equal(summary.missingYears, 1);
  assert.deepEqual(summary.years, [2020, 2020]);
  assert.equal(summarize([]).medianSample, null);
  assert.equal(summarize([]).years, null);
});

test('invalid filter input is rejected before searching', () => {
  for (const input of [null, [], { scope: 'private' }, { q: 5 }, { abstracts: 'true' }, { start: '2025', end: '2020' }, { minSample: '-1' }]) assert.throws(() => validateFilters(input));
});

test('retrieval prioritizes relevant article titles and abstracts', () => {
  const unrelated = { ...article, pmid: '2', title: 'Radiation events', year: 2026 };
  assert.equal(rankRecords([unrelated, article], 'Resilience floods')[0].pmid, '1');
  assert.equal(rankRecords([unrelated, article], 'longitudinal', { 1: 'longitudinal study' })[0].pmid, '1');
});

test('CSV exports preserve empty vs missing values and prevent spreadsheet formula execution', () => {
  const csv = csvExport([{ a: '', b: null, c: '=HYPERLINK("bad")', d: true }], ['a', 'b', 'c', 'd']);
  assert.deepEqual(parseCSV(csv)[1], ['', 'NA', '\'=HYPERLINK("bad")', 'TRUE']);
  assert.equal(parseCSV(csvExport([{ a: '  =1+1' }], ['a']))[1][0], "'  =1+1");
});

test('real dataset reconciles the manuscript corpus and reported PTSD count', async () => {
  const { records, manifest } = JSON.parse(await readFile(new URL('../public/data/index.json', import.meta.url), 'utf8'));
  assert.equal(manifest.total, 7859);
  assert.equal(records.filter(r => r.analysis).length, 5614);
  assert.deepEqual(manifest.exclusions, { duplicate_title: 9, duplicate_doi: 3, parse_error: 6, out_of_scope: 2227 });
  assert.equal(counts(records.filter(r => r.analysis), 'outcome').find(([value]) => value === 'PTSD')[1], 2082);
  for (const [key] of Object.entries({ disaster: 1, outcome: 1, country: 1, method: 1, type: 1 })) {
    for (const mode of ['all', 'primary']) for (const [value] of counts(records, key, mode)) assert.doesNotThrow(() => validateFilters({ [key]: value, mode }));
  }
});
