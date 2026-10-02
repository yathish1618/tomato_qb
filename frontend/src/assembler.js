import { renderContent, contentToPlainText, typesetMath } from './shared/content-renderer.js';

const $ = id => document.getElementById(id);
const esc = value => { const d = document.createElement('div'); d.textContent = value ?? ''; return d.innerHTML; };
const escAttr = value => String(value ?? '').replace(/"/g, '&quot;');

const pageSize = 50;
const BATCH_LIMIT = 200;

let current = null;
let page = 1;
let total = 0;
let loadingMore = false;
let topicCatalog = { topics: [] };
let catalog = { collections: [] };
let tagPool = [];
let groupCache = new Map();

// Ephemeral assembly state: ordered IDs are the document order. Search/filter state
// is deliberately separate, so changing the left-panel filter never loses selections.
const assemblyIds = [];
const assemblySummaries = new Map();

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function toast(message, type = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type} on`;
  setTimeout(() => el.classList.remove('on'), 2200);
}

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
  const params = new URLSearchParams();
  const all = { ...filters(), ...extra };
  for (const [key, value] of Object.entries(all)) {
    if (value !== '' && value != null) params.set(key, value);
  }
  return params.toString();
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
  $('filterGrade').innerHTML = '<option value="">All Grades</option>' +
    [...Array(12)].map((_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('') +
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
  const collectionId = $('filterCollection').value;
  const collection = catalog.collections.find(item => item.id === collectionId);
  $('filterSet').innerHTML = '<option value="">All Sets</option>' +
    (collection?.sets || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
  if (render) resetAndLoadList();
}

function updateFilterSubtopicSelect(render = true) {
  const topicId = $('filterTopic').value;
  const topic = topicCatalog.topics.find(item => item.id === topicId);
  $('filterSubtopic').innerHTML = '<option value="">All Subtopics</option><option value="__UNMAPPED_SUBTOPIC__">Unmapped — No Subtopic</option>' +
    (topic?.subtopics || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
  if (render) resetAndLoadList();
}

function resetAndLoadList() {
  page = 1;
  total = 0;
  $('questionList').innerHTML = '';
  loadQuestionPage(false).catch(error => toast(error.message, 'err'));
}

async function loadQuestionPage(append) {
  if (loadingMore) return;
  loadingMore = true;
  try {
    const data = await apiJson(`/api/questions?${queryString({ page, page_size: pageSize })}`);
    total = data.total || 0;
    const rows = data.questions || [];
    rows.forEach(question => summaryCache.set(question.id, question));
    if (!append) $('questionList').innerHTML = '';
    renderQuestionRows(rows, append);
    $('count').textContent = `${Math.min(page * pageSize, total)} of ${total}`;
  } finally {
    loadingMore = false;
  }
}

function selectionButton(qid) {
  const selected = assemblyIds.includes(qid);
  return `<button class="assembler-select ${selected ? 'selected' : ''}" data-select-id="${escAttr(qid)}" type="button" aria-pressed="${selected}" title="${selected ? 'Remove from assembly' : 'Add to assembly'}" aria-label="${selected ? 'Remove from assembly' : 'Add to assembly'}">${selected ? '✓' : ''}</button>`;
}

function renderQuestionRows(rows, append) {
  const iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
  const html = rows.map(question => {
    const meta = [question.grade ? `Grade ${esc(question.grade)}` : '', question.type ? esc(question.type) : ''].filter(Boolean).join(' · ');
    return `<div class="qitem ${current?.id === question.id ? 'active' : ''} ${assemblyIds.includes(question.id) ? 'assembled' : ''}" data-id="${escAttr(question.id)}">
      <div class="qnum assembler-qnum">${selectionButton(question.id)}</div>
      <div class="qbody"><div class="qtext">${esc(question.preview || '(empty)')}</div>${meta ? `<div class="qmeta">${meta}</div>` : ''}</div>
    </div>`;
  }).join('');

  if (append) $('questionList').insertAdjacentHTML('beforeend', html);
  else $('questionList').innerHTML = html;

  $('questionList').querySelectorAll('.qitem').forEach(element => {
    element.onclick = () => loadQuestion(element.dataset.id);
  });
  $('questionList').querySelectorAll('[data-select-id]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      toggleAssembly(button.dataset.selectId);
    };
  });
}

function refreshVisibleSelectionState() {
  document.querySelectorAll('.qitem').forEach(element => {
    const selected = assemblyIds.includes(element.dataset.id);
    element.classList.toggle('assembled', selected);
    const button = element.querySelector('[data-select-id]');
    if (!button) return;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('title', selected ? 'Remove from assembly' : 'Add to assembly');
    button.setAttribute('aria-label', selected ? 'Remove from assembly' : 'Add to assembly');
    button.textContent = selected ? '✓' : '';
  });
}

function toggleAssembly(id) {
  const index = assemblyIds.indexOf(id);
  if (index >= 0) {
    assemblyIds.splice(index, 1);
    assemblySummaries.delete(id);
  } else {
    const row = [...document.querySelectorAll('.qitem')].find(item => item.dataset.id === id);
    if (!row) return;
    const summary = findSummaryForRow(id);
    assemblyIds.push(id);
    if (summary) assemblySummaries.set(id, summary);
  }
  refreshVisibleSelectionState();
  renderAssembly();
}

function findSummaryForRow(id) {
  // The current row doesn't expose all API fields as DOM metadata, so retain a
  // compact summary from the row's text plus current question data when available.
  // The question-list API object is captured below while rendering rows.
  return summaryCache.get(id) || (current?.id === id ? {
    id: current.id,
    type: current.type,
    grade: current.grade,
    marks: Number(current.marks) || 0,
    preview: contentToPlainText(current.content || []) || '(empty)',
  } : null);
}

const summaryCache = new Map();


function renderAssembly() {
  const count = assemblyIds.length;
  const marks = assemblyIds.reduce((sum, id) => sum + (Number(assemblySummaries.get(id)?.marks) || 0), 0);
  $('assemblyCount').textContent = `${count} ${count === 1 ? 'question' : 'questions'} · ${marks} ${marks === 1 ? 'mark' : 'marks'}`;
  $('clearAssemblyBtn').disabled = count === 0;
  $('questionPaperBtn').disabled = count === 0;
  $('answerKeyBtn').disabled = count === 0;
  $('assemblyEmpty').hidden = count !== 0;

  const list = $('assemblyList');
  if (!count) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = assemblyIds.map((id, index) => {
    const summary = assemblySummaries.get(id) || {};
    const meta = [summary.grade ? `Grade ${esc(summary.grade)}` : '', summary.type ? esc(summary.type) : '', `${Number(summary.marks) || 0} ${Number(summary.marks) === 1 ? 'mark' : 'marks'}`].filter(Boolean).join(' · ');
    return `<div class="assembly-item ${current?.id === id ? 'active' : ''}" data-assembly-id="${escAttr(id)}">
      <div class="assembly-number">Q${index + 1}</div>
      <div class="assembly-body">
        <div class="assembly-text">${esc(summary.preview || '(empty)')}</div>
        ${meta ? `<div class="assembly-meta">${meta}</div>` : ''}
      </div>
      <div class="assembly-actions">
        <button class="assembly-icon" data-action="up" title="Move up" aria-label="Move question ${index + 1} up" type="button" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="assembly-icon" data-action="down" title="Move down" aria-label="Move question ${index + 1} down" type="button" ${index === count - 1 ? 'disabled' : ''}>↓</button>
        <button class="assembly-icon remove" data-action="remove" title="Remove from assembly" aria-label="Remove question ${index + 1}" type="button">×</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.assembly-item').forEach(item => {
    item.onclick = event => {
      if (event.target.closest('.assembly-icon')) return;
      loadQuestion(item.dataset.assemblyId);
    };
  });
  list.querySelectorAll('.assembly-icon').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const item = button.closest('.assembly-item');
      const id = item.dataset.assemblyId;
      const action = button.dataset.action;
      const index = assemblyIds.indexOf(id);
      if (action === 'remove') {
        assemblyIds.splice(index, 1);
        assemblySummaries.delete(id);
      } else if (action === 'up' && index > 0) {
        [assemblyIds[index - 1], assemblyIds[index]] = [assemblyIds[index], assemblyIds[index - 1]];
      } else if (action === 'down' && index >= 0 && index < assemblyIds.length - 1) {
        [assemblyIds[index + 1], assemblyIds[index]] = [assemblyIds[index], assemblyIds[index + 1]];
      }
      refreshVisibleSelectionState();
      renderAssembly();
    };
  });
}

function clearAssembly() {
  if (!assemblyIds.length) return;
  if (!confirm(`Clear all ${assemblyIds.length} assembled questions?`)) return;
  assemblyIds.length = 0;
  assemblySummaries.clear();
  renderAssembly();
  refreshVisibleSelectionState();
}

function renderQuestionListHighlight() {
  document.querySelectorAll('.qitem').forEach(element => element.classList.toggle('active', element.dataset.id === current?.id));
  document.querySelectorAll('.assembly-item').forEach(element => element.classList.toggle('active', element.dataset.assemblyId === current?.id));
}

function getAnswers(question) {
  const answer = question?.answer;
  if (Array.isArray(answer)) return answer.map(String).filter(Boolean);
  if (answer == null || answer === '') return [];
  return [String(answer)];
}

function renderQuestionPreview() {
  const preview = $('preview');
  preview.innerHTML = '';
  if (!current) {
    preview.innerHTML = '<div class="empty">Select a question from the left to preview it.</div>';
    return;
  }

  const question = document.createElement('div');
  question.className = 'pv-question';
  renderContent(question, current.content || [], { typeset: false });
  preview.appendChild(question);

  if (current.type === 'MCQ') {
    const options = document.createElement('div');
    options.className = 'pv-options';
    const answers = new Set(getAnswers(current));
    for (const label of ['A', 'B', 'C', 'D']) {
      const option = document.createElement('div');
      option.className = `pv-option ${answers.has(label) ? 'correct-answer' : ''}`;
      const letter = document.createElement('div');
      letter.className = 'pv-letter';
      letter.textContent = label;
      const body = document.createElement('div');
      body.className = 'pv-text';
      renderContent(body, current.options?.[label] || [], { typeset: false });
      option.append(letter, body);
      options.appendChild(option);
    }
    preview.appendChild(options);
  }

  const solution = Array.isArray(current.solution) ? current.solution : [];
  if (solution.length) {
    const section = document.createElement('div');
    section.className = 'pv-solution';
    const label = document.createElement('div');
    label.className = 'field label';
    label.textContent = 'SOLUTION';
    const body = document.createElement('div');
    body.className = 'pv-solution-text';
    renderContent(body, solution, { typeset: false });
    section.append(label, body);
    preview.appendChild(section);
  }

  const uuid = document.createElement('div');
  uuid.className = 'pv-uuid';
  uuid.textContent = current.id || '';
  preview.appendChild(uuid);
  typesetMath(preview);
}

async function loadGroup(groupId) {
  if (groupCache.has(groupId)) return groupCache.get(groupId);
  const group = await apiJson(`/api/groups/${encodeURIComponent(groupId)}`);
  groupCache.set(groupId, group);
  return group;
}

async function renderGroupPreview() {
  const panel = $('groupPreview');
  if (!current?.group_id) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const group = await loadGroup(current.group_id);
  const ids = group.children || [];
  const index = ids.indexOf(current.id);
  $('groupPreviewTitle').textContent = `Group Question (${ids.length} ${ids.length === 1 ? 'part' : 'parts'})`;
  $('groupPrevBtn').disabled = index <= 0;
  $('groupNextBtn').disabled = index < 0 || index >= ids.length - 1;
  renderContent($('groupContent'), group.content || [], { typeset: false });
  typesetMath($('groupContent'));
}

async function loadQuestion(id) {
  try {
    current = await apiJson(`/api/questions/${encodeURIComponent(id)}`);
    if (!summaryCache.has(id)) {
      summaryCache.set(id, {
        id: current.id,
        type: current.type,
        grade: current.grade,
        marks: Number(current.marks) || 0,
        preview: contentToPlainText(current.content || []) || '(empty)',
      });
    }
    if (assemblyIds.includes(id)) assemblySummaries.set(id, summaryCache.get(id));
    renderQuestionPreview();
    renderQuestionListHighlight();
    await renderGroupPreview();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function navigateBy(delta) {
  if (!current) return;
  const data = await apiJson(`/api/questions/${encodeURIComponent(current.id)}/neighbors?${queryString()}`);
  const target = delta < 0 ? data.previous : data.next;
  if (target) await loadQuestion(target);
}

async function navigateGroup(delta) {
  if (!current?.group_id) return;
  const group = await loadGroup(current.group_id);
  const ids = group.children || [];
  const index = ids.indexOf(current.id);
  if (ids[index + delta]) await loadQuestion(ids[index + delta]);
}

async function loadMore() {
  if (page * pageSize >= total || loadingMore) return;
  page += 1;
  await loadQuestionPage(true);
}


function filterHasValue() {
  return Object.entries(filters()).some(([key, value]) => key !== 'search' && value);
}

function updateFilterIndicator() {
  $('filterBtn').classList.toggle('active-filter', filterHasValue());
}

async function fetchAssemblyQuestions() {
  if (!assemblyIds.length) return [];
  if (assemblyIds.length > BATCH_LIMIT) {
    throw new Error(`A maximum of ${BATCH_LIMIT} questions can be generated at once.`);
  }
  const data = await apiJson('/api/questions/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: assemblyIds }),
  });
  return data.questions || [];
}

function printAnswer(question) {
  const answers = getAnswers(question);
  if (answers.length) return answers.join(', ');
  return '';
}

function printBlock(title, className = '') {
  const section = document.createElement('section');
  section.className = className;
  if (title) {
    const heading = document.createElement('div');
    heading.className = 'print-section-label';
    heading.textContent = title;
    section.appendChild(heading);
  }
  return section;
}

function appendQuestionToPrint(root, question, index, { answerKey, group }) {
  const questionSection = document.createElement('section');
  questionSection.className = 'print-question';

  const heading = document.createElement('div');
  heading.className = 'print-question-number';
  heading.textContent = `Question ${index + 1}`;
  questionSection.appendChild(heading);

  if (group) {
    const groupSection = printBlock('Common Context', 'print-group-context');
    const groupContent = document.createElement('div');
    groupContent.className = 'print-content';
    renderContent(groupContent, group.content || [], { typeset: false });
    groupSection.appendChild(groupContent);
    questionSection.appendChild(groupSection);
  }

  const content = document.createElement('div');
  content.className = 'print-content print-question-content';
  renderContent(content, question.content || [], { typeset: false });
  questionSection.appendChild(content);

  if (question.type === 'MCQ') {
    const options = document.createElement('div');
    options.className = 'print-options';
    for (const label of ['A', 'B', 'C', 'D']) {
      const option = document.createElement('div');
      option.className = 'print-option';
      const letter = document.createElement('span');
      letter.className = 'print-option-letter';
      letter.textContent = `${label}.`;
      const body = document.createElement('div');
      body.className = 'print-option-body';
      renderContent(body, question.options?.[label] || [], { typeset: false });
      option.append(letter, body);
      options.appendChild(option);
    }
    questionSection.appendChild(options);
  }

  if (answerKey) {
    const answer = printAnswer(question);
    if (answer) {
      const answerSection = printBlock('Answer', 'print-answer');
      const answerText = document.createElement('div');
      answerText.className = 'print-answer-value';
      answerText.textContent = answer;
      answerSection.appendChild(answerText);
      questionSection.appendChild(answerSection);
    }

    if (Array.isArray(question.solution) && question.solution.length) {
      const solutionSection = printBlock('Solution', 'print-solution');
      const solutionContent = document.createElement('div');
      solutionContent.className = 'print-content';
      renderContent(solutionContent, question.solution, { typeset: false });
      solutionSection.appendChild(solutionContent);
      questionSection.appendChild(solutionSection);
    }
  }

  root.appendChild(questionSection);
}

async function buildPrintDocument(kind) {
  const questions = await fetchAssemblyQuestions();
  const answerKey = kind === 'answer-key';
  const root = $('printRoot');
  root.innerHTML = '';

  const marks = questions.reduce((sum, question) => sum + (Number(question.marks) || 0), 0);
  const title = document.createElement('header');
  title.className = 'print-document-head';
  const brand = document.createElement('div');
  brand.className = 'print-brand';
  brand.textContent = 'TOMATO';
  const heading = document.createElement('h1');
  heading.textContent = answerKey ? 'Answer Key' : 'Question Paper';
  const meta = document.createElement('div');
  meta.className = 'print-document-meta';
  meta.textContent = `${questions.length} ${questions.length === 1 ? 'question' : 'questions'} · ${marks} ${marks === 1 ? 'mark' : 'marks'}`;
  title.append(brand, heading, meta);
  root.appendChild(title);

  const groups = new Map();
  const groupIds = [...new Set(questions.map(question => question.group_id).filter(Boolean))];
  await Promise.all(groupIds.map(async groupId => {
    groups.set(groupId, await loadGroup(groupId));
  }));

  const renderedGroups = new Set();
  questions.forEach((question, index) => {
    const group = question.group_id && !renderedGroups.has(question.group_id) ? groups.get(question.group_id) : null;
    if (question.group_id) renderedGroups.add(question.group_id);
    appendQuestionToPrint(root, question, index, { answerKey, group });
  });

  const footer = document.createElement('footer');
  footer.className = 'print-document-foot';
  footer.textContent = 'Generated from TOMATO Question Bank';
  root.appendChild(footer);

  return root;
}

function waitForImages(root) {
  const images = [...root.querySelectorAll('img')];
  if (!images.length) return Promise.resolve();
  return Promise.all(images.map(image => {
    if (image.complete) return Promise.resolve();
    return new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
}

let printRestore = null;

async function generatePdf(kind) {
  const label = kind === 'answer-key' ? 'answer key' : 'question paper';
  try {
    $('questionPaperBtn').disabled = true;
    $('answerKeyBtn').disabled = true;
    await buildPrintDocument(kind);
    $('printRoot').hidden = false;
    $('printRoot').setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-printing');
    document.title = `Tomato — ${kind === 'answer-key' ? 'Answer Key' : 'Question Paper'}`;
    await typesetMath($('printRoot'));
    await waitForImages($('printRoot'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    printRestore = () => {
      document.body.classList.remove('is-printing');
      $('printRoot').hidden = true;
      $('printRoot').setAttribute('aria-hidden', 'true');
      $('printRoot').innerHTML = '';
      document.title = 'Tomato Assembler';
      printRestore = null;
      renderAssembly();
    };

    window.addEventListener('afterprint', printRestore, { once: true });
    window.print();
  } catch (error) {
    if (printRestore) {
      window.removeEventListener('afterprint', printRestore);
      printRestore();
    } else {
      document.body.classList.remove('is-printing');
      $('printRoot').hidden = true;
      $('printRoot').setAttribute('aria-hidden', 'true');
      $('printRoot').innerHTML = '';
      document.title = 'Tomato Assembler';
    }
    toast(`Could not prepare the ${label}: ${error.message}`, 'err');
  } finally {
    if (!printRestore) {
      $('questionPaperBtn').disabled = assemblyIds.length === 0;
      $('answerKeyBtn').disabled = assemblyIds.length === 0;
    }
  }
}

function wire() {
    $('search').oninput = () => { updateFilterIndicator(); resetAndLoadList(); };
  $('filterCollection').onchange = () => { updateFilterSetSelect(true); updateFilterIndicator(); };
  $('filterSet').onchange = () => { resetAndLoadList(); updateFilterIndicator(); };
  $('filterTopic').onchange = () => { updateFilterSubtopicSelect(true); updateFilterIndicator(); };
  $('filterSubtopic').onchange = () => { resetAndLoadList(); updateFilterIndicator(); };
  ['filterTag', 'filterGrade', 'filterDifficulty', 'filterMarks', 'filterType', 'filterStatus'].forEach(id => {
    $(id).onchange = () => { resetAndLoadList(); updateFilterIndicator(); };
    $(id).oninput = () => { resetAndLoadList(); updateFilterIndicator(); };
  });

  $('filterBtn').onclick = () => $('filterModal').classList.add('open');
  $('filterClose').onclick = () => $('filterModal').classList.remove('open');
  $('applyFiltersBtn').onclick = () => $('filterModal').classList.remove('open');
  $('clearFilters').onclick = () => {
    $('search').value = '';
    $('filterTag').value = '';
    $('filterCollection').value = '';
    $('filterSet').value = '';
    $('filterTopic').value = '';
    $('filterSubtopic').value = '';
    $('filterGrade').value = '';
    $('filterDifficulty').value = '';
    $('filterMarks').value = '';
    $('filterType').value = '';
    $('filterStatus').value = 'all';
    buildFilterControls();
    updateFilterIndicator();
    resetAndLoadList();
    $('filterModal').classList.remove('open');
  };

  $('questionList').onscroll = async event => {
    if (event.target.scrollHeight - event.target.scrollTop <= event.target.clientHeight + 120) await loadMore();
  };

  $('prevBtn').onclick = () => navigateBy(-1);
  $('nextBtn').onclick = () => navigateBy(1);
  $('groupPrevBtn').onclick = () => navigateGroup(-1);
  $('groupNextBtn').onclick = () => navigateGroup(1);
  $('clearAssemblyBtn').onclick = clearAssembly;
  $('questionPaperBtn').onclick = () => generatePdf('question-paper');
  $('answerKeyBtn').onclick = () => generatePdf('answer-key');

  document.addEventListener('keydown', event => {
    const insideTextControl = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
    if (!insideTextControl) {
      if (event.key === 'ArrowLeft') navigateBy(-1);
      if (event.key === 'ArrowRight') navigateBy(1);
    }
    if (event.key === 'Escape') {
      $('filterModal').classList.remove('open');
    }
  });
}

async function main() {
  await loadCatalogs();
  wire();
  renderAssembly();
  updateFilterIndicator();
  await loadQuestionPage(false);
  if (!current) {
    const first = document.querySelector('.qitem');
    if (first) await loadQuestion(first.dataset.id);
  }
}

document.addEventListener('DOMContentLoaded', () => main().catch(error => toast(error.message, 'err')));
