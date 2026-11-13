import { DEFAULTS, DIMENSIONS, UNSPECIFIED, validateFilters, searchText, valuesFor, matches, counts, annualCounts, crossCounts, summarize, rankRecords, csvExport } from './core.js';

const $ = selector => document.querySelector(selector);
const main = $('#main');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const n = value => value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 });
const pct = (part, total) => total ? `${(part / total * 100).toFixed(1)}%` : '0.0%';
const label = value => ({ PTSD: 'PTSD', NLP: 'Natural language processing', 'hypothesis testing/classical statistics': 'Classical statistics', 'structural equation modeling/path analysis': 'SEM / path analysis', 'mixed qualitative-quantitative study': 'Mixed methods study', 'mixed qualitative-quantitative methods': 'Mixed methods', 'neural network/deep learning': 'Deep learning', 'policy/commentary/editorial': 'Policy / commentary / editorial', 'empirical quantitative study': 'Quantitative empirical study' })[value] || (value ? value[0].toUpperCase() + value.slice(1) : 'Not reported');
const searchIcon = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const names = { paper: 'The paper', literature: 'Literature', map: 'Evidence map', insights: 'Insights' };
let records = [], manifest, filters = { ...DEFAULTS }, view = 'paper', page = 1, sort = 'newest';
let abstracts = {}, abstractsPromise, abstractLoading = false, apiConfig = null, question = '', aiAnswer = null, aiError = '', aiBusy = false;
let matrixX = 'disaster', matrixY = 'outcome', currentResults = [], activeRecord = null, noticeTimer;
const shards = new Map();

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()}`);
  return response.json();
}

function readURL() {
  const params = new URLSearchParams(location.search), next = { ...DEFAULTS };
  view = Object.hasOwn(names, params.get('view')) ? params.get('view') : 'paper';
  for (const key of Object.keys(DEFAULTS)) if (params.has(key)) next[key] = key === 'abstracts' ? params.get(key) === 'true' : params.get(key);
  try { filters = validateFilters(next); } catch { filters = { ...DEFAULTS }; notify('Invalid filters were reset.'); }
}

function writeURL(push = false) {
  const params = new URLSearchParams({ view });
  for (const [key, value] of Object.entries(filters)) if (value !== DEFAULTS[key]) params.set(key, String(value));
  history[push ? 'pushState' : 'replaceState']({}, '', `?${params}`);
}

function notify(text) {
  $('#notice').textContent = text;
  $('#notice').classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('#notice').classList.remove('visible'), 3800);
}

async function ensureAbstracts() {
  if (abstractsPromise) return abstractsPromise;
  abstractLoading = true;
  abstractsPromise = getJSON('/data/abstracts.json').then(data => { abstracts = data; }).catch(error => { abstractsPromise = null; throw error; }).finally(() => { abstractLoading = false; });
  return abstractsPromise;
}

function selectView(next, push = true) {
  view = next; page = 1; writeURL(push); render(); window.scrollTo({ top: 0 }); main.focus({ preventScroll: true });
}

async function updateFilters(patch, nextView) {
  try { filters = validateFilters({ ...filters, ...patch }); } catch (error) { notify(error.message); return; }
  page = 1; aiAnswer = null; aiError = '';
  if (nextView) view = nextView;
  if (filters.abstracts) {
    const loading = ensureAbstracts(); render();
    try { await loading; } catch { filters.abstracts = false; notify('Abstract search could not load. Metadata search is still available.'); }
  }
  writeURL(Boolean(nextView)); render();
  if (nextView) { window.scrollTo({ top: 0 }); main.focus({ preventScroll: true }); }
}

function option(value, current, text) { return `<option value="${escape(value)}"${value === current ? ' selected' : ''}>${escape(text ?? label(value))}</option>`; }
function header(title, description, number) {
  return `<div class="page-heading"><div><span class="eyebrow">${number} / THE RESEARCH COMPANION</span><h1>${title}</h1><p>${description}</p></div><button class="button-secondary" data-action="share">Copy view link <span aria-hidden="true">↗</span></button></div>`;
}
function scopebar() {
  return `<div class="scopebar"><label for="scope">Corpus<select id="scope" data-filter="scope">${option('analysis', filters.scope, 'Analysis corpus · 5,614')}${option('all', filters.scope, 'All source records · 7,859')}</select></label><label for="mode">Categories<select id="mode" data-filter="mode">${option('all', filters.mode, 'All coded categories')}${option('primary', filters.mode, 'Primary classification')}</select></label></div>`;
}
function selectionChips() {
  const chips = Object.entries(filters).filter(([key, value]) => value && !['scope', 'mode', 'abstracts'].includes(key));
  if (!chips.length) return '';
  const filterLabel = key => DIMENSIONS[key]?.label || ({ q: 'Search', start: 'From', end: 'Through', minSample: 'Minimum sample' })[key];
  return `<div class="selection-note"><span class="muted">Current selection</span>${chips.map(([key, value]) => `<span class="filter-chip">${escape(filterLabel(key))}: ${escape(value)}<button data-clear="${key}" aria-label="Remove ${escape(filterLabel(key))} filter">×</button></span>`).join('')}<button class="text-button" data-action="reset">Clear all</button></div>`;
}
function countingNote() {
  return `<p class="counting-note">${filters.mode === 'all' ? 'Each article counts once per coded category. Categories overlap; empty category lists use the primary classification.' : 'Each article is counted by its primary classification. “Multiple” and unspecified values remain separate categories.'} Participant country refers to study participants.</p>`;
}

function annualSVG(rows, interactive = true, compact = false) {
  const annual = annualCounts(rows);
  if (!annual.length) return '<p class="note">No dated publications in this selection.</p>';
  const first = Math.min(1970, annual[0][0]), last = Math.max(2026, annual.at(-1)[0]);
  const width = compact ? 310 : 960, height = compact ? 160 : 235, left = compact ? 3 : 44, right = 12, top = 12, bottom = compact ? 25 : 30;
  const w = width - left - right, h = height - top - bottom, max = Math.max(...annual.map(([, count]) => count)), step = w / (last - first + 1);
  const grid = compact ? '' : [0, .5, 1].map(f => `<line x1="${left}" x2="${width - right}" y1="${top + h * (1 - f)}" y2="${top + h * (1 - f)}" stroke="#e6eadf"/><text x="${left - 8}" y="${top + h * (1 - f) + 3}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
  const bars = annual.map(([year, count]) => `<rect x="${left + (year - first) * step + 1}" y="${top + h - count / max * h}" width="${Math.max(1, step - 2)}" height="${count / max * h}" rx="1" ${interactive ? `class="year-bar" tabindex="0" role="button" data-year="${year}" aria-label="View ${count} articles from ${year}"` : 'fill="#78916a"'} opacity="${year === 2026 ? '.5' : '1'}"><title>${year}: ${n(count)} articles${year === 2026 ? ' (partial year)' : ''}</title></rect>`).join('');
  const ticks = [first, 1980, 1990, 2000, 2010, 2020, last].filter((year, i, arr) => year >= first && year <= last && arr.indexOf(year) === i && (!compact || [first, 2000, last].includes(year))).map(year => `<text x="${left + (year - first + .5) * step}" y="${height - 7}" text-anchor="middle">${year}</text>`).join('');
  return `<svg class="annual-svg" viewBox="0 0 ${width} ${height}" role="${interactive ? 'group' : 'img'}" aria-label="Annual publication counts from ${first} to ${last}. 2026 is a partial year.">${grid}${bars}${ticks}</svg>`;
}

function paperPage() {
  return `<section class="hero" aria-labelledby="paper-title">
    <h1 id="paper-title">A Computational Map of the Disaster Mental Health Research Landscape</h1>
    <p class="authors">Soheil Shapouri &amp; Saber Soleymani<span>Lehigh University · Georgia State University</span></p>
    <p class="dek">Explore the topics, places, and methods across ${n(manifest.analysis)} articles on disasters and mental health.</p>
    <div class="button-row"><button class="button" data-view="literature">Explore the literature <span aria-hidden="true">↗</span></button><a class="button-secondary" href="https://arxiv.org/abs/2611.10390" target="_blank" rel="noopener">Read on arXiv <span aria-hidden="true">↗</span></a></div>
    <p class="hero-meta">PubMed · 1970–2026 · Retrieved May 2026</p>
    <p class="note">2026 coverage is partial. Counts describe research attention, not evidence quality or treatment effects.</p>
  </section>`;
}

function filterFields() {
  const base = records.filter(r => filters.scope === 'all' || r.analysis);
  return `<aside class="filters" aria-label="Literature filters"><div class="filter-head"><h2>Refine the literature</h2><button class="text-button" data-action="reset">Reset</button></div>${Object.entries(DIMENSIONS).map(([key, spec]) => `<div class="field"><label for="filter-${key}">${spec.label}</label><select id="filter-${key}" data-filter="${key}">${option('', filters[key], `All ${key === 'type' ? 'article types' : key === 'country' ? 'countries' : key === 'outcome' ? 'outcomes' : key === 'method' ? 'methods' : 'disasters'}`)}${counts(base, key, filters.mode).map(([value, count]) => option(value, filters[key], `${label(value)} (${n(count)})`)).join('')}</select></div>`).join('')}<div class="field"><label>Publication years</label><div class="year-fields"><input id="filter-start" data-filter="start" type="number" inputmode="numeric" min="1900" max="2100" value="${escape(filters.start)}" placeholder="From" aria-label="From publication year"><input id="filter-end" data-filter="end" type="number" inputmode="numeric" min="1900" max="2100" value="${escape(filters.end)}" placeholder="Through" aria-label="Through publication year"></div></div><div class="field"><label for="filter-minSample">Minimum reported sample</label><input id="filter-minSample" data-filter="minSample" type="number" min="0" step="1" inputmode="numeric" value="${escape(filters.minSample)}" placeholder="Any sample size"></div><p class="note">Filters combine with AND. Country means participant location. Sample units can differ across studies.</p></aside>`;
}

function sortedResults() {
  if (sort === 'relevance' && filters.q) return rankRecords(currentResults, filters.q, abstracts);
  return [...currentResults].sort((a, b) => sort === 'oldest' ? (a.year ?? 9999) - (b.year ?? 9999) : (b.year ?? 0) - (a.year ?? 0));
}
function articleRow(record) {
  const tags = ['disaster', 'outcome'].flatMap(d => valuesFor(record, d, filters.mode).slice(0, 2).map(value => `<span class="tag${d === 'disaster' ? ' category' : ''}">${escape(label(value))}</span>`));
  return `<article class="article-row"><div class="article-meta"><span class="article-year">${record.year || 'Year not reported'}</span><span>·</span><span>${escape(record.journal)}</span><span>·</span><span>PMID ${record.pmid}</span></div><h2 class="article-title"><button class="title-button" data-paper="${record.pmid}">${escape(record.title)}</button></h2><p class="article-authors">${escape(record.authors)}</p><p class="article-excerpt">${escape(record.excerpt)}${record.excerpt?.length >= 240 ? '…' : ''}</p><div class="tags">${tags.join('')}<span class="tag">${escape(label(record.article_type))}</span>${!record.analysis ? `<span class="tag flag">${record.exclusion === 'out_of_scope' ? 'Outside analysis scope' : escape(label(record.exclusion.replaceAll('_', ' ')))}</span>` : ''}</div></article>`;
}
function exportMenu() {
  return `<details class="results-menu"><summary class="button-small">Export results <span aria-hidden="true">↓</span></summary><div class="export-options"><button data-export="csv">Metadata CSV</button><button data-export="json">Metadata JSON</button></div></details>`;
}
function emptyState() { return '<div class="empty"><h2>No articles in this selection.</h2><p>Try a broader search, remove a filter, or switch to all source records.</p><button class="button-secondary" data-action="reset">Reset filters</button></div>'; }

function literaturePage() {
  const sorted = sortedResults(), pages = Math.max(1, Math.ceil(sorted.length / 15));
  page = Math.min(page, pages);
  return `${header('Explore the literature', 'Search the source records. Follow a question through the studies behind the map.', '02')}${scopebar()}<div class="search-wrap">${searchIcon}<input id="search" type="search" maxlength="300" value="${escape(filters.q)}" placeholder="Search titles, authors, keywords, journals, or PMID…" aria-label="Search the literature"></div><div class="search-options"><label class="check"><input id="abstracts" type="checkbox"${filters.abstracts ? ' checked' : ''}${abstractLoading ? ' disabled' : ''}>${abstractLoading ? 'Loading abstracts…' : 'Include full abstracts'}</label><span>Use quotes for an exact phrase. Terms combine with AND.</span></div>${selectionChips()}<div class="explorer-layout">${filterFields()}<section aria-label="Search results"><div class="results-toolbar"><span class="result-count" role="status"><strong>${n(sorted.length)}</strong> articles${filters.scope === 'analysis' ? ' in the analysis corpus' : ' in the source corpus'}</span><div class="button-row"><label class="screen-reader-only" for="sort">Sort results</label><select id="sort">${option('newest', sort, 'Newest first')}${option('oldest', sort, 'Oldest first')}${option('relevance', sort, 'Relevance')}</select>${exportMenu()}</div></div>${sorted.length ? sorted.slice((page - 1) * 15, page * 15).map(articleRow).join('') : emptyState()}${sorted.length ? `<div class="pagination"><span>${n((page - 1) * 15 + 1)}–${n(Math.min(page * 15, sorted.length))} of ${n(sorted.length)}</span><div class="button-row"><button class="button-small" data-page="${page - 1}"${page === 1 ? ' disabled' : ''}>← Previous</button><span>${page} / ${pages}</span><button class="button-small" data-page="${page + 1}"${page === pages ? ' disabled' : ''}>Next →</button></div></div>` : ''}<p class="note">Metadata exports reflect the current filters and omit abstracts, affiliations, and references. Full original fields are available in each article’s record.</p></section></div>`;
}

function bars(dimension, title, limit = 8) {
  const entries = counts(currentResults, dimension, filters.mode).slice(0, limit), max = entries[0]?.[1] || 1;
  return `<section class="panel chart-panel"><div class="panel-title"><div><h2>${title}</h2><p class="note">${DIMENSIONS[dimension].label} · top ${limit} classifications</p></div></div><div class="bar-list">${entries.map(([value, count]) => `<button class="bar-item" data-dimension="${dimension}" data-value="${escape(value)}" title="${escape(label(value))}: ${n(count)} articles (${pct(count, currentResults.length)})"><span class="bar-label">${escape(label(value))}</span><span class="bar-track"><span class="bar-fill" style="width:${count / max * 100}%"></span></span><span class="bar-value">${n(count)}</span></button>`).join('')}</div><p class="chart-footnote">Select a bar to inspect its articles.</p></section>`;
}

function matrix() {
  const xs = counts(currentResults, matrixX, filters.mode).filter(([value]) => !UNSPECIFIED.has(value)).slice(0, 8);
  const ys = counts(currentResults, matrixY, filters.mode).filter(([value]) => !UNSPECIFIED.has(value)).slice(0, 8);
  const cells = crossCounts(currentResults, matrixX, matrixY, filters.mode);
  const max = Math.max(1, ...xs.flatMap(([a]) => ys.map(([b]) => cells.get(JSON.stringify([a, b])) || 0)));
  const colors = ['#f1f4ed', '#dce7ce', '#b4cb9e', '#7f9c74', '#4d7157', '#294e3d'];
  return `<section class="panel chart-panel wide"><div class="panel-title"><div><h2>Where topics intersect</h2><p class="note">Top named categories in this selection. Select a cell to open the underlying literature.</p></div><div class="chart-toolbar"><label class="screen-reader-only" for="matrix-x">Matrix rows</label><select id="matrix-x">${Object.entries(DIMENSIONS).map(([key, spec]) => option(key, matrixX, spec.label)).join('')}</select><span>×</span><label class="screen-reader-only" for="matrix-y">Matrix columns</label><select id="matrix-y">${Object.entries(DIMENSIONS).map(([key, spec]) => option(key, matrixY, spec.label)).join('')}</select></div></div><div class="matrix-wrap"><table class="matrix"><caption class="screen-reader-only">Article counts by ${DIMENSIONS[matrixX].label} and ${DIMENSIONS[matrixY].label}</caption><thead><tr><th scope="col">${DIMENSIONS[matrixX].label} ↓</th>${ys.map(([value]) => `<th scope="col">${escape(label(value))}</th>`).join('')}</tr></thead><tbody>${xs.map(([a]) => `<tr><th scope="row">${escape(label(a))}</th>${ys.map(([b]) => {
    const count = cells.get(JSON.stringify([a, b])) || 0, level = count ? Math.min(5, Math.ceil(Math.sqrt(count / max) * 5)) : 0;
    return `<td><button data-cell-x="${escape(a)}" data-cell-y="${escape(b)}" style="--heat:${colors[level]};--heat-text:${level >= 4 ? '#fff' : '#385339'}" aria-label="${escape(a)} and ${escape(b)}: ${n(count)} articles">${count ? n(count) : '–'}</button></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div><div class="matrix-legend"><span>Fewer</span>${colors.map(color => `<i style="--heat:${color}"></i>`).join('')}<span>More articles</span></div><p class="chart-footnote">Unspecified classifications are omitted from this matrix. Low counts identify sparse coverage in this corpus; they do not measure research need.</p></section>`;
}
function mapPage() {
  return `${header('The shape of the evidence', 'Follow the growth, concentrations, and intersections of disaster mental health research.', '03')}${scopebar()}${selectionChips()}<div class="selection-context">${n(currentResults.length)} articles in the current selection · <button class="text-button" data-view="literature">Refine in literature</button> · ${exportMenu()}</div>${countingNote()}${currentResults.length ? `<div class="chart-grid"><section class="panel chart-panel wide"><div class="panel-title"><div><h2>Research over time</h2><p class="note">Annual article counts · select a year to explore</p></div><span class="mini-label">${n(currentResults.length)} ARTICLES</span></div>${annualSVG(currentResults)}<p class="chart-footnote">2026 covers January–May only. ${n(currentResults.filter(r => r.year === null).length)} records have no publication year and are omitted from this chart.</p></section>${bars('disaster', 'Disasters in focus')}${bars('outcome', 'Mental health outcomes')}${matrix()}${bars('country', 'Where participants are studied')}${bars('method', 'How the field studies them')}</div>` : emptyState()}`;
}

function insightsPage() {
  const summary = summarize(currentResults, filters.mode), total = currentResults.length;
  const top = dimension => summary.dimensions[dimension].find(([value]) => !UNSPECIFIED.has(value));
  const disaster = top('disaster'), outcome = top('outcome'), method = top('method');
  const sparse = summary.dimensions.disaster.filter(([value]) => !UNSPECIFIED.has(value)).sort((a, b) => a[1] - b[1]).slice(0, 3);
  return `${header('Questions worth following', 'Read descriptive patterns in your selection, then look more closely at the articles behind them.', '04')}${scopebar()}${selectionChips()}<div class="selection-context">${n(total)} articles in this selection · <button class="text-button" data-view="literature">Refine the selection</button></div>${countingNote()}${!total ? emptyState() : `<div class="insight-summary"><div class="insight-stat"><span class="mini-label">CURRENT SELECTION</span><strong>${n(total)}</strong><p>${summary.years ? `${summary.years[0]}–${summary.years[1]}` : 'No dated records'} · ${filters.scope === 'analysis' ? 'analysis corpus' : 'all source records'}</p></div><div class="insight-stat"><span class="mini-label">MEDIAN SAMPLE</span><strong>${n(summary.medianSample)}</strong><p>Across ${n(summary.samples)} numeric values; units vary</p></div><div class="insight-stat"><span class="mini-label">COUNTRY UNSPECIFIED</span><strong>${pct(summary.unspecifiedCountry, total)}</strong><p>No named participant country coded</p></div></div><div class="insight-layout"><section class="panel"><h2>A closer look at this selection</h2><p class="note">Calculated from the records, without AI.</p>${disaster ? `<div class="insight-item"><h3>${escape(label(disaster[0]))} receives the most attention</h3><p>${n(disaster[1])} articles (${pct(disaster[1], total)}) are coded for this disaster. ${outcome ? `${escape(label(outcome[0]))} is the leading named outcome, appearing in ${n(outcome[1])} articles.` : ''}</p><button class="text-button" data-dimension="disaster" data-value="${escape(disaster[0])}">Inspect these studies ↗</button></div>` : ''}${method ? `<div class="insight-item"><h3>The most represented analytical approach</h3><p>${escape(label(method[0]))} is coded in ${n(method[1])} articles (${pct(method[1], total)}) using the selected category mode.</p><button class="text-button" data-dimension="method" data-value="${escape(method[0])}">Explore the methods ↗</button></div>` : ''}<div class="insight-item"><h3>Less represented disaster categories</h3><p>${sparse.map(([value, count]) => `${escape(label(value))} (${n(count)})`).join('; ') || 'No named disaster categories in this selection'}. These are observed counts, not an assessment of evidence quality or research priorities.</p><button class="text-button" data-view="map">Examine the intersections ↗</button></div><div class="insight-item"><h3>Keep the evidence in context</h3><p>Country classifications may be unclear or not applicable. Sample sizes can count participants, weighted populations, or other units. Partial 2026 data should not be read as a full-year decline.</p></div></section><section class="panel ai-panel"><div class="panel-title"><div><h2>Ask the literature</h2><p class="note">Optional, abstract-grounded AI synthesis.</p></div><span class="ai-label${!apiConfig?.enabled ? ' off' : ''}">${apiConfig === null ? 'CHECKING' : apiConfig.enabled ? 'AVAILABLE' : 'NOT CONFIGURED'}</span></div><p class="note">A question retrieves up to 12 matching abstract excerpts from your selection. Every response includes its sources and the selection’s aggregate counts.</p><div class="prompts"><button class="prompt" data-question="What methodological patterns appear in this selection?">Methodological patterns</button><button class="prompt" data-question="What does this literature say about resilience after floods?">Resilience after floods</button><button class="prompt" data-question="Which participant populations are represented in these articles?">Participant populations</button></div><form id="insight-form"><div class="field"><label for="question">Your research question</label><textarea id="question" maxlength="1500" minlength="8" required placeholder="For example, how has wildfire research approached resilience?">${escape(question)}</textarea></div>${apiConfig?.enabled ? '<div class="field"><label for="author-password">Author passphrase</label><input id="author-password" type="password" autocomplete="current-password" maxlength="256" required placeholder="Enter the shared author passphrase"></div>' : ''}<button class="button" type="submit"${!apiConfig?.enabled || aiBusy ? ' disabled' : ''}>${aiBusy ? 'Reading the selected abstracts…' : 'Generate cited synthesis'} <span aria-hidden="true">↗</span></button></form>${!apiConfig?.enabled ? '<div class="ai-config">AI synthesis is optional and has not been enabled by the app owner. All search, charts, exports, and descriptive insights are available.</div>' : '<p class="note" style="margin-top:14px">Selected abstracts and your question are sent to OpenAI. Generated interpretations should be checked against the original publications.</p>'}${aiError ? `<div class="ai-error" role="alert">${escape(aiError)}</div>` : ''}${aiAnswer ? answerHTML() : ''}</section></div>`}`;
}

function answerHTML() {
  const sources = new Map(aiAnswer.sources.map(source => [source.number, source]));
  const text = escape(aiAnswer.text).replace(/\[(\d+)\]/g, (match, index) => sources.has(Number(index)) ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${sources.get(Number(index)).pmid}/" target="_blank" rel="noopener">${match}</a>` : match);
  return `<div class="ai-answer" role="status"><p class="note">${escape(aiAnswer.question)}</p>${text}</div>${aiAnswer.truncated ? '<p class="note">The provider reached its output limit; this answer may be incomplete.</p>' : ''}<div class="ai-sources"><h3>${aiAnswer.sources.length} retrieved abstracts · ${n(aiAnswer.total)} articles in the selection</h3>${aiAnswer.sources.map(source => `<button class="ai-source" data-paper="${source.pmid}">[${source.number}] ${escape(source.title)} (${source.year || 'year not reported'}) ↗</button>`).join('')}</div>`;
}

function render() {
  if (!manifest) return;
  const focused = document.activeElement, focusId = focused?.id, selectionStart = focused?.selectionStart, selectionEnd = focused?.selectionEnd;
  const password = $('#author-password')?.value;
  currentResults = records.filter(record => matches(record, filters, abstracts));
  main.innerHTML = ({ paper: paperPage, literature: literaturePage, map: mapPage, insights: insightsPage })[view]();
  $('#breadcrumb').textContent = names[view];
  document.title = `${names[view]} — Fieldnotes`;
  document.querySelectorAll('.nav-item').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  if (password && $('#author-password')) $('#author-password').value = password;
  if (focusId && document.getElementById(focusId)) {
    const next = document.getElementById(focusId); next.focus({ preventScroll: true });
    if (typeof selectionStart === 'number' && ['text', 'search', 'textarea'].includes(next.type)) next.setSelectionRange(selectionStart, selectionEnd);
  }
}

async function loadRecord(pmid) {
  const record = records.find(item => item.pmid === pmid);
  if (!record) throw new Error('This article is not in the dataset.');
  if (!shards.has(record.shard)) shards.set(record.shard, getJSON(`/data/records/${record.shard}.json`).catch(error => { shards.delete(record.shard); throw error; }));
  return (await shards.get(record.shard))[pmid];
}

async function openArticle(pmid) {
  const dialog = $('#article-dialog'); activeRecord = pmid;
  $('#article-content').innerHTML = '<div class="dialog-top"><span class="eyebrow">ARTICLE RECORD</span><button class="close-button" data-action="close" aria-label="Close article">×</button></div><div class="dialog-body"><h2 id="article-title">Loading the article…</h2></div>';
  if (!dialog.open) dialog.showModal();
  try {
    const record = await loadRecord(pmid);
    if (activeRecord !== pmid) return;
    const fields = manifest.columns.filter(key => !['pmid', 'title', 'abstract', 'authors', 'journal', 'year', 'doi', 'affiliations', 'references'].includes(key));
    $('#article-content').innerHTML = `<div class="dialog-top"><span class="eyebrow">ARTICLE RECORD · PMID ${record.pmid}</span><button class="close-button" data-action="close" aria-label="Close article">×</button></div><div class="dialog-body">${!record.analysis ? `<div class="record-notice">Excluded from the manuscript analysis: ${escape(record.exclusion.replaceAll('_', ' '))}. The original source record is preserved.</div>` : ''}<div class="article-meta"><span>${record.year || 'Year not reported'}</span><span>·</span><span>${escape(record.journal)}</span></div><h2 class="record-title" id="article-title">${escape(record.title)}</h2><p class="authors">${escape(record.authors)}</p><div class="button-row"><a class="button" href="https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/" target="_blank" rel="noopener">View in PubMed ↗</a>${record.doi && /^10\.\d{4,9}\//.test(record.doi) ? `<a class="button-secondary" href="https://doi.org/${escape(encodeURI(record.doi).replaceAll('"', '%22'))}" target="_blank" rel="noopener">Publisher ↗</a>` : ''}<button class="button-small" data-action="citation">Copy citation</button><button class="button-small" data-action="record-json">Download JSON</button></div><section class="record-section"><h3>Abstract</h3><div class="abstract-text">${escape(record.abstract || 'No abstract available.')}</div></section><section class="record-section"><h3>Extracted classifications &amp; metadata</h3><p class="note">Original dataset values. “Not reported” denotes an R missing value; an empty field is shown separately.</p><table class="coding-table"><tbody>${fields.map(key => `<tr><th scope="row">${escape(key.replaceAll('_', ' '))}</th><td>${record[key] === null ? '<span class="muted">Not reported</span>' : record[key] === '' ? '<span class="muted">Empty field</span>' : escape(String(record[key]))}</td></tr>`).join('')}${record.doi ? `<tr><th scope="row">DOI</th><td>${escape(record.doi)}</td></tr>` : ''}</tbody></table></section><section class="record-section"><details><summary>Author affiliations</summary><p>${escape(record.affiliations || 'No affiliations supplied.')}</p></details><details><summary>References supplied with this record</summary><p>${escape(record.references || 'No references supplied.')}</p></details><p class="note">Classification was extracted from abstracts by an LLM. Verify study details in the source publication.</p></section></div>`;
    $('.close-button').focus({ preventScroll: true });
  } catch (error) {
    if (activeRecord === pmid) $('#article-content').innerHTML = `<div class="dialog-top"><span class="eyebrow">ARTICLE RECORD</span><button class="close-button" data-action="close" aria-label="Close article">×</button></div><div class="dialog-body"><h2 id="article-title">The article could not load.</h2><p>${escape(error.message)}</p><button class="button-secondary" data-paper="${pmid}">Try again</button></div>`;
  }
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copy(text, success) {
  try { await navigator.clipboard.writeText(text); notify(success); } catch { notify('Clipboard access is unavailable in this browser.'); }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button,a[data-view],[data-year]');
  if (!target || target.disabled) return;
  if (target.dataset.view) { event.preventDefault(); selectView(target.dataset.view); }
  if (target.dataset.clear) await updateFilters({ [target.dataset.clear]: '' });
  if (target.dataset.dimension) await updateFilters({ [target.dataset.dimension]: target.dataset.value }, 'literature');
  if (target.dataset.cellX !== undefined) await updateFilters({ [matrixX]: target.dataset.cellX, [matrixY]: target.dataset.cellY }, 'literature');
  if (target.dataset.year) await updateFilters({ start: target.dataset.year, end: target.dataset.year }, 'literature');
  if (target.dataset.page) { page = Number(target.dataset.page); render(); $('.results-toolbar')?.scrollIntoView({ block: 'start' }); }
  if (target.dataset.paper) await openArticle(target.dataset.paper);
  if (target.dataset.question) { question = target.dataset.question; render(); $('#question').focus(); }
  if (target.dataset.export) {
    const columns = manifest.columns.filter(key => !['abstract', 'references', 'affiliations'].includes(key));
    const data = sortedResults().map(record => Object.fromEntries(columns.map(key => [key, record[key]])));
    download(target.dataset.export === 'csv' ? csvExport(data, columns) : JSON.stringify(data, null, 2), `fieldnotes-${filters.scope}-${data.length}.${target.dataset.export}`, target.dataset.export === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
    notify(`Exported metadata for ${n(data.length)} articles.`); target.closest('details')?.removeAttribute('open');
  }
  if (target.dataset.action === 'reset') { await updateFilters({ ...DEFAULTS, scope: filters.scope, mode: filters.mode }); }
  if (target.dataset.action === 'share') await copy(location.href, 'View link copied.');
  if (target.dataset.action === 'close') $('#article-dialog').close();
  if (target.dataset.action === 'citation' && activeRecord) {
    const record = await loadRecord(activeRecord);
    await copy(`${record.authors}. ${record.title} ${record.journal}. ${record.year || 'n.d.'}.${record.doi ? ` https://doi.org/${record.doi}` : ` https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`}`, 'Citation copied.');
  }
  if (target.dataset.action === 'record-json' && activeRecord) {
    const record = await loadRecord(activeRecord);
    download(JSON.stringify(Object.fromEntries(manifest.columns.map(key => [key, record[key]])), null, 2), `pubmed-${record.pmid}.json`, 'application/json');
  }
});

let searchTimer;
document.addEventListener('input', event => {
  if (event.target.id === 'search') { clearTimeout(searchTimer); const q = event.target.value; searchTimer = setTimeout(() => updateFilters({ q }), 220); }
  if (event.target.id === 'question') question = event.target.value;
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.filter) await updateFilters({ [target.dataset.filter]: target.value });
  if (target.id === 'abstracts') await updateFilters({ abstracts: target.checked });
  if (target.id === 'sort') { sort = target.value; page = 1; render(); }
  if (target.id === 'matrix-x' || target.id === 'matrix-y') {
    if (target.id === 'matrix-x') matrixX = target.value; else matrixY = target.value;
    if (matrixX === matrixY) { if (target.id === 'matrix-x') matrixY = matrixX === 'outcome' ? 'disaster' : 'outcome'; else matrixX = matrixY === 'disaster' ? 'outcome' : 'disaster'; }
    render();
  }
});
document.addEventListener('keydown', event => { if (event.target.dataset.year && ['Enter', ' '].includes(event.key)) { event.preventDefault(); updateFilters({ start: event.target.dataset.year, end: event.target.dataset.year }, 'literature'); } });
document.addEventListener('submit', async event => {
  if (event.target.id !== 'insight-form') return;
  event.preventDefault(); if (aiBusy) return;
  const password = $('#author-password')?.value || '', sentFilters = JSON.stringify(filters), sentQuestion = question;
  aiBusy = true; aiError = ''; aiAnswer = null; render();
  try {
    const response = await fetch('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` }, body: JSON.stringify({ question, filters }), signal: AbortSignal.timeout(55000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to generate a synthesis.');
    if (sentFilters === JSON.stringify(filters)) aiAnswer = { ...result, question: sentQuestion };
    else notify('The selection changed. Generate a new synthesis for the current filters.');
  } catch (error) { aiError = ['TimeoutError', 'AbortError'].includes(error.name) ? 'The request timed out. Try again.' : error.message; }
  finally { aiBusy = false; render(); }
});
$('#article-dialog').addEventListener('click', event => { if (event.target === $('#article-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close(); } });
$('#article-dialog').addEventListener('close', () => { activeRecord = null; });
window.addEventListener('popstate', async () => { readURL(); page = 1; if (filters.abstracts) { try { await ensureAbstracts(); } catch { filters.abstracts = false; } } render(); });

try {
  readURL();
  const data = await getJSON('/data/index.json');
  manifest = data.manifest; records = data.records.map(record => ({ ...record, _search: searchText(record) }));
  if (filters.abstracts) { try { await ensureAbstracts(); } catch { filters.abstracts = false; notify('Abstract search could not load.'); } }
  render();
  getJSON('/api/insights').then(config => { apiConfig = config; if (view === 'insights') render(); }).catch(() => { apiConfig = { enabled: false }; if (view === 'insights') render(); });
} catch (error) {
  main.innerHTML = `<div class="error-page"><span class="eyebrow">DATA UNAVAILABLE</span><h1>The literature could not load.</h1><p>${escape(error.message)}. Reload this page to try again.</p><a class="button-secondary" href="https://arxiv.org/abs/2611.10390" target="_blank" rel="noopener">Read on arXiv ↗</a></div>`;
}
