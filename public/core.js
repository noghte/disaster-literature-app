export const DEFAULTS = Object.freeze({ scope: 'analysis', q: '', disaster: '', outcome: '', country: '', method: '', type: '', start: '', end: '', minSample: '', mode: 'all', abstracts: false });
export const DIMENSIONS = {
  disaster: { primary: 'disaster_type_primary', all: 'disaster_type_all', label: 'Disaster' },
  outcome: { primary: 'mental_health_outcome_primary', all: 'mental_health_outcome_all', label: 'Mental health outcome' },
  country: { primary: 'participant_country_primary', all: 'participant_country_all', label: 'Participant country' },
  method: { primary: 'analytical_method_primary', all: 'analytical_method_all', label: 'Analytical method' },
  type: { primary: 'article_type', label: 'Article type' }
};
export const UNSPECIFIED = new Set(['unclear', 'not applicable', 'none', 'multiple', 'multiple countries', 'other']);
export const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export const terms = query => [...normalize(query).matchAll(/"([^"]+)"|(\S+)/g)].map(match => match[1] || match[2]);
export const searchText = record => normalize([record.pmid, record.title, record.authors, record.journal, record.doi, record.keywords, ...Object.values(DIMENSIONS).flatMap(d => [record[d.primary], record[d.all]])].filter(Boolean).join(' '));

export function validateFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid filters');
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input)) continue;
    if (key === 'abstracts') {
      if (typeof input[key] !== 'boolean') throw new Error('Invalid abstract-search option');
    } else if (typeof input[key] !== 'string' || input[key].length > (key === 'q' ? 300 : 200)) throw new Error(`Invalid ${key} filter`);
    result[key] = input[key];
  }
  if (!['analysis', 'all'].includes(result.scope) || !['primary', 'all'].includes(result.mode)) throw new Error('Invalid corpus or counting mode');
  for (const key of ['start', 'end']) if (result[key] && !/^\d{4}$/.test(result[key])) throw new Error('Years must have four digits');
  if (result.start && result.end && Number(result.start) > Number(result.end)) throw new Error('Start year must be before end year');
  if (result.minSample && !/^\d{1,12}$/.test(result.minSample)) throw new Error('Minimum sample must be a nonnegative integer');
  return result;
}

export function valuesFor(record, dimension, mode = 'all') {
  const spec = DIMENSIONS[dimension];
  if (!spec) return [];
  const value = mode === 'all' && spec.all && record[spec.all]?.trim() ? record[spec.all] : record[spec.primary];
  return value ? [...new Set(value.split(';').map(s => s.trim()).filter(Boolean))] : [];
}

export function sampleNumber(record) {
  const value = record.sample_size;
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
}

export function matches(record, filters, abstracts = {}) {
  if (filters.scope === 'analysis' && !record.analysis) return false;
  if (filters.start && (record.year === null || record.year < Number(filters.start))) return false;
  if (filters.end && (record.year === null || record.year > Number(filters.end))) return false;
  if (filters.minSample && (sampleNumber(record) === null || sampleNumber(record) < Number(filters.minSample))) return false;
  for (const dimension of Object.keys(DIMENSIONS)) {
    if (filters[dimension] && !valuesFor(record, dimension, filters.mode).includes(filters[dimension])) return false;
  }
  if (!filters.q.trim()) return true;
  const text = record._search ?? searchText(record);
  const full = filters.abstracts ? `${text} ${normalize(abstracts[record.pmid])}` : text;
  return terms(filters.q).every(term => full.includes(term));
}

export function counts(records, dimension, mode = 'all') {
  const result = new Map();
  for (const record of records) for (const value of valuesFor(record, dimension, mode)) result.set(value, (result.get(value) || 0) + 1);
  return [...result].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function annualCounts(records) {
  const result = new Map();
  for (const record of records) if (record.year !== null) result.set(record.year, (result.get(record.year) || 0) + 1);
  return [...result].sort((a, b) => a[0] - b[0]);
}

export function crossCounts(records, x, y, mode = 'all') {
  const result = new Map();
  for (const record of records) for (const a of valuesFor(record, x, mode)) for (const b of valuesFor(record, y, mode)) {
    const key = JSON.stringify([a, b]);
    result.set(key, (result.get(key) || 0) + 1);
  }
  return result;
}

export function summarize(records, mode = 'all') {
  const samples = records.map(sampleNumber).filter(n => n !== null).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const years = records.map(r => r.year).filter(y => y !== null);
  return {
    total: records.length,
    years: years.length ? [Math.min(...years), Math.max(...years)] : null,
    missingYears: records.length - years.length,
    samples: samples.length,
    medianSample: samples.length ? (samples[(samples.length - 1) >> 1] + samples[mid]) / 2 : null,
    unspecifiedCountry: records.filter(r => !valuesFor(r, 'country', mode).some(c => !UNSPECIFIED.has(c))).length,
    dimensions: Object.fromEntries(Object.keys(DIMENSIONS).map(key => [key, counts(records, key, mode)])),
    annual: annualCounts(records)
  };
}

const STOP_WORDS = new Set('a an and are as at be by can did do does for from how in is it of on or that the these this to was were what when where which who why with studies study research literature mental health disaster disasters approach patterns outcomes methods'.split(' '));
export function rankRecords(records, question, abstracts = {}) {
  const words = terms(question).flatMap(t => t.split(/[^\p{L}\p{N}]+/u)).filter(t => t.length > 2 && !STOP_WORDS.has(t));
  return records.map(record => {
    const title = normalize(record.title), meta = record._search ?? searchText(record), abstract = normalize(abstracts[record.pmid]);
    const score = words.reduce((sum, word) => sum + (title.includes(word) ? 6 : 0) + (meta.includes(word) ? 2 : 0) + (abstract.includes(word) ? 1 : 0), 0);
    return { record, score };
  }).sort((a, b) => b.score - a.score || (b.record.year ?? 0) - (a.record.year ?? 0) || a.record.pmid.localeCompare(b.record.pmid)).map(item => item.record);
}

export function csvExport(records, columns) {
  const cell = value => {
    if (value === null || value === undefined) return 'NA';
    const text = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
    // Spreadsheet programs execute formula-like text; exports are for safe review.
    const safe = /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [columns.map(cell).join(','), ...records.map(record => columns.map(key => cell(record[key])).join(','))].join('\r\n');
}
