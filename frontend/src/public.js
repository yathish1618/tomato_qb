import { renderContent, typesetMath } from './shared/content-renderer.js';
import '../public.css';

let catalog = { collections: [] };
let topicCatalog = { topics: [] };
let current = null;
let currentRoute = 'home';
let questionRows = [];
let questionPage = 1;
let questionTotal = 0;
let questionLoading = false;
let questionRequestToken = 0;
let groupCache = new Map();
let catalogSearch = '';
let catalogSortMode = 'name';
let selectedAnswers = new Set();
let answerChecked = false;

const $ = id => document.getElementById(id);
const esc = value => { const d = document.createElement('div'); d.textContent = value ?? ''; return d.innerHTML; };
const escAttr = value => String(value ?? '').replace(/"/g, '&quot;');

async function apiJson(url) {
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed: ${r.status}`);
  return data;
}

function questionFilters() {
  return {
    search: $('search').value.trim(),
    tag: $('filterTag').value.trim(),
    type: $('filterType').value,
    collection_id: $('filterCollection').value,
    set_id: $('filterSet').value,
    topic_id: $('filterTopic').value,
    subtopic_id: $('filterSubtopic').value,
    grade: $('filterGrade').value,
    difficulty: $('filterDifficulty').value,
    marks: $('filterMarks').value,
  };
}

function queryString(extra = {}) {
  const view = $('questionView');
  const base = {
    ...questionFilters(),
    ...(view.dataset.kind === 'collection' ? {collection_id: view.dataset.id, set_id: view.dataset.subId} : {}),
    ...(view.dataset.kind === 'topic' ? {topic_id: view.dataset.id, subtopic_id: view.dataset.subId} : {}),
    ...extra,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== '' && v != null) p.set(k, v);
  return p.toString();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    [catalog, topicCatalog] = await Promise.all([apiJson('/api/collections'), apiJson('/api/topics')]);
    buildFilterControls();
    wireNavigation();
    routeFromState();
  } catch (err) {
    console.error(err);
    showError('Could not load the question bank.');
  }
});

function buildFilterControls() {
  $('filterCollection').innerHTML = '<option value="">All Collections</option><option value="__UNMAPPED_COLLECTION__">Unmapped — No Collection</option>' + catalog.collections.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join('');
  $('filterTopic').innerHTML = '<option value="">All Topics</option><option value="__UNMAPPED_TOPIC__">Unmapped — No Topic</option>' + topicCatalog.topics.map(t => `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`).join('');
  updateFilterSetSelect(false);
  updateFilterSubtopicSelect(false);
  buildGrades();
}

function buildGrades() {
  const options = '<option value="">All Grades</option>' + [...Array(12)].map((_, i) => `<option value="${i+1}">${i+1}</option>`).join('') + '<option value="12+">12+</option>';
  $('filterGrade').innerHTML = options;
}

function updateFilterSetSelect(render = true) {
  const c = catalog.collections.find(x => x.id === $('filterCollection').value);
  $('filterSet').innerHTML = '<option value="">All Sets</option>' + (c?.sets || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
  if (render) resetQuestionList();
}

function updateFilterSubtopicSelect(render = true) {
  const t = topicCatalog.topics.find(x => x.id === $('filterTopic').value);
  $('filterSubtopic').innerHTML = '<option value="">All Subtopics</option><option value="__UNMAPPED_SUBTOPIC__">Unmapped — No Subtopic</option>' + (t?.subtopics || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
  if (render) resetQuestionList();
}

function clearPublicFilters(resetList = true) {
  $('search').value=''; $('filterTag').value=''; $('filterType').value=''; $('filterCollection').value=''; $('filterSet').value=''; $('filterTopic').value=''; $('filterSubtopic').value=''; $('filterGrade').value=''; $('filterDifficulty').value=''; $('filterMarks').value='';
  updateFilterSetSelect(false); updateFilterSubtopicSelect(false);
  if (resetList) resetQuestionList();
}

function wireCatalogRoutes() {
  document.querySelectorAll('#catalogGrid .catalog-item[data-route]').forEach(btn => {
    btn.onclick = () => go(btn.dataset.route);
  });
}

function wireNavigation() {
  $('homeBtn').onclick = () => go('home');
  $('collectionsBtn').onclick = () => go('collections');
  $('topicsBtn').onclick = () => go('topics');
  $('homeCollectionsCard').onclick = () => go('collections');
  $('homeTopicsCard').onclick = () => go('topics');
  $('catalogBack').onclick = () => {
    const p = (currentRoute || '').split('/').filter(Boolean);
    if (p[0] === 'collections' && p.length > 1) go('collections');
    else if (p[0] === 'topics' && p.length > 1) go('topics');
    else go('home');
  };

  $('catalogSearch').oninput = () => { catalogSearch = $('catalogSearch').value; rerenderCurrentCatalog(); };
  $('catalogSort').onclick = () => {
    catalogSortMode = catalogSortMode === 'name' ? 'countDesc' : 'countAsc' === catalogSortMode ? 'countDesc' : 'countAsc';
    updateCatalogSortButton(); rerenderCurrentCatalog();
  };

  ['filterCollection','filterTopic'].forEach(id => $(id).onchange = id === 'filterCollection' ? () => updateFilterSetSelect() : () => updateFilterSubtopicSelect());
  $('filterSet').onchange = resetQuestionList;
  $('filterSubtopic').onchange = resetQuestionList;
  ['filterType','filterTag','filterGrade','filterDifficulty','filterMarks'].forEach(id => { $(id).onchange = resetQuestionList; $(id).oninput = resetQuestionList; });
  $('filterBtn').onclick = () => $('filterModal').classList.add('open');
  $('filterClose').onclick = () => $('filterModal').classList.remove('open');
  $('applyFiltersBtn').onclick = () => $('filterModal').classList.remove('open');
  $('clearFilters').onclick = () => { clearPublicFilters(); $('filterModal').classList.remove('open'); };
  $('questionList').onscroll = e => { if (e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 150) loadMoreQuestions(); };
  $('prevBtn').onclick = () => navigateGlobal(-1);
  $('nextBtn').onclick = () => navigateGlobal(1);
  $('groupPrevBtn').onclick = () => navigateGroup(-1);
  $('groupNextBtn').onclick = () => navigateGroup(1);
  document.addEventListener('keydown', e => {
    if ($('filterModal').classList.contains('open') && e.key === 'Escape') { $('filterModal').classList.remove('open'); return; }
    if (!$('questionView').hidden && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) {
      if (e.key === 'ArrowLeft') navigateGlobal(-1);
      if (e.key === 'ArrowRight') navigateGlobal(1);
    }
  });
}

function go(hash) { currentRoute = String(hash || 'home').replace(/^#/, '') || 'home'; routeFromState(); }
function routeFromState() {
  const parts = currentRoute.split('/').filter(Boolean);
  if (parts[0] === 'collections') {
    if (parts.length === 1) showCollectionCatalog();
    else if (parts.length === 2) showCollectionCatalog(parts[1]);
    else openQuestionView({kind:'collection', collectionId:parts[1], setId:parts[2]});
    return;
  }
  if (parts[0] === 'topics') {
    if (parts.length === 1) showTopicCatalog();
    else if (parts.length === 2) showTopicCatalog(parts[1]);
    else openQuestionView({kind:'topic', topicId:parts[1], subtopicId:parts[2]});
    return;
  }
  showHome();
}

function setActiveView(view) {
  $('homeView').hidden = view !== 'home';
  $('catalogView').hidden = view !== 'catalog';
  $('questionView').hidden = view !== 'questions';
}
function setTopCenter(text='') { $('topCenter').innerHTML = text ? `<div class="qid">${esc(text)}</div>` : ''; }
function showHome() { setActiveView('home'); setTopCenter(''); }
function showError(message) { setActiveView('catalog'); $('catalogEyebrow').textContent='ERROR'; $('catalogTitle').textContent='Question Bank'; $('catalogSubtitle').textContent=message; $('catalogGrid').innerHTML=''; }

function sortCatalogItems(items) {
  const q = catalogSearch.trim().toLowerCase();
  const filtered = (items || []).filter(item => !q || String(item.name || '').toLowerCase().includes(q));
  const copy = [...filtered];
  if (catalogSortMode === 'countDesc') return copy.sort((a,b)=>(b.question_count||0)-(a.question_count||0) || String(a.name).localeCompare(String(b.name),undefined,{sensitivity:'base'}));
  if (catalogSortMode === 'countAsc') return copy.sort((a,b)=>(a.question_count||0)-(b.question_count||0) || String(a.name).localeCompare(String(b.name),undefined,{sensitivity:'base'}));
  return copy.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base'}));
}

function updateCatalogSortButton() {
  const icon = catalogSortMode === 'name' ? '↕' : catalogSortMode === 'countDesc' ? '↓' : '↑';
  $('catalogSort').textContent = icon;
  $('catalogSort').title = catalogSortMode === 'name' ? 'Sort by question count' : catalogSortMode === 'countDesc' ? 'Sort by question count ascending' : 'Sort alphabetically';
}

function rerenderCurrentCatalog() {
  const parts = currentRoute.split('/').filter(Boolean);
  if (parts[0] === 'collections') showCollectionCatalog(parts[1], false);
  else if (parts[0] === 'topics') showTopicCatalog(parts[1], false);
  updateCatalogSortButton();
}

function resetCatalogControls(placeholder) {
  $('catalogSearch').value=''; catalogSearch=''; catalogSortMode='name'; $('catalogSort').textContent='↕'; $('catalogSearch').placeholder=placeholder;
  updateCatalogSortButton();
}

function showCollectionCatalog(collectionId, resetTools=true) {
  setActiveView('catalog');
  if (resetTools) resetCatalogControls(collectionId ? 'Search sets…' : 'Search collections…');
  $('catalogView').classList.toggle('collections-root', !collectionId);
  $('catalogEyebrow').textContent='COLLECTIONS';
  if (!collectionId) {
    $('catalogTitle').textContent='Collections & Sets'; $('catalogSubtitle').textContent='Choose a collection to explore its sets.';
    const items = sortCatalogItems(catalog.collections);
    $('catalogGrid').innerHTML = items.map(c => `<button class="catalog-item pattern-square" data-route="collections/${escAttr(c.id)}"><div class="catalog-item-main"><div class="catalog-item-title">${esc(c.name)}</div><div class="catalog-item-meta">${c.question_count || 0} questions</div></div><div class="catalog-item-arrow">→</div></button>`).join('') || `<div class="catalog-empty">${catalogSearch?'No matching collections.':'No collections available.'}</div>`;
    wireCatalogRoutes();
    return;
  }
  const c = catalog.collections.find(x => x.id === collectionId);
  if (!c) return showError('Collection not found.');
  $('catalogEyebrow').textContent='COLLECTION'; $('catalogTitle').textContent=c.name; $('catalogSubtitle').textContent='Choose a set to start practising.';
  const sets = sortCatalogItems(c.sets || []);
  $('catalogGrid').innerHTML = sets.map(s => `<button class="catalog-item pattern-rect" data-route="collections/${escAttr(collectionId)}/${escAttr(s.id)}"><div class="catalog-item-main"><div class="catalog-item-title">${esc(s.name)}</div><div class="catalog-item-meta">${s.question_count || 0} questions</div></div><div class="catalog-item-arrow">→</div></button>`).join('') || `<div class="catalog-empty">${catalogSearch?'No matching sets.':'No sets available.'}</div>`;
  wireCatalogRoutes();
}

function showTopicCatalog(topicId, resetTools=true) {
  setActiveView('catalog');
  if (resetTools) resetCatalogControls(topicId ? 'Search subtopics…' : 'Search topics…');
  $('catalogView').classList.remove('collections-root');
  $('catalogEyebrow').textContent='TOPICS';
  if (!topicId) {
    $('catalogTitle').textContent='Topics & Subtopics'; $('catalogSubtitle').textContent='Choose a topic to explore its subtopics.';
    const items = sortCatalogItems(topicCatalog.topics || []);
    $('catalogGrid').innerHTML = items.map(t => `<button class="catalog-item pattern-tri" data-route="topics/${escAttr(t.id)}"><div class="catalog-item-main"><div class="catalog-item-title">${esc(t.name)}</div><div class="catalog-item-meta">${t.question_count || 0} questions</div></div><div class="catalog-item-arrow">→</div></button>`).join('') || `<div class="catalog-empty">${catalogSearch?'No matching topics.':'No topics available.'}</div>`;
    wireCatalogRoutes();
    return;
  }
  const t = topicCatalog.topics.find(x => x.id === topicId);
  if (!t) return showError('Topic not found.');
  $('catalogEyebrow').textContent='TOPIC'; $('catalogTitle').textContent=t.name; $('catalogSubtitle').textContent='Choose a subtopic to start practising.';
  const subs = sortCatalogItems(t.subtopics || []);
  $('catalogGrid').innerHTML = subs.map(s => `<button class="catalog-item pattern-hex" data-route="topics/${escAttr(topicId)}/${escAttr(s.id)}"><div class="catalog-item-main"><div class="catalog-item-title">${esc(s.name)}</div><div class="catalog-item-meta">${s.question_count || 0} questions</div></div><div class="catalog-item-arrow">→</div></button>`).join('') || `<div class="catalog-empty">${catalogSearch?'No matching subtopics.':'No subtopics available.'}</div>`;
  wireCatalogRoutes();
}

function openQuestionView(context) {
  setActiveView('questions');
  clearPublicFilters(false);
  $('questionView').dataset.kind=context.kind;
  $('questionView').dataset.id=context.kind==='collection'?context.collectionId:context.topicId;
  $('questionView').dataset.subId=context.kind==='collection'?context.setId:context.subtopicId;
  const title = context.kind==='collection' ? (catalog.collections.find(c=>c.id===context.collectionId)?.name || '') : (topicCatalog.topics.find(t=>t.id===context.topicId)?.name || '');
  const subtitle = context.kind==='collection' ? (catalog.collections.find(c=>c.id===context.collectionId)?.sets?.find(s=>s.id===context.setId)?.name || '') : (topicCatalog.topics.find(t=>t.id===context.topicId)?.subtopics?.find(s=>s.id===context.subtopicId)?.name || '');
  $('questionContext').innerHTML = `<div class="public-context-main">${esc(subtitle)}</div>`;
  setTopCenter(title);
  current=null; selectedAnswers.clear(); answerChecked=false;
  $('preview').innerHTML='<div class="public-empty-question">Select a question from the list.</div>';
  $('groupPreview').hidden=true;
  resetQuestionList().then(() => { if (questionRows[0]) loadQuestion(questionRows[0].id); });
}

async function resetQuestionList() {
  const token = ++questionRequestToken;
  questionPage = 1;
  questionTotal = 0;
  questionRows = [];
  $('questionList').innerHTML = '';
  await fetchQuestionPage(1, token, true);
}

async function fetchQuestionPage(page, token, replace) {
  const data = await apiJson(`/api/questions?${queryString({page, page_size:50})}`);

  // A newer navigation/filter change has started another request.
  // Do not let this stale response overwrite the current question set.
  if (token !== questionRequestToken) return false;

  if (replace) questionRows = [];
  questionRows.push(...(data.questions || []));
  questionTotal = data.total || 0;
  questionPage = page;
  renderQuestionList();
  return true;
}

async function loadMoreQuestions() {
  if (questionLoading || questionRows.length >= questionTotal) return;

  const token = questionRequestToken;
  const nextPage = questionPage + 1;
  questionLoading = true;

  try {
    await fetchQuestionPage(nextPage, token, false);
  } finally {
    questionLoading = false;
  }
}

function renderQuestionList() {
  $('questionList').innerHTML = questionRows.map(q => `<div class="qitem ${current?.id===q.id?'active':''}" data-id="${escAttr(q.id)}"><div class="qnum"><span>${esc(String(q.question_number||''))}</span></div><div class="qbody"><div class="qtext">${esc(q.preview||'(empty)')}</div><div class="qmeta">${q.grade?`Grade ${esc(q.grade)}`:''}${q.type?` · ${esc(q.type)}`:''}</div></div></div>`).join('');
  document.querySelectorAll('.public-sidebar .qitem').forEach(el=>el.onclick=()=>loadQuestion(el.dataset.id));
  $('count').textContent=`${questionRows.length} of ${questionTotal}`;
  $('filterBtn').classList.toggle('active-filter', Object.values(questionFilters()).some(Boolean));
  updateQuestionNavButtons();
  scrollActiveQuestionIntoView();
}

function scrollActiveQuestionIntoView() {
  if (!current) return;
  const item=[...document.querySelectorAll('#questionList .qitem')].find(el=>el.dataset.id===current.id);
  if(item) item.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function getAnswerLetters() {
  if (Array.isArray(current?.answer)) return current.answer.map(String);
  if (typeof current?.answer==='string' && current.answer.trim()) return current.answer.split(',').map(x=>x.trim());
  return [];
}
function answersMatch(a,b){ if(a.length!==b.length)return false; const x=[...a].sort(), y=[...b].sort(); return x.every((v,i)=>v===y[i]); }

function togglePublicOption(letter) {
  if(answerChecked){answerChecked=false;}
  if(selectedAnswers.has(letter)) selectedAnswers.delete(letter); else selectedAnswers.add(letter);
  document.querySelectorAll('.pv-option').forEach(el=>el.classList.toggle('selected',selectedAnswers.has(el.dataset.letter)));
}

function checkAnswer() {
  const preview=$('preview');
  const correct=getAnswerLetters();
  const result=document.createElement('div'); result.className='check-answer-result';
  if(current.type==='MCQ'){
    if(!correct.length){result.textContent='Answer is not available.'; result.classList.add('incorrect');}
    else if(!selectedAnswers.size){result.textContent='Select an answer first.'; result.classList.add('incorrect');}
    else{
      const ok=answersMatch([...selectedAnswers],correct); result.textContent=ok?'Correct':'Incorrect'; result.classList.add(ok?'correct':'incorrect');
      preview.querySelectorAll('.pv-option').forEach(el=>{const l=el.dataset.letter;if(correct.includes(l))el.classList.add(selectedAnswers.has(l)?'correct':'missed-correct');else if(selectedAnswers.has(l))el.classList.add('incorrect');}); answerChecked=true;
    }
  }
  preview.querySelector('.check-answer-result')?.remove();
  const button=preview.querySelector('.check-answer-btn'); if(button) button.insertAdjacentElement('afterend',result);
  const sol=preview.querySelector('.public-solution-reveal'); if(sol)sol.hidden=false;
}

async function loadQuestion(id) {
  current=await apiJson(`/api/questions/${encodeURIComponent(id)}`);
  selectedAnswers.clear(); answerChecked=false;
  renderQuestion(); await renderGroupPreview(); renderQuestionList();
}

function renderQuestion() {
  const preview=$('preview'); preview.innerHTML='';
  const holder=document.createElement('div'); holder.className='preview-content'; renderContent(holder,current.content||[], { typeset: false }); preview.appendChild(holder);
  if(current.type==='MCQ'){
    const options=document.createElement('div'); options.className='pv-options';
    for(const label of ['A','B','C','D']){
      const option=document.createElement('button'); option.type='button'; option.className='pv-option'; option.dataset.letter=label; option.onclick=()=>togglePublicOption(label);
      const letter=document.createElement('div'); letter.className='pv-letter'; letter.textContent=label;
      const body=document.createElement('div'); body.className='pv-text'; renderContent(body,current.options?.[label]||[], { typeset: false }); option.append(letter,body); options.appendChild(option);
    }
    preview.appendChild(options);
  }
  const check=document.createElement('button'); check.type='button'; check.className='btn secondary check-answer-btn'; check.textContent='Check Answer'; check.onclick=checkAnswer; preview.appendChild(check);
  const solution=document.createElement('div'); solution.className='public-solution-reveal'; solution.hidden=true;
  const label=document.createElement('div'); label.className='public-solution-label'; label.textContent='Solution';
  const body=document.createElement('div'); body.className='public-solution-body'; if(current.solution?.length) renderContent(body,current.solution, { typeset: false }); else body.textContent='Solution is not available.';
  solution.append(label,body); preview.appendChild(solution);
  const uuid=document.createElement('div'); uuid.className='pv-uuid'; uuid.textContent=current.id||''; preview.appendChild(uuid);
  typesetMath(preview);
}

async function getGroup(gid){ if(groupCache.has(gid))return groupCache.get(gid); const g=await apiJson(`/api/groups/${encodeURIComponent(gid)}`); groupCache.set(gid,g); return g; }
async function renderGroupPreview(){
  const panel=$('groupPreview'); if(!current?.group_id){panel.hidden=true;return;} panel.hidden=false;
  const group=await getGroup(current.group_id); const ids=group.children||[]; const idx=ids.indexOf(current.id);
  $('groupPreviewTitle').textContent=`Group Question (${ids.length} ${ids.length===1?'part':'parts'})`; $('groupPrevBtn').disabled=idx<=0; $('groupNextBtn').disabled=idx<0||idx>=ids.length-1;
  renderContent($('groupContent'),group.content||[], { typeset: false });
  typesetMath($('groupContent'));
}
async function navigateGroup(delta){if(!current?.group_id)return;const g=await getGroup(current.group_id);const ids=g.children||[];const i=ids.indexOf(current.id);if(ids[i+delta])loadQuestion(ids[i+delta]);}

async function updateQuestionNavButtons(){
  if(!current){$('prevBtn').disabled=true;$('nextBtn').disabled=true;return;}
  const data=await apiJson(`/api/questions/${encodeURIComponent(current.id)}/neighbors?${queryString()}`);
  $('prevBtn').disabled=!data.previous; $('nextBtn').disabled=!data.next;
}
async function navigateGlobal(delta){
  if(!current)return; const data=await apiJson(`/api/questions/${encodeURIComponent(current.id)}/neighbors?${queryString()}`); const id=delta<0?data.previous:data.next; if(id)loadQuestion(id);
}

updateCatalogSortButton();
