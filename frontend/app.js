let allQ = [], current = null, currentIndex = -1, dirty = false, topicCatalog = { topics: [] }, tagPool = [], catalog = { collections: [] };
let groupCache = new Map();
let visibleCount = 50;

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };
const escAttr = s => String(s ?? "").replace(/"/g, "&quot;");

document.addEventListener("DOMContentLoaded", async () => {
    await Promise.all([loadQuestions(), loadTopics(), loadTags(), loadCatalog()]);
    buildGradeLists(); buildCatalogControls(); wire(); renderList();
});

async function loadQuestions() { const r = await fetch("/api/questions"); allQ = (await r.json()).questions || []; }
async function loadTopics() { const r = await fetch("/api/topics"); topicCatalog = await r.json(); topicCatalog.topics = topicCatalog.topics || []; }
async function loadTags() { const r = await fetch("/api/tags"); tagPool = await r.json(); }
async function loadCatalog() { const r = await fetch("/api/collections"); catalog = await r.json(); catalog.collections = catalog.collections || []; }

function buildGradeLists() {
    const opts = ['<option value="">—</option>', ...Array.from({ length: 12 }, (_, i) => `<option>${i + 1}</option>`), '<option>12+</option>'].join("");
    $("grade").innerHTML = opts;
    $("filterGrade").innerHTML = '<option value="">All Grades</option>' + Array.from({ length: 12 }, (_, i) => `<option>${i + 1}</option>`).join("") + "<option>12+</option>";
}
function collectionsOptions(includeBlank = true) {
    return (includeBlank ? '<option value="">Select collection…</option>' : '') + catalog.collections.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");
}
function setsForCollection(cid, includeBlank = true) {
    const c = catalog.collections.find(x => x.id === cid); if (!c) return includeBlank ? '<option value="">Select set…</option>' : '';
    return (includeBlank ? '<option value="">Select set…</option>' : '') + (c.sets || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join("");
}
function topicsOptions(includeBlank = true) {
    return (includeBlank ? '<option value="">Select topic…</option>' : '') + topicCatalog.topics.map(t => `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`).join("");
}
function subtopicsForTopic(tid, includeBlank = true) {
    const t = topicCatalog.topics.find(x => x.id === tid); if (!t) return includeBlank ? '<option value="">Select subtopic…</option>' : '';
    return (includeBlank ? '<option value="">Select subtopic…</option>' : '') + (t.subtopics || []).map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join("");
}

function buildCatalogControls() {
    $("bulkCollection").innerHTML = '<option value="">Select collection…</option>' + catalog.collections.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");
    $("filterCollection").innerHTML = '<option value="">All Collections</option>' + catalog.collections.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");

    updateFilterTopicSelect();
    updateFilterSetSelect();
    updateBulkSetSelect();
}

function updateFilterTopicSelect() {
    const topicSelect = $("filterTopic");
    const subtopicSelect = $("filterSubtopic");
    if (!topicSelect || !subtopicSelect) return;

    const currentTopic = topicSelect.value;
    const currentSubtopic = subtopicSelect.value;

    topicSelect.innerHTML =
        '<option value="">All Topics</option>' +
        '<option value="__UNMAPPED_TOPIC__">Unmapped — No Topic</option>' +
        topicCatalog.topics.map(t =>
            `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`
        ).join("");

    topicSelect.value = currentTopic;

    subtopicSelect.innerHTML =
        '<option value="">All Subtopics</option>' +
        (currentTopic === "__UNMAPPED_TOPIC__"
            ? ""
            : '<option value="__UNMAPPED_SUBTOPIC__">Unmapped — No Subtopic</option>' +
            (currentTopic ? subtopicsForTopic(currentTopic, false) : ""));

    const validSubtopic = currentTopic &&
        currentTopic !== "__UNMAPPED_TOPIC__" &&
        (currentSubtopic === "__UNMAPPED_SUBTOPIC__" ||
            (topicCatalog.topics.find(t => t.id === currentTopic)?.subtopics || [])
                .some(st => st.id === currentSubtopic));

    subtopicSelect.value = validSubtopic ? currentSubtopic : "";

    renderList();
}

function updateFilterSetSelect() {
    const cid = $("filterCollection").value;
    $("filterSet").innerHTML = '<option value="">All Sets</option>' + setsForCollection(cid, false);
    renderList();
}

function updateBulkSetSelect() {
    const cid = $("bulkCollection").value;
    $("bulkSet").innerHTML = '<option value="">Select set…</option>' + setsForCollection(cid, false);
}

function wire() {
    $("search").oninput = () => renderList(); $("filterTag").oninput = () => renderList();
    $("filterCollection").onchange = updateFilterSetSelect; $("filterSet").onchange = () => renderList();
    $("filterTopic").onchange = updateFilterTopicSelect; $("filterSubtopic").onchange = () => renderList();
    $("filterType").onchange = () => renderList();
    $("filterGrade").onchange = () => renderList(); $("filterDifficulty").onchange = () => renderList(); $("filterMarks").onchange = () => renderList(); $("filterStatus").onchange = () => renderList();

    $("filterBtn").onclick = () => $("filterModal").classList.add("open");
    $("filterClose").onclick = () => $("filterModal").classList.remove("open");
    $("applyFiltersBtn").onclick = () => $("filterModal").classList.remove("open");
    $("clearFilters").onclick = () => {
        $("filterStatus").value = "all";
        $("filterType").value = "";
        $("filterTag").value = "";
        $("filterCollection").value = "";
        $("filterGrade").value = "";
        $("filterDifficulty").value = "";
        $("filterMarks").value = "";

        if ($("filterTopic")) $("filterTopic").value = "";
        if ($("filterSubtopic")) $("filterSubtopic").value = "";

        updateFilterTopicSelect();
        updateFilterSetSelect();
        renderList();
    };

    $("questionList").onscroll = (e) => {
        if (e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 150) {
            if (visibleCount < filteredQuestions().length) {
                visibleCount += 50;
                renderList(true);
            }
        }
    };

    $("prevBtn").onclick = () => navigate(-1); $("nextBtn").onclick = () => navigate(1);
    $("groupPrevBtn").onclick = () => navigateGroup(-1); $("groupNextBtn").onclick = () => navigateGroup(1);
    $("saveBtn").onclick = saveQuestion;
    $("question").oninput = () => { markDirty(); renderPreview(); }; $("solution").oninput = () => { markDirty(); renderPreview(); };
    $("reviewNotes").oninput = markDirty; $("difficulty").onchange = markDirty; $("grade").onchange = markDirty; $("marks").oninput = markDirty;

    $("addTopic").onclick = () => { const t = getTopics(); t.push({ topic_id: "", subtopic_id: "" }); renderTopics(t); markDirty(); };
    $("addCollection").onclick = () => { const c = getCollections(); c.push({ collection_id: "", set_id: "" }); renderCollections(c); markDirty(); };

    $("tagInput").onkeydown = tagKey; $("tagInput").oninput = tagSuggest;
    $("sourceToggle").onclick = () => { const b = $("sourceBody"); b.classList.toggle("open"); $("sourceChevron").textContent = b.classList.contains("open") ? "⌃" : "⌄"; };
    $("bulkBtn").onclick = openBulk; $("bulkClose").onclick = closeBulk; $("bulkCancel").onclick = closeBulk; $("bulkApply").onclick = applyBulk;
    $("bulkCollection").onchange = updateBulkSetSelect;
    ["bulkModal", "filterModal"].forEach(id => $(id).onclick = e => { if (e.target === $(id)) $(id).classList.remove("open") });
    document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveQuestion(); } if (e.key === "ArrowLeft" && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) navigate(-1); if (e.key === "ArrowRight" && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) navigate(1); if (e.key === "Escape") { closeBulk(); $("filterModal").classList.remove("open"); } });
}

function filteredQuestions() {
    const s = $("search").value.toLowerCase();
    const tag = $("filterTag").value.trim().toLowerCase();
    const fg = $("filterGrade").value;
    const fd = $("filterDifficulty").value;
    const fm = $("filterMarks").value;
    const fc = $("filterCollection").value;
    const fs = $("filterSet").value;
    const ft = $("filterTopic")?.value || "";
    const fst = $("filterSubtopic")?.value || "";
    const status = $("filterStatus").value;
    const ftype = $("filterType").value;

    const hasFilter = s || tag || fg || fd || fm || fc || fs || ft || fst || ftype || status !== "all";
    $("filterBtn").classList.toggle("active-filter", !!hasFilter);

    return allQ.filter(q => {
        if (status !== "all" && q.review_status !== status && q.publication_status !== status) return false;
        const qCols = q.collections || [];
        const qTopics = q.topics || [];

        if (ftype && q.type !== ftype) return false;
        if (fc && !qCols.some(c => c.collection_id === fc)) return false;
        if (fs && !qCols.some(c => c.set_id === fs)) return false;

        // Topic behaves like Collection; Subtopic behaves like Set.
        // "Unmapped" lets us find questions whose external mapping is missing.
        if (ft === "__UNMAPPED_TOPIC__") {
            if (qTopics.length !== 0) return false;
        } else if (ft && !qTopics.some(t => t.topic_id === ft)) {
            return false;
        }

        if (fst === "__UNMAPPED_SUBTOPIC__") {
            if (ft === "__UNMAPPED_TOPIC__") {
                return false;
            }
            if (ft) {
                if (!qTopics.some(t => t.topic_id === ft && !t.subtopic_id)) return false;
            } else {
                if (qTopics.length !== 0 && !qTopics.some(t => !t.subtopic_id)) return false;
            }
        } else if (fst) {
            if (!qTopics.some(t => t.topic_id === ft && t.subtopic_id === fst)) return false;
        }

        if (tag && !(q.tags || []).some(t => String(t).toLowerCase().includes(tag))) return false;
        if (fg && String(q.grade) !== fg) return false; if (fd && (q.difficulty || "") !== fd) return false; if (fm && String(q.marks) !== fm) return false;
        if (s) { const h = [q.preview, q.id, q.grade, q.type, ...(q.tags || []), JSON.stringify(q.topics || []), JSON.stringify(qCols)].join(" ").toLowerCase(); if (!h.includes(s)) return false; }
        return true;
    });
}
function renderList(append = false) {
    if (!append) visibleCount = 50;
    const filtered = filteredQuestions();
    const iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;

    $("questionList").innerHTML = filtered.slice(0, visibleCount).map(q => {
        const gradeLabel = q.grade ? `<span class="qmeta-grade">Grade ${esc(q.grade)}</span>` : "";
        const typeLabel = q.type ? `<span class="qmeta-type">${esc(q.type)}</span>` : "";
        const metaHtml = [gradeLabel, typeLabel].filter(Boolean).join(" · ");
        return `<div class="qitem ${current && current.id === q.id ? "active" : ""}" data-id="${escAttr(q.id)}"><div class="qnum">${iconSvg}</div><div class="qbody"><div class="qtext">${esc(q.preview || "(empty)")}</div>${metaHtml ? `<div class="qmeta">${metaHtml}</div>` : ""}</div></div>`;
    }).join("");
    document.querySelectorAll(".qitem").forEach(el => el.onclick = () => loadQuestion(el.dataset.id));
    $("count").textContent = `${Math.min(visibleCount, filtered.length)} of ${filtered.length}`;
    updateQuestionNavButtons();
}

function updateQuestionNavButtons() {
    $("prevBtn").disabled = currentIndex <= 0;
    $("nextBtn").disabled = currentIndex < 0 || currentIndex >= allQ.length - 1;
}

function scrollActiveQuestionIntoView() {
    if (!current) return;

    const filtered = filteredQuestions();
    const index = filtered.findIndex(q => q.id === current.id);

    if (index < 0) return;

    // Make sure the target question has actually been rendered.
    if (index >= visibleCount) {
        visibleCount = Math.min(filtered.length, index + 1);
        renderList(true);
    }

    requestAnimationFrame(() => {
        const items = document.querySelectorAll("#questionList .qitem");
        const item = [...items].find(el => el.dataset.id === current.id);

        if (item) {
            item.scrollIntoView({
                behavior: "smooth",
                block: "nearest"
            });
        }
    });
}

async function loadQuestion(id) {
    if (dirty && !confirm("Unsaved changes will be lost. Continue?")) return;
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}`); if (!r.ok) { toast("Load failed", "err"); return; }
    current = await r.json(); current.topics = current.topics || []; current.tags = current.tags || []; current.collections = current.collections || [];
    current.group_id = current.group_id || null;
    currentIndex = allQ.findIndex(q => q.id === current.id); dirty = false;
    renderEditor();
    await renderGroupPreview();
    renderList(true);
    scrollActiveQuestionIntoView();
}

function formatQuestionType(type) {
    if (type === "SUBJECTIVE") return "SUBJECTIVE";
    if (type === "MCQ") return "MCQ";
    return type || "—";
}

function groupChildIds(group) {
    const listed = Array.isArray(group?.children)
        ? group.children.map(x => typeof x === "string" ? x : (x?.id || x?.uuid)).filter(Boolean)
        : [];

    if (listed.length) return listed;

    const gid = current?.group_id;
    return gid ? allQ.filter(q => q.group_id === gid).map(q => q.id) : [];
}

async function getGroup(gid) {
    if (!gid) return null;
    if (groupCache.has(gid)) return groupCache.get(gid);

    const r = await fetch(`/api/groups/${encodeURIComponent(gid)}`);
    if (!r.ok) return null;

    const group = await r.json();
    groupCache.set(gid, group);
    return group;
}

async function renderGroupPreview() {
    const panel = $("groupPreview");
    const title = $("groupPreviewTitle");
    const content = $("groupContent");
    const prev = $("groupPrevBtn");
    const next = $("groupNextBtn");

    if (!current?.group_id) {
        panel.hidden = true;
        content.innerHTML = "";
        return;
    }

    panel.hidden = false;
    title.textContent = "Group Question";
    content.textContent = "Loading group question…";
    prev.disabled = true;
    next.disabled = true;

    const gid = current.group_id;
    const group = await getGroup(gid);
    if (!current || current.group_id !== gid) return;

    const childIds = groupChildIds(group);
    const partIndex = childIds.indexOf(current.id);
    const partCount = childIds.length;
    title.textContent = `Group Question (${partCount || 0} ${partCount === 1 ? "part" : "parts"})`;
    prev.disabled = partIndex <= 0;
    next.disabled = partIndex < 0 || partIndex >= partCount - 1;

    content.innerHTML = "";
    const groupText = group?.content ?? group?.question ?? "";

    if (!group) {
        appendPreviewText(content, "Group content could not be loaded.");
    } else if (groupText) {
        appendPreviewText(content, typeof groupText === "string" ? groupText : JSON.stringify(groupText));
    } else {
        appendPreviewText(content, "[Group question content is empty]");
    }

    if (window.MathJax?.typesetPromise) {
        MathJax.typesetPromise([content]).catch(() => { });
    }
}

async function navigateGroup(delta) {
    if (!current?.group_id) return;
    const group = await getGroup(current.group_id);
    const ids = groupChildIds(group);
    const i = ids.indexOf(current.id);
    const target = ids[i + delta];
    if (target) await loadQuestion(target);
}

function renderEditor() {
    $("editorType").textContent = formatQuestionType(current.type);
    $("question").value = current.question || ""; $("solution").value = current.solution || ""; $("difficulty").value = current.difficulty || ""; $("grade").value = current.grade || ""; $("marks").value = current.marks ?? 1; $("reviewNotes").value = current.review?.notes || "";
    renderOptions(); renderTopics(current.topics || []); renderCollections(current.collections || []); renderTags(current.tags || []); renderStatuses(); renderSource(); renderPreview(); updateDirtyUI();
}
function getAnswerArray() {
    if (Array.isArray(current.answer)) {
        return current.answer;
    }

    if (typeof current.answer === "string" && current.answer.trim()) {
        return current.answer
            .split(",")
            .map(x => x.trim())
            .filter(Boolean);
    }

    return [];
}

function renderOptions() {
    const opts = current.options || {};
    const ans = getAnswerArray();

    // Convert legacy "A,B" string into the proper array representation
    if (typeof current.answer === "string" && current.answer.includes(",")) {
        current.answer = ans;
    }

    if (current.type !== "MCQ") {
        $("optionsField").style.display = "none";
        return;
    }

    $("optionsField").style.display = "";

    $("options").innerHTML = ["A", "B", "C", "D"].map(l =>
        `<div class="option-row">
            <div class="option-label ${ans.includes(l) ? "answer" : ""}">${l}</div>
            <input class="option-input" id="opt-${l}" value="${escAttr(opts[l] || "")}" />
            <button class="answer-btn ${ans.includes(l) ? "active" : ""}" data-letter="${l}">✓</button>
        </div>`
    ).join("");

    ["A", "B", "C", "D"].forEach(l => {
        $(`opt-${l}`).oninput = () => {
            current.options = current.options || {};
            current.options[l] = $(`opt-${l}`).value;
            markDirty();
            renderPreview();
        };
    });

    document.querySelectorAll(".answer-btn").forEach(
        b => b.onclick = () => toggleAnswer(b.dataset.letter)
    );
}

function toggleAnswer(letter) {
    const ans = getAnswerArray();
    let a = [...ans];

    if (a.includes(letter)) {
        a = a.filter(x => x !== letter);
    } else {
        a.push(letter);
    }

    if (a.length === 1) {
        current.answer = a[0];
    } else if (a.length === 0) {
        current.answer = null;
    } else {
        current.answer = a;
    }

    markDirty();
    renderOptions();
    renderPreview();
}

function renderTopics(list) {
    const rows = list.length ? list : [{ topic_id: "", subtopic_id: "" }];
    $("topics").innerHTML = rows.map((x, i) => {
        return `<div class="topic-row">
      <select class="topic-select">${topicsOptions(true)}</select>
      <select class="subtopic-select">${subtopicsForTopic(x.topic_id, true)}</select>
      <button class="remove-topic" data-i="${i}">×</button>
    </div>`;
    }).join("");

    const topSelects = document.querySelectorAll(".topic-select");
    const subSelects = document.querySelectorAll(".subtopic-select");

    topSelects.forEach((ts, i) => {
        ts.value = rows[i].topic_id || "";
        subSelects[i].value = rows[i].subtopic_id || "";

        ts.onchange = () => {
            const a = getTopics();
            a[i] = { topic_id: ts.value, subtopic_id: "" };
            renderTopics(a);
            markDirty();
        };
        subSelects[i].onchange = () => {
            const a = getTopics();
            a[i] = { topic_id: ts.value, subtopic_id: subSelects[i].value };
            current.topics = a;
            markDirty();
        };
    });

    document.querySelectorAll(".remove-topic").forEach(b => b.onclick = () => {
        const a = getTopics(); a.splice(Number(b.dataset.i), 1); renderTopics(a); markDirty();
    });
}
function getTopics() {
    return [...document.querySelectorAll(".topic-row")].map(r => ({
        topic_id: r.querySelector(".topic-select")?.value || "",
        subtopic_id: r.querySelector(".subtopic-select")?.value || ""
    })).filter(x => x.topic_id);
}

function renderCollections(list) {
    const rows = list.length ? list : [{ collection_id: "", set_id: "" }];
    $("collectionsList").innerHTML = rows.map((x, i) => {
        return `<div class="collection-row">
      <select class="col-select">${collectionsOptions(true)}</select>
      <select class="set-select">${setsForCollection(x.collection_id, true)}</select>
      <button class="remove-collection" data-i="${i}">×</button>
    </div>`;
    }).join("");

    const colSelects = document.querySelectorAll(".col-select");
    const setSelects = document.querySelectorAll(".set-select");

    colSelects.forEach((cs, i) => {
        cs.value = rows[i].collection_id || "";
        setSelects[i].value = rows[i].set_id || "";

        cs.onchange = () => {
            const a = getCollections();
            a[i] = { collection_id: cs.value, set_id: "" };
            renderCollections(a);
            markDirty();
        };
        setSelects[i].onchange = () => {
            const a = getCollections();
            a[i] = { collection_id: cs.value, set_id: setSelects[i].value };
            current.collections = a;
            markDirty();
        };
    });

    document.querySelectorAll(".remove-collection").forEach(b => b.onclick = () => {
        const a = getCollections(); a.splice(Number(b.dataset.i), 1); renderCollections(a); markDirty();
    });
}
function getCollections() {
    return [...document.querySelectorAll(".collection-row")].map(r => ({
        collection_id: r.querySelector(".col-select")?.value || "",
        set_id: r.querySelector(".set-select")?.value || ""
    })).filter(x => x.collection_id);
}

function renderTags(tags) { const box = $("tagBox"), input = $("tagInput"); box.querySelectorAll(".tag").forEach(x => x.remove()); tags.forEach(t => addTagDOM(t, false)); input.value = ""; }
function addTagDOM(t, dirtyIt = true) { if (!t) return; const existing = [...document.querySelectorAll(".tag")].map(x => x.dataset.tag); if (existing.includes(t)) return; const box = $("tagBox"), input = $("tagInput"), s = document.createElement("span"); s.className = "tag"; s.dataset.tag = t; s.innerHTML = `${esc(t)} <span class="tag-x">×</span>`; s.querySelector(".tag-x").onclick = () => { s.remove(); markDirty(); }; box.insertBefore(s, input); if (dirtyIt) markDirty(); }
function addTag(t) { addTagDOM(t, true); $("tagInput").value = ""; $("tagSuggestions").classList.remove("open"); }
function tagSuggest() { const v = $("tagInput").value.trim().toLowerCase(), used = new Set([...document.querySelectorAll(".tag")].map(x => x.dataset.tag)); const matches = tagPool.filter(t => t.toLowerCase().includes(v) && !used.has(t)).slice(0, 8), box = $("tagSuggestions"); if (!v || !matches.length) { box.classList.remove("open"); return } box.innerHTML = matches.map(t => `<div class="suggestion">${esc(t)}</div>`).join(""); box.classList.add("open"); box.querySelectorAll(".suggestion").forEach((el, i) => el.onclick = () => addTag(matches[i])); }
function tagKey(e) { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag($("tagInput").value.trim().replace(/,/g, "")); } }

function renderStatuses() {
    const rs = ["NEEDS_REVIEW", "REVIEWED"];
    $("reviewStatus").innerHTML = rs.map(s => `<button class="status-btn ${current.review_status === s ? "active " + (s === "REVIEWED" ? "reviewed" : "review") : ""}">${s.replace("_", " ")}</button>`).join("");
    $("reviewStatus").querySelectorAll("button").forEach((b, i) => b.onclick = () => { current.review_status = rs[i]; markDirty(); renderStatuses(); });

    const ps = ["DRAFT", "PUBLISHED"];
    $("pubStatus").innerHTML = ps.map(s => `<button class="status-btn ${current.publication_status === s ? "active " + (s === "PUBLISHED" ? "pub" : "draft") : ""}">${s}</button>`).join("");
    $("pubStatus").querySelectorAll("button").forEach((b, i) => b.onclick = () => { current.publication_status = ps[i]; markDirty(); renderStatuses(); });
}
function renderSource() { const s = current.source || {}, b = $("sourceBody"), src = `/api/questions/${encodeURIComponent(current.id)}/source`; b.innerHTML = `<img src="${src}" alt="Original source page"><div class="source-meta">Page ${(s.pages || []).join(", ") || "—"} · ${esc(s.title || "")}${s.question_number != null ? ` · Question ${esc(String(s.question_number))}` : ""}</div>`; const img = b.querySelector("img"); if (img) img.onerror = () => { b.innerHTML = `<div class="source-meta">Source image not found. Expected source.png beside question.json.</div>`; }; }
// function renderPreview(){if(!current)return; let h=`<div class="pv-question">${$("question").value||'<span class="empty">[Question]</span>'}</div>`;if(current.type==="MCQ"){h+=`<div class="pv-options">`;for(const l of ["A","B","C","D"]){const v=$(`opt-${l}`)?.value??current.options?.[l]??"";h+=`<div class="pv-option"><div class="pv-letter">${l}</div><div class="pv-text">${v}</div></div>`;}h+="</div>";}const sol=$("solution").value;if(sol)h+=`<div class="pv-solution"><div class="field label">SOLUTION</div>${sol}</div>`;$("preview").innerHTML=h;if(window.MathJax?.typesetPromise)MathJax.typesetPromise([$("preview")]).catch(()=>{});}
function markDirty() { dirty = true; updateDirtyUI(); } function updateDirtyUI() { $("saveBtn").disabled = !dirty; }
async function saveQuestion() {
    if (!current) return; current.question = $("question").value; current.solution = $("solution").value; current.difficulty = $("difficulty").value; current.grade = $("grade").value; current.marks = Number($("marks").value) || 1; current.review = current.review || {}; current.review.notes = $("reviewNotes").value; current.topics = getTopics(); current.tags = [...document.querySelectorAll(".tag")].map(x => x.dataset.tag);
    current.collections = getCollections();

    if (current.type === "MCQ") { current.options = current.options || {}; for (const l of ["A", "B", "C", "D"]) { const el = $(`opt-${l}`); if (el) current.options[l] = el.value; } }
    delete current.collection_id; delete current.set_id;
    const r = await fetch(`/api/questions/${encodeURIComponent(current.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current) }); const d = await r.json(); if (!d.success) { toast(d.error || "Save failed", "err"); return } dirty = false; updateDirtyUI(); await loadQuestions(); currentIndex = allQ.findIndex(q => q.id === current.id); renderList(true); toast("Saved", "ok");
}
function navigate(delta) { if (dirty && !confirm("Unsaved changes will be lost. Continue?")) return; const i = currentIndex + delta; if (i < 0 || i >= allQ.length) return; loadQuestion(allQ[i].id); }



function openBulk() { const qs = filteredQuestions(); if (!qs.length) return toast("No questions match the current filters", "err"); $("bulkCount").textContent = `${qs.length} filtered question${qs.length === 1 ? "" : "s"} will be updated`; $("bulkCollection").value = ""; updateBulkSetSelect(); $("bulkModal").classList.add("open"); }
function closeBulk() { $("bulkModal").classList.remove("open"); }
async function applyBulk() { const ids = filteredQuestions().map(q => q.id), cid = $("bulkCollection").value, sid = $("bulkSet").value; if (!cid || !sid) return toast("Select both a collection and a set", "err"); const c = catalog.collections.find(x => x.id === cid), s = (c?.sets || []).find(x => x.id === sid); if (!confirm(`Assign ${ids.length} question(s) to “${c.name} → ${s.name}”? Existing collection/set values will be overwritten.`)) return; $("bulkApply").disabled = true; try { const r = await fetch("/api/questions/bulk-assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, collection_id: cid, set_id: sid }) }); const d = await r.json(); if (!d.success) { toast(d.error || "Bulk update failed", "err"); return } closeBulk(); await loadQuestions(); if (current) { const refreshed = allQ.find(q => q.id === current.id); if (refreshed) { current.collections = refreshed.collections || []; renderEditor(); } } renderList(); toast(`${d.updated} question(s) updated`, "ok"); } finally { $("bulkApply").disabled = false; } }

function toast(msg, type = "") { const t = $("toast"); t.textContent = msg; t.className = `toast ${type} on`; setTimeout(() => t.classList.remove("on"), 2200); }

// manual edits
function appendPreviewText(parent, text) {
    if (text == null) return;

    const normalized = String(text)
        .replace(/<br\s*\/?>/gi, "\n");

    const parts = normalized.split("\n");

    parts.forEach((part, i) => {
        if (i > 0) parent.appendChild(document.createElement("br"));

        parent.appendChild(document.createTextNode(part));
    });
}

function renderPreview() {
    if (!current) return;

    const preview = $("preview");
    preview.innerHTML = "";

    // Question
    const questionEl = document.createElement("div");
    questionEl.className = "pv-question";

    const question = $("question").value;

    if (question) {
        appendPreviewText(questionEl, question);
    } else {
        questionEl.innerHTML = '<span class="empty">[Question]</span>';
    }

    preview.appendChild(questionEl);

    // MCQ options
    if (current.type === "MCQ") {
        const optionsEl = document.createElement("div");
        optionsEl.className = "pv-options";

        for (const l of ["A", "B", "C", "D"]) {
            const v = $(`opt-${l}`)?.value ?? current.options?.[l] ?? "";

            const optionEl = document.createElement("div");
            optionEl.className = "pv-option";

            const letterEl = document.createElement("div");
            letterEl.className = "pv-letter";
            letterEl.textContent = l;

            const textEl = document.createElement("div");
            textEl.className = "pv-text";
            appendPreviewText(textEl, v);

            optionEl.appendChild(letterEl);
            optionEl.appendChild(textEl);
            optionsEl.appendChild(optionEl);
        }

        preview.appendChild(optionsEl);
    }

    // Solution
    const sol = $("solution").value;

    if (sol) {
        const solutionEl = document.createElement("div");
        solutionEl.className = "pv-solution";

        const label = document.createElement("div");
        label.className = "field label";
        label.textContent = "SOLUTION";

        const solutionText = document.createElement("div");
        solutionText.className = "pv-solution-text";

        appendPreviewText(solutionText, sol);

        solutionEl.appendChild(label);
        solutionEl.appendChild(solutionText);

        preview.appendChild(solutionEl);
    }

    // UUID
    const uuidEl = document.createElement("div");
    uuidEl.className = "pv-uuid";
    uuidEl.textContent = current.id || "";

    preview.appendChild(uuidEl);

    // Let MathJax typeset the actual DOM we just created.
    if (window.MathJax?.typesetPromise) {
        MathJax.typesetPromise([preview]).catch(() => { });
    }
}