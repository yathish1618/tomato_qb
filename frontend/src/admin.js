import { ContentEditor, validateContentBlocks } from './editor/content-editor.js';
import { renderContent, contentToPlainText, typesetMath } from './shared/content-renderer.js';
import '../styles.css';

const $ = id => document.getElementById(id);
const esc = value => { const d = document.createElement('div'); d.textContent = value ?? ''; return d.innerHTML; };
const escAttr = value => String(value ?? '').replace(/"/g, '&quot;');

let current = null;
let dirty = false;
let hydratingEditors = false;
let page = 1;
const pageSize = 50;
let total = 0;
let loadingMore = false;
let topicCatalog = { topics: [] };
let catalog = { collections: [] };
let tagPool = [];
let currentQuery = '';
let contentEditor = null;
let solutionEditor = null;
const optionEditors = {};
let groupCache = new Map();

async function apiJson(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed: ${r.status}`);
  return data;
}

async function convertImageToPng(file) {
  if (file.type === 'image/png') return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The selected image could not be read.'));
    });

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('The selected image has no usable dimensions.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser could not prepare the image.');

    ctx.drawImage(image, 0, 0);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The image could not be converted to PNG.');

    return new File([blob], 'figure.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadFigure(file, kind) {
  const png = await convertImageToPng(file);
  const form = new FormData();
  form.append('file', png, 'figure.png');
  form.append('kind', kind);

  const data = await apiJson(`/api/questions/${encodeURIComponent(current.id)}/figures`, {
    method: 'POST',
    body: form,
  });
  return data.src;
}

function toast(message, type = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type} on`;
  setTimeout(() => el.classList.remove('on'), 2200);
}

function markDirty() {
  if (hydratingEditors) return;
  dirty = true;
  updateDirtyUI();
}
function updateDirtyUI() { $('saveBtn').disabled = !dirty; }

function filters() {
  return {
    search: $('search').value.trim(),
    tag: $('filterTag').value.trim(),
    collection_id: $('filterCollection').value,
    set_id: $('filterSet').value,
    topic_id: $('filterTopic').value,
    subtopic_id: $('filterSubtopic').value,
    grade: $('filterGrade').value,
    difficulty: $('filterDifficulty').value,
    marks: $('filterMarks').value,
    type: $('filterType').value,
    status: $('filterStatus').value,
  };
}

function queryString(extra = {}) {
  const p = new URLSearchParams();
  const all = { ...filters(), ...extra };
  for (const [k, v] of Object.entries(all)) if (v !== '' && v != null) p.set(k, v);
  return p.toString();
}

async function loadCatalogs() {
  [topicCatalog, catalog, tagPool] = await Promise.all([
    apiJson('/api/topics'),
    apiJson('/api/collections'),
    apiJson('/api/tags'),
  ]);
  topicCatalog.topics ||= [];
  catalog.collections ||= [];
  tagPool ||= [];
  buildFilterControls();
  buildGradeList();
}

function buildGradeList() {
  $('grade').innerHTML = '<option value="">—</option>' +
    [...Array(12)].map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('') +
    '<option value="12+">12+</option>';
  $('filterGrade').innerHTML = '<option value="">All Grades</option>' +
    [...Array(12)].map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('') +
    '<option value="12+">12+</option>';
}

function buildFilterControls() {
  $('filterCollection').innerHTML = '<option value="">All Collections</option><option value="__UNMAPPED_COLLECTION__">Unmapped — No Collection</option>' +
    catalog.collections.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join('');
  $('filterTopic').innerHTML = '<option value="">All Topics</option><option value="__UNMAPPED_TOPIC__">Unmapped — No Topic</option>' +
    topicCatalog.topics.map(t => `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`).join('');
  updateFilterSetSelect(false);
  updateFilterSubtopicSelect(false);
}

function updateFilterSetSelect(render = true) {
  const cid = $('filterCollection').value;
  const c = catalog.collections.find(x => x.id === cid);
  $('filterSet').innerHTML = '<option value="">All Sets</option>' + (c?.sets || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
  if (render) resetAndLoadList();
}

function updateFilterSubtopicSelect(render = true) {
  const tid = $('filterTopic').value;
  const t = topicCatalog.topics.find(x => x.id === tid);
  $('filterSubtopic').innerHTML = '<option value="">All Subtopics</option><option value="__UNMAPPED_SUBTOPIC__">Unmapped — No Subtopic</option>' +
    (t?.subtopics || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
  if (render) resetAndLoadList();
}

function resetAndLoadList() {
  page = 1;
  total = 0;
  $('questionList').innerHTML = '';
  loadQuestionPage(false).catch(err => toast(err.message, 'err'));
}

async function loadQuestionPage(append) {
  if (loadingMore) return;
  loadingMore = true;
  try {
    const data = await apiJson(`/api/questions?${queryString({ page, page_size: pageSize })}`);
    total = data.total || 0;
    if (!append) $('questionList').innerHTML = '';
    renderQuestionRows(data.questions || [], append);
    $('count').textContent = `${Math.min(page * pageSize, total)} of ${total}`;
  } finally {
    loadingMore = false;
  }
}

function renderQuestionRows(rows, append) {
  const iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
  const html = rows.map(q => {
    const meta = [q.grade ? `Grade ${esc(q.grade)}` : '', q.type ? esc(q.type) : ''].filter(Boolean).join(' · ');
    return `<div class="qitem ${current?.id === q.id ? 'active' : ''}" data-id="${escAttr(q.id)}"><div class="qnum">${iconSvg}</div><div class="qbody"><div class="qtext">${esc(q.preview || '(empty)')}</div>${meta ? `<div class="qmeta">${meta}</div>` : ''}</div></div>`;
  }).join('');
  if (append) $('questionList').insertAdjacentHTML('beforeend', html); else $('questionList').innerHTML = html;
  $('questionList').querySelectorAll('.qitem').forEach(el => { el.onclick = () => loadQuestion(el.dataset.id); });
}

function selectedTags() {
  return [...document.querySelectorAll('#tagBox .tag')].map(x => x.dataset.tag);
}

function addTagDOM(tag, selected = true) {
  const box = $('tagBox');
  const el = document.createElement('span');
  el.className = 'tag';
  el.dataset.tag = tag;
  el.innerHTML = `${esc(tag)} <span class="tag-x">×</span>`;
  el.querySelector('.tag-x').onclick = () => { el.remove(); markDirty(); };
  box.insertBefore(el, $('tagInput'));
  if (selected) markDirty();
}

function renderTags(tags) {
  document.querySelectorAll('#tagBox .tag').forEach(x => x.remove());
  for (const tag of tags || []) addTagDOM(tag, false);
}

function tagSuggest() {
  const value = $('tagInput').value.trim().toLowerCase();
  const used = new Set(selectedTags());
  const matches = value ? tagPool.filter(t => t.toLowerCase().includes(value) && !used.has(t)).slice(0, 8) : [];
  const box = $('tagSuggestions');
  box.innerHTML = matches.map(t => `<div class="suggestion">${esc(t)}</div>`).join('');
  box.classList.toggle('open', matches.length > 0);
  box.querySelectorAll('.suggestion').forEach((el, i) => el.onclick = () => { addTagDOM(matches[i]); $('tagInput').value = ''; box.classList.remove('open'); });
}

function renderRelations() {
  const topics = current.topics || [];
  const collections = current.collections || [];

  $('topics').innerHTML = (topics.length ? topics : [{ topic_id: '', subtopic_id: '' }]).map((m, i) => {
    const topicOptions = '<option value="">Select topic…</option>' + topicCatalog.topics.map(t => `<option value="${escAttr(t.id)}" ${t.id === m.topic_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const t = topicCatalog.topics.find(t => t.id === m.topic_id);
    const subOptions = '<option value="">Select subtopic…</option>' + (t?.subtopics || []).map(s => `<option value="${escAttr(s.id)}" ${s.id === m.subtopic_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<div class="topic-row"><select data-i="${i}" class="topic-select">${topicOptions}</select><select data-i="${i}" class="subtopic-select">${subOptions}</select><button class="remove-topic" data-i="${i}">×</button></div>`;
  }).join('');

  $('collectionsList').innerHTML = (collections.length ? collections : [{ collection_id: '', set_id: '' }]).map((m, i) => {
    const c = catalog.collections.find(x => x.id === m.collection_id);
    const collectionOptions = '<option value="">Select collection…</option>' + catalog.collections.map(x => `<option value="${escAttr(x.id)}" ${x.id === m.collection_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const setOptions = '<option value="">Select set…</option>' + (c?.sets || []).map(s => `<option value="${escAttr(s.id)}" ${s.id === m.set_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<div class="collection-row"><select data-i="${i}" class="collection-select">${collectionOptions}</select><select data-i="${i}" class="set-select">${setOptions}</select><button class="remove-collection" data-i="${i}">×</button></div>`;
  }).join('');

  $('topics').querySelectorAll('.topic-select').forEach(el => el.onchange = () => { syncRelationsFromUI(); renderRelations(); markDirty(); });
  $('topics').querySelectorAll('.subtopic-select').forEach(el => el.onchange = () => { syncRelationsFromUI(); markDirty(); });
  $('topics').querySelectorAll('.remove-topic').forEach(el => el.onclick = () => { syncRelationsFromUI(); current.topics.splice(Number(el.dataset.i), 1); renderRelations(); markDirty(); });
  $('collectionsList').querySelectorAll('.collection-select').forEach(el => el.onchange = () => { syncRelationsFromUI(); renderRelations(); markDirty(); });
  $('collectionsList').querySelectorAll('.set-select').forEach(el => el.onchange = () => { syncRelationsFromUI(); markDirty(); });
  $('collectionsList').querySelectorAll('.remove-collection').forEach(el => el.onclick = () => { syncRelationsFromUI(); current.collections.splice(Number(el.dataset.i), 1); renderRelations(); markDirty(); });
}

function syncRelationsFromUI() {
  current.topics = [...document.querySelectorAll('#topics .topic-row')].map(row => ({
    topic_id: row.querySelector('.topic-select')?.value || '',
    subtopic_id: row.querySelector('.subtopic-select')?.value || '',
  }));

  current.collections = [...document.querySelectorAll('#collectionsList .collection-row')].map(row => ({
    collection_id: row.querySelector('.collection-select')?.value || '',
    set_id: row.querySelector('.set-select')?.value || '',
  }));
}

function destroyOptionEditors() {
  for (const key of Object.keys(optionEditors)) {
    optionEditors[key]?.destroy();
    delete optionEditors[key];
  }
}

function handleEditorChange() {
  if (hydratingEditors) return;
  markDirty();
  renderPreview();
}

function initEditors() {
  if (contentEditor) contentEditor.destroy();
  if (solutionEditor) solutionEditor.destroy();
  destroyOptionEditors();

  contentEditor = new ContentEditor($('questionEditor'), {
    placeholder: 'Question content…',
    showJsonTools: true,
    jsonTitle: 'Question',
    onFigureUpload: file => uploadFigure(file, 'question'),
    jsonAdapter: {
      export: () => {
        const payload = { content: contentEditor.getContent() };
        if (current?.type === 'MCQ') {
          payload.options = Object.fromEntries(['A', 'B', 'C', 'D'].map(label => [label, optionEditors[label]?.getContent?.() || []]));
        }
        return payload;
      },
      import: value => {
        // Question export is deliberately small: content plus MCQ options only.
        if (Array.isArray(value)) {
          const error = validateContentBlocks(value);
          if (error) throw new Error(error);
          contentEditor.setContent(value);
          return true;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Question JSON must be an object containing a content array.');
        const content = value.content;
        const contentError = validateContentBlocks(content);
        if (contentError) throw new Error(contentError);
        if (current?.type === 'MCQ') {
          if (value.options !== undefined) {
            if (!value.options || typeof value.options !== 'object' || Array.isArray(value.options)) throw new Error('options must be an object with A, B, C and D arrays.');
            for (const label of ['A', 'B', 'C', 'D']) {
              if (!(label in value.options)) throw new Error(`options.${label} is missing.`);
              const error = validateContentBlocks(value.options[label]);
              if (error) throw new Error(error.replace(/^content/, `options.${label}`));
              continue;
            }
          }
        } else if (value.options !== undefined) {
          throw new Error('This is not an MCQ, so question JSON must not contain options.');
        }
        contentEditor.setContent(content);
        if (current?.type === 'MCQ' && value.options !== undefined) {
          for (const label of ['A', 'B', 'C', 'D']) optionEditors[label]?.setContent(value.options[label]);
        }
        return true;
      },
    },
  });
  solutionEditor = new ContentEditor($('solutionEditor'), {
    placeholder: 'Solution…',
    showJsonTools: true,
    jsonTitle: 'Solution',
    onFigureUpload: file => uploadFigure(file, 'solution'),
  });
  contentEditor.onChange(handleEditorChange);
  solutionEditor.onChange(handleEditorChange);
}

function renderOptions() {
  destroyOptionEditors();
  $('options').innerHTML = '';
  if (current.type !== 'MCQ') {
    $('optionsField').style.display = 'none';
    return;
  }
  $('optionsField').style.display = '';
  for (const label of ['A', 'B', 'C', 'D']) {
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `<div class="option-label" data-label="${label}">${label}</div>`;
    const host = document.createElement('div');
    host.className = 'option-editor-host';
    row.appendChild(host);
    const answerBtn = document.createElement('button');
    answerBtn.className = 'answer-btn';
    answerBtn.textContent = '✓';
    answerBtn.dataset.letter = label;
    answerBtn.onclick = () => toggleAnswer(label);
    row.appendChild(answerBtn);
    $('options').appendChild(row);
    optionEditors[label] = new ContentEditor(host, { placeholder: `Option ${label}…`, compact: true, toolbarMode: 'minimal', showJsonTools: false });
  }
  setOptionAnswers();
  for (const label of ['A', 'B', 'C', 'D']) {
    const content = current.options?.[label] || [];
    optionEditors[label].setContent(Array.isArray(content) ? content : []);
    optionEditors[label].onChange(handleEditorChange);
  }
}

function getAnswers() {
  if (Array.isArray(current.answer)) return current.answer.map(String);
  if (typeof current.answer === 'string' && current.answer.trim()) return current.answer.split(',').map(x => x.trim());
  return [];
}

function setOptionAnswers() {
  const answers = getAnswers();
  document.querySelectorAll('#options .answer-btn').forEach(btn => {
    const active = answers.includes(btn.dataset.letter);
    btn.classList.toggle('active', active);
    btn.previousElementSibling?.classList.toggle('answer', active);
  });
}

function toggleAnswer(letter) {
  const answers = getAnswers();
  const index = answers.indexOf(letter);
  if (index >= 0) answers.splice(index, 1); else answers.push(letter);
  current.answer = answers.length === 0 ? null : answers.length === 1 ? answers[0] : answers;
  setOptionAnswers();
  markDirty();
  renderPreview();
}

function renderStatuses() {
  const review = ['NEEDS_REVIEW', 'REVIEWED'];

  $('reviewStatus').innerHTML = review.map(s =>
    `<button class="status-btn ${current.review_status === s ? 'active ' + (s === 'REVIEWED' ? 'reviewed' : 'review') : ''}">${s.replace('_', ' ')}</button>`
  ).join('');

  $('reviewStatus').querySelectorAll('button').forEach((b, i) => {
    b.onclick = () => {
      current.review_status = review[i];
      renderStatuses();
      markDirty();
    };
  });

  const pub = ['DRAFT', 'PUBLISHED'];

  $('pubStatus').innerHTML = pub.map(s =>
    `<button class="status-btn ${current.publication_status === s ? 'active ' + (s === 'PUBLISHED' ? 'pub' : 'draft') : ''}">${s}</button>`
  ).join('');

  $('pubStatus').querySelectorAll('button').forEach((b, i) => {
    b.onclick = () => {
      current.publication_status = pub[i];
      renderStatuses();
      markDirty();
    };
  });
}

function renderSource() {
  const s = current.source || {};
  $('sourceBody').innerHTML = `<img src="/api/questions/${encodeURIComponent(current.id)}/source" alt="Source"><div class="source-meta">Page ${(s.pages || []).join(', ') || '—'} · ${esc(s.title || '')}${s.question_number != null ? ` · Question ${esc(String(s.question_number))}` : ''}</div>`;
}

function editorContentOrFallback(editor, fallback) {
  const value = editor?.getContent?.();
  return Array.isArray(value) && value.length ? value : (Array.isArray(fallback) ? fallback : []);
}

function renderPreview() {
  if (!current) return;

  const preview = $('preview');
  preview.innerHTML = '';

  const blocks = editorContentOrFallback(contentEditor, current.content);
  const contentHolder = document.createElement('div');
  contentHolder.className = 'preview-content';
  renderContent(contentHolder, blocks, { typeset: false });
  preview.appendChild(contentHolder);

  if (current.type === 'MCQ') {
    const optionsEl = document.createElement('div');
    optionsEl.className = 'pv-options';

    for (const label of ['A', 'B', 'C', 'D']) {
      const option = document.createElement('div');
      option.className = `pv-option ${getAnswers().includes(label) ? 'correct-answer' : ''}`;

      const letter = document.createElement('div');
      letter.className = 'pv-letter';
      letter.textContent = label;

      const body = document.createElement('div');
      body.className = 'pv-text';

      const fallback = current.options?.[label];
      renderContent(
        body,
        editorContentOrFallback(optionEditors[label], fallback),
        { typeset: false }
      );

      option.append(letter, body);
      optionsEl.appendChild(option);
    }

    preview.appendChild(optionsEl);
  }

  const sol = editorContentOrFallback(solutionEditor, current.solution);
  if (sol.length) {
    const solution = document.createElement('div');
    solution.className = 'pv-solution';

    const label = document.createElement('div');
    label.className = 'field label';
    label.textContent = 'SOLUTION';

    const body = document.createElement('div');
    body.className = 'pv-solution-text';
    renderContent(body, sol, { typeset: false });

    solution.append(label, body);
    preview.appendChild(solution);
  }

    const uuidEl = document.createElement('div');
    uuidEl.className = 'pv-uuid';
    uuidEl.textContent = current.id || '';
    preview.appendChild(uuidEl);

  typesetMath(preview);
}

async function loadGroup(gid) {
  if (groupCache.has(gid)) return groupCache.get(gid);
  const group = await apiJson(`/api/groups/${encodeURIComponent(gid)}`);
  groupCache.set(gid, group);
  return group;
}

async function renderGroupPreview() {
  const panel = $('groupPreview');
  if (!current.group_id) { panel.hidden = true; return; }
  panel.hidden = false;
  const group = await loadGroup(current.group_id);
  const ids = group.children || [];
  const idx = ids.indexOf(current.id);
  $('groupPreviewTitle').textContent = `Group Question (${ids.length} ${ids.length === 1 ? 'part' : 'parts'})`;
  $('groupPrevBtn').disabled = idx <= 0;
  $('groupNextBtn').disabled = idx < 0 || idx >= ids.length - 1;
  renderContent($('groupContent'), group.content || [], { typeset: false });
  typesetMath($('groupContent'));
}

async function navigateGroup(delta) {
  if (!current?.group_id) return;
  const group = await loadGroup(current.group_id);
  const ids = group.children || [];
  const idx = ids.indexOf(current.id);
  if (ids[idx + delta]) await loadQuestion(ids[idx + delta]);
}

function populateEditorFromCurrent() {
  hydratingEditors = true;

  $('editorType').textContent = current.type;
  $('difficulty').value = current.difficulty || '';
  $('grade').value = current.grade || '';
  $('marks').value = current.marks ?? 1;
  renderTags(current.tags || []);
  renderRelations();
  renderStatuses();
  renderSource();
  initEditors();

  contentEditor.setContent(current.content || []);
  solutionEditor.setContent(current.solution || []);
  renderOptions();

  // Render from the canonical loaded content immediately. The editors may
  // finish hydrating on a later Lexical update, so renderPreview() has
  // explicit fallbacks to current.content/current.options/current.solution.
  renderPreview();

  // Keep hydration protection active through queued Lexical updates.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hydratingEditors = false;
      dirty = false;
      updateDirtyUI();
      renderPreview();
    });
  });
}

async function loadQuestion(id) {
  if (dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
  try {
    current = await apiJson(`/api/questions/${encodeURIComponent(id)}`);
    current.topics ||= [];
    current.collections ||= [];
    current.tags ||= [];
    current.options ||= {};
    current.group_id ||= null;
    dirty = false;
    updateDirtyUI();
    populateEditorFromCurrent();
    renderQuestionListHighlight();
    await renderGroupPreview();
  } catch (err) { toast(err.message, 'err'); }
}

function renderQuestionListHighlight() {
  document.querySelectorAll('.qitem').forEach(el => el.classList.toggle('active', el.dataset.id === current?.id));
}

async function saveQuestion() {
  if (!current) return;
  syncRelationsFromUI();
  const payload = {
    ...current,
    topics: (current.topics || []).filter(x => x.topic_id && x.subtopic_id),
    collections: (current.collections || []).filter(x => x.collection_id && x.set_id),
    content: contentEditor.getContent(),
    options: current.type === 'MCQ' ? Object.fromEntries(['A','B','C','D'].map(l => [l, optionEditors[l].getContent()])) : {},
    solution: solutionEditor.getContent(),
    difficulty: $('difficulty').value,
    grade: $('grade').value,
    marks: Number($('marks').value) || 1,
    tags: selectedTags(),
  };
  delete payload.question;
  delete payload.preview;
  try {
    await apiJson(`/api/questions/${encodeURIComponent(current.id)}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
    });
    current = await apiJson(`/api/questions/${encodeURIComponent(current.id)}`);
    dirty = false; updateDirtyUI();
    renderPreview(); renderQuestionListHighlight(); await renderGroupPreview();
    toast('Saved', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

async function loadNextPage() {
  if (page * pageSize >= total || loadingMore) return;
  page += 1;
  await loadQuestionPage(true);
}


const BULK_OPERATION_CONFIG = {
  ingest: {
    title: 'Ingest New Questions from JSON',
    description: 'Choose the JSON export produced by the question scraper. The additive migration will skip UUIDs that already exist.',
    endpoint: '/api/bulk/ingest-json',
    button: 'Ingest Questions',
  },
  delete: {
    title: 'Delete Questions from JSON',
    description: 'Choose the JSON export containing the questions you want to remove from SQLite.',
    endpoint: '/api/bulk/delete-json',
    button: 'Delete Questions',
  },
};

let activeBulkOperation = null;

function openBulkOperations() {
  document.body.classList.add('bulk-cms-open');
  $('bulkOperationsView').hidden = false;
}

function closeBulkOperations() {
  $('bulkOperationModal').classList.remove('open');
  activeBulkOperation = null;
  document.body.classList.remove('bulk-cms-open');
  $('bulkOperationsView').hidden = true;
  $('bulkJsonFile').value = '';
  $('bulkFileName').textContent = 'No file selected.';
  $('bulkResultBox').classList.remove('open');
  $('bulkResultText').textContent = '';
}

function openBulkOperation(kind) {
  const config = BULK_OPERATION_CONFIG[kind];
  if (!config) return;

  activeBulkOperation = kind;
  $('bulkModalTitle').textContent = config.title;
  $('bulkModalDescription').textContent = config.description;
  $('bulkExecuteBtn').textContent = config.button;
  $('bulkJsonFile').value = '';
  $('bulkFileName').textContent = 'No file selected.';
  $('bulkExecuteBtn').disabled = true;
  $('bulkResultBox').classList.remove('open');
  $('bulkResultText').textContent = '';
  $('bulkDeleteWarning').style.display = kind === 'delete' ? 'block' : 'none';
  $('bulkOperationModal').classList.add('open');
}

function closeBulkOperationModal() {
  $('bulkOperationModal').classList.remove('open');
  activeBulkOperation = null;
}

async function executeBulkOperation() {
  if (!activeBulkOperation) return;

  const file = $('bulkJsonFile').files[0];
  if (!file) {
    toast('Choose a JSON file first.', 'err');
    return;
  }

  if (!file.name.toLowerCase().endsWith('.json')) {
    toast('Please choose a .json file.', 'err');
    return;
  }

  if (activeBulkOperation === 'delete') {
    const confirmed = window.confirm(
      `Delete the questions listed in "${file.name}" from the SQLite database? This cannot be undone except by restoring a backup.`
    );
    if (!confirmed) return;
  }

  const form = new FormData();
  form.append('file', file, file.name);

  const config = BULK_OPERATION_CONFIG[activeBulkOperation];
  const button = $('bulkExecuteBtn');
  button.disabled = true;
  button.textContent = activeBulkOperation === 'delete' ? 'Deleting…' : 'Ingesting…';

  try {
    const response = await fetch(config.endpoint, { method: 'POST', body: form });
    const data = await response.json().catch(() => ({
      success: false,
      error: `Server returned ${response.status}.`,
    }));

    $('bulkResultText').textContent = data.output || data.error || 'Operation completed.';
    $('bulkResultBox').classList.add('open');

    if (!response.ok || !data.success) {
      toast(data.error || 'Operation failed.', 'err');
      return;
    }

    toast(
      activeBulkOperation === 'delete'
        ? 'Questions deleted successfully.'
        : 'Questions ingested successfully.',
      'ok'
    );

    // Refresh the CMS list/catalogs while staying on /cms.
    if (activeBulkOperation === 'ingest' || activeBulkOperation === 'delete') {
      await loadCatalogs();
      resetAndLoadList();
    }
  } catch (err) {
    $('bulkResultText').textContent = err.message;
    $('bulkResultBox').classList.add('open');
    toast('Operation failed.', 'err');
  } finally {
    button.textContent = BULK_OPERATION_CONFIG[activeBulkOperation]?.button || 'Execute';
    button.disabled = !$('bulkJsonFile').files[0];
  }
}

function wireBulkOperations() {
  $('bulkBtn').onclick = openBulkOperations;
  $('bulkBackBtn').onclick = closeBulkOperations;

  document.querySelectorAll('[data-bulk-operation]').forEach(card => {
    card.onclick = () => openBulkOperation(card.dataset.bulkOperation);
  });

  $('bulkOperationModal').onclick = event => {
    if (event.target === $('bulkOperationModal')) closeBulkOperationModal();
  };

  $('bulkModalClose').onclick = closeBulkOperationModal;
  $('bulkModalCancel').onclick = closeBulkOperationModal;
  $('bulkExecuteBtn').onclick = executeBulkOperation;

  $('bulkJsonFile').onchange = () => {
    const file = $('bulkJsonFile').files[0];
    $('bulkFileName').textContent = file ? file.name : 'No file selected.';
    $('bulkExecuteBtn').disabled = !file;
  };
}

function wire() {
  wireBulkOperations();
  $('search').oninput = () => { currentQuery = $('search').value; resetAndLoadList(); };
  $('filterCollection').onchange = () => updateFilterSetSelect(true);
  $('filterSet').onchange = resetAndLoadList;
  $('filterTopic').onchange = () => updateFilterSubtopicSelect(true);
  $('filterSubtopic').onchange = resetAndLoadList;
  ['filterTag','filterGrade','filterDifficulty','filterMarks','filterType','filterStatus'].forEach(id => { $(id).onchange = resetAndLoadList; $(id).oninput = resetAndLoadList; });

  $('filterBtn').onclick = () => $('filterModal').classList.add('open');
  $('filterClose').onclick = () => $('filterModal').classList.remove('open');
  $('applyFiltersBtn').onclick = () => $('filterModal').classList.remove('open');
  $('clearFilters').onclick = () => {
    $('search').value=''; $('filterTag').value=''; $('filterCollection').value=''; $('filterSet').value=''; $('filterTopic').value=''; $('filterSubtopic').value=''; $('filterGrade').value=''; $('filterDifficulty').value=''; $('filterMarks').value=''; $('filterType').value=''; $('filterStatus').value='all';
    buildFilterControls(); resetAndLoadList(); $('filterModal').classList.remove('open');
  };

  $('questionList').onscroll = async e => {
    if (e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 120) await loadNextPage();
  };

  $('saveBtn').onclick = saveQuestion;
  $('prevBtn').onclick = () => navigateBy(-1);
  $('nextBtn').onclick = () => navigateBy(1);
  $('groupPrevBtn').onclick = () => navigateGroup(-1);
  $('groupNextBtn').onclick = () => navigateGroup(1);
  $('addTopic').onclick = () => { current.topics.push({topic_id:'', subtopic_id:''}); renderRelations(); markDirty(); };
  $('addCollection').onclick = () => { current.collections.push({collection_id:'', set_id:''}); renderRelations(); markDirty(); };
  $('tagInput').oninput = tagSuggest;
  $('tagInput').onkeydown = e => { if ((e.key === 'Enter' || e.key === ',') && $('tagInput').value.trim()) { e.preventDefault(); addTagDOM($('tagInput').value.trim().replace(/,/g,'')); $('tagInput').value=''; } };
  $('sourceToggle').onclick = () => { $('sourceBody').classList.toggle('open'); $('sourceChevron').textContent = $('sourceBody').classList.contains('open') ? '⌃' : '⌄'; };
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveQuestion(); }
    if (e.key === 'ArrowLeft' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) navigateBy(-1);
    if (e.key === 'ArrowRight' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) navigateBy(1);
    if (e.key === 'Escape') { $('filterModal').classList.remove('open'); if ($('bulkOperationModal').classList.contains('open')) closeBulkOperationModal(); else if (document.body.classList.contains('bulk-cms-open')) closeBulkOperations(); }
  });
}

async function navigateBy(delta) {
  if (!current) return;
  const qs = queryString();
  const data = await apiJson(`/api/questions/${encodeURIComponent(current.id)}/neighbors?${qs}`);
  const target = delta < 0 ? data.previous : data.next;
  if (target) await loadQuestion(target);
}

async function main() {
  await loadCatalogs();
  wire();
  resetAndLoadList();
}

document.addEventListener('DOMContentLoaded', () => main().catch(err => toast(err.message, 'err')));
