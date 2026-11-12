import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!field || quoted) quoted = !quoted;
      else throw new Error('Unexpected quote in CSV');
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      row.push(field); rows.push(row); row = []; field = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else field += char;
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function prepareRecords(matrix) {
  const [columns, ...rows] = matrix;
  if (!columns?.includes('pmid') || new Set(columns).size !== columns.length) throw new Error('Invalid CSV header');
  const titles = new Set(), dois = new Set(), pmids = new Set();
  const exclusions = { duplicate_title: 0, duplicate_doi: 0, parse_error: 0, out_of_scope: 0 };
  const records = rows.map((row, index) => {
    if (row.length !== columns.length) throw new Error(`Invalid column count at row ${index + 2}`);
    const record = Object.fromEntries(columns.map((key, i) => [key, row[i] === 'NA' ? null : row[i]]));
    if (!/^\d+$/.test(record.pmid) || pmids.has(record.pmid)) throw new Error('Invalid or duplicate PMID');
    pmids.add(record.pmid);
    for (const key of ['year', 'day']) {
      if (record[key] !== null && !/^\d+$/.test(record[key])) throw new Error(`Invalid ${key}`);
      if (record[key] !== null) record[key] = Number(record[key]);
    }
    if (record.parse_error !== null && !['TRUE', 'FALSE'].includes(record.parse_error)) throw new Error('Invalid logical value');
    record.parse_error = record.parse_error === null ? null : record.parse_error === 'TRUE';
    let exclusion = null;
    if (titles.has(record.title)) exclusion = 'duplicate_title';
    else {
      titles.add(record.title);
      if (record.doi && dois.has(record.doi)) exclusion = 'duplicate_doi';
      else {
        if (record.doi) dois.add(record.doi);
        if (record.parse_error) exclusion = 'parse_error';
        else if (record.article_relevance !== 'disaster and mental health') exclusion = 'out_of_scope';
      }
    }
    if (exclusion) exclusions[exclusion]++;
    return { ...record, analysis: exclusion === null, exclusion, shard: Math.floor(index / 100) };
  });
  return { records, columns, exclusions };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = resolve(process.argv[2] || join(root, '..', 'pubmed_disaster_mental_health_llm_final.csv'));
  const raw = await readFile(source, 'utf8');
  const { records, columns, exclusions } = prepareRecords(parseCSV(raw));
  const data = join(root, 'public', 'data');
  await rm(data, { recursive: true, force: true });
  await mkdir(join(data, 'records'), { recursive: true });
  const index = records.map(({ abstract, references, affiliations, ...record }) => ({
    ...record, excerpt: (abstract || '').slice(0, 240)
  }));
  const manifest = {
    source: 'pubmed_disaster_mental_health_llm_final.csv',
    sha256: createHash('sha256').update(raw).digest('hex'),
    columns, total: records.length, analysis: records.filter(r => r.analysis).length,
    exclusions, retrieved: 'May 2026', shardSize: 100
  };
  await writeFile(join(data, 'index.json'), JSON.stringify({ manifest, records: index }));
  await writeFile(join(data, 'abstracts.json'), JSON.stringify(Object.fromEntries(records.map(r => [r.pmid, r.abstract]))));
  for (let start = 0; start < records.length; start += 100) {
    await writeFile(join(data, 'records', `${start / 100}.json`), JSON.stringify(Object.fromEntries(records.slice(start, start + 100).map(r => [r.pmid, r]))));
  }
  await copyFile(resolve(process.argv[3] || join(root, '..', '2611.10390v1.pdf')), join(root, 'public', 'paper.pdf'));
  console.log(`Prepared ${manifest.total.toLocaleString()} source records; ${manifest.analysis.toLocaleString()} in the analysis corpus.`, exclusions);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
