
let allQ = [];
let current = null;
let currentIndex = -1;
let topicCatalog = { topics: [] };
let catalog = { collections: [] };
let groupCache = new Map();
let visibleCount = 50;
let catalogSearch = "";
let catalogSortMode = "name";
let selectedAnswers = new Set();
let answerChecked = false;
let currentRoute = "home";

const $ = id => document.getElementById(id);

const esc = value => {
    const d = document.createElement("div");
    d.textContent = value ?? "";
    return d.innerHTML;
};

const escAttr = value => String(value ?? "").replace(/"/g, "&quot;");

function nonGroupQuestions(list) {
    return (list || []).filter(q => q && q.type !== "GROUP");
}

async function apiJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Request failed: ${r.status}`);
    return r.json();
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await Promise.all([loadQuestions(), loadTopics(), loadCatalog()]);
        buildFilterControls();
        wireNavigation();
        routeFromState();
    } catch (err) {
        console.error(err);
        showError("Could not load the question bank.");
    }
});

async function loadQuestions() {
    const data = await apiJson("/api/questions");

    allQ = nonGroupQuestions(data.questions || []).sort((a, b) => {
        const na = Number(a.source?.question_number ?? a.question_number);
        const nb = Number(b.source?.question_number ?? b.question_number);

        const aMissing = Number.isNaN(na);
        const bMissing = Number.isNaN(nb);

        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;

        return na - nb;
    });
}

async function loadTopics() {
    topicCatalog = await apiJson("/api/topics");
    topicCatalog.topics = topicCatalog.topics || [];
}

async function loadCatalog() {
    catalog = await apiJson("/api/collections");
    catalog.collections = catalog.collections || [];
}


function buildFilterControls() {
    const collections = catalog.collections || [];
    $("filterCollection").innerHTML =
        '<option value="">All Collections</option>' +
        '<option value="__UNMAPPED_COLLECTION__">Unmapped — No Collection</option>' +
        collections.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join("");

    updateFilterSetSelect();
    updateFilterTopicSelect();
}

function updateFilterSetSelect() {
    const cid = $("filterCollection").value;
    const collection = catalog.collections.find(c => c.id === cid);
    const sets = collection?.sets || [];

    $("filterSet").innerHTML =
        '<option value="">All Sets</option>' +
        sets.map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join("");
}

function updateFilterTopicSelect() {
    const tid = $("filterTopic").value;
    const currentSubtopic = $("filterSubtopic").value;

    $("filterTopic").innerHTML =
        '<option value="">All Topics</option>' +
        '<option value="__UNMAPPED_TOPIC__">Unmapped — No Topic</option>' +
        (topicCatalog.topics || []).map(t =>
            `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`
        ).join("");

    $("filterTopic").value = tid;

    let subOptions =
        '<option value="">All Subtopics</option>' +
        '<option value="__UNMAPPED_SUBTOPIC__">Unmapped — No Subtopic</option>';

    if (tid && tid !== "__UNMAPPED_TOPIC__") {
        const topic = topicCatalog.topics.find(t => t.id === tid);
        subOptions += (topic?.subtopics || [])
            .map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`)
            .join("");
    }

    $("filterSubtopic").innerHTML = subOptions;

    const valid =
        currentSubtopic &&
        [...$("filterSubtopic").options].some(o => o.value === currentSubtopic);

    $("filterSubtopic").value = valid ? currentSubtopic : "";
}

function clearPublicFilters(render = true) {
    $("filterType").value = "";
    $("filterTag").value = "";
    $("filterCollection").value = "";
    $("filterGrade").value = "";
    $("filterDifficulty").value = "";
    $("filterMarks").value = "";
    $("filterTopic").value = "";
    $("filterSubtopic").value = "";
    updateFilterSetSelect();
    updateFilterTopicSelect();
    if (render) renderQuestionList();
}

function wireNavigation() {
    $("homeBtn").onclick = () => go("#home");
    $("collectionsBtn").onclick = () => go("#collections");
    $("topicsBtn").onclick = () => go("#topics");

    $("homeCollectionsCard").onclick = () => go("#collections");
    $("homeTopicsCard").onclick = () => go("#topics");

    $("catalogBack").onclick = () => {
        const raw = currentRoute || "home";
        const parts = raw.split("/").filter(Boolean);
        if (parts[0] === "collections" && parts.length > 1) go("#collections");
        else if (parts[0] === "topics" && parts.length > 1) go("#topics");
        else go("#home");
    };
    $("prevBtn").onclick = () => navigateGlobal(-1); $("nextBtn").onclick = () => navigateGlobal(1);

    $("catalogSearch").oninput = () => {
        catalogSearch = $("catalogSearch").value;
        rerenderCurrentCatalog();
    };

    $("catalogSort").onclick = () => {
        catalogSortMode = catalogSortMode === "name"
            ? "countDesc"
            : catalogSortMode === "countDesc"
                ? "countAsc"
                : "countDesc";
        updateCatalogSortButton();
        rerenderCurrentCatalog();
    };

    $("groupPrevBtn").onclick = () => navigateGroup(-1);
    $("groupNextBtn").onclick = () => navigateGroup(1);

    $("search").oninput = () => renderQuestionList();

    $("filterBtn").onclick = () => $("filterModal").classList.add("open");
    $("filterClose").onclick = () => $("filterModal").classList.remove("open");
    $("applyFiltersBtn").onclick = () => {
        $("filterModal").classList.remove("open");
        renderQuestionList();
    };

    $("clearFilters").onclick = () => {
        clearPublicFilters();
        $("filterModal").classList.remove("open");
    };

    $("filterCollection").onchange = () => {
        updateFilterSetSelect();
        renderQuestionList();
    };

    $("filterSet").onchange = () => renderQuestionList();

    $("filterTopic").onchange = () => {
        updateFilterTopicSelect();
        renderQuestionList();
    };

    $("filterSubtopic").onchange = () => renderQuestionList();

    $("filterType").onchange = () => renderQuestionList();
    $("filterTag").oninput = () => renderQuestionList();
    $("filterGrade").onchange = () => renderQuestionList();
    $("filterDifficulty").onchange = () => renderQuestionList();
    $("filterMarks").onchange = () => renderQuestionList();

    $("questionList").onscroll = e => {
        if (e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 150) {
            const filtered = filteredQuestions();
            if (visibleCount < filtered.length) {
                visibleCount += 50;
                renderQuestionList(true);
            }
        }
    };

    ["filterModal"].forEach(id => {
        $(id).onclick = e => {
            if (e.target === $(id)) $(id).classList.remove("open");
        };
    });


    document.addEventListener("keydown", e => {
        if ($("filterModal").classList.contains("open") && e.key === "Escape") {
            $("filterModal").classList.remove("open");
            return;
        }

        if (!document.getElementById("questionView").hidden &&
            !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
            if (e.key === "ArrowLeft") navigateGlobal(-1);
            if (e.key === "ArrowRight") navigateGlobal(1);
        }
    });
}

function go(hash) {
    const next = String(hash || "home").replace(/^#/, "");
    currentRoute = next || "home";
    routeFromState();
}

function routeFromState() {
    const raw = currentRoute || "home";
    const parts = raw.split("/").filter(Boolean);

    if (parts[0] === "collections") {
        if (parts.length === 1) {
            showCollectionCatalog(null);
        } else if (parts.length === 2) {
            showCollectionCatalog(parts[1]);
        } else {
            openQuestionView({
                kind: "collection",
                collectionId: parts[1],
                setId: parts[2]
            });
        }
        return;
    }

    if (parts[0] === "topics") {
        if (parts.length === 1) {
            showTopicCatalog(null);
        } else if (parts.length === 2) {
            showTopicCatalog(parts[1]);
        } else {
            openQuestionView({
                kind: "topic",
                topicId: parts[1],
                subtopicId: parts[2]
            });
        }
        return;
    }

    showHome();
}

function setActiveView(view) {
    $("homeView").hidden = view !== "home";
    $("catalogView").hidden = view !== "catalog";
    $("questionView").hidden = view !== "questions";
}

function setTopCenter(text = "") {
    $("topCenter").innerHTML = text ? `<div class="qid">${esc(text)}</div>` : "";
}

function showHome() {
    setActiveView("home");
    $("catalogView").classList.remove("collections-root");
    setTopCenter("");
}

function showError(message) {
    setActiveView("catalog");
    $("catalogEyebrow").textContent = "ERROR";
    $("catalogTitle").textContent = "Question Bank";
    $("catalogSubtitle").textContent = message;
    $("catalogGrid").innerHTML = "";
    setTopCenter("");
}

function questionCountForCollection(collectionId, setId = null) {
    return allQ.filter(q => {
        const mappings = q.collections || [];
        return mappings.some(m =>
            m.collection_id === collectionId &&
            (!setId || m.set_id === setId)
        );
    }).length;
}

function questionCountForTopic(topicId, subtopicId = null) {
    return allQ.filter(q => {
        const mappings = q.topics || [];
        return mappings.some(m =>
            m.topic_id === topicId &&
            (!subtopicId || m.subtopic_id === subtopicId)
        );
    }).length;
}

function sortCatalogItems(items, countFn) {
    const query = catalogSearch.trim().toLowerCase();

    const result = (items || []).filter(item => {
        if (!query) return true;
        return String(item.name || "").toLowerCase().includes(query);
    });

    result.sort((a, b) => {
        if (catalogSortMode === "countAsc" || catalogSortMode === "countDesc") {
            const diff = countFn(a) - countFn(b);
            if (diff !== 0) {
                return catalogSortMode === "countAsc" ? diff : -diff;
            }
        }

        return String(a.name || "").localeCompare(
            String(b.name || ""),
            undefined,
            { sensitivity: "base" }
        );
    });

    return result;
}

function updateCatalogSortButton() {
    const button = $("catalogSort");
    if (!button) return;

    const labels = {
        name: "Sort by question count: descending",
        countAsc: "Sort by question count: descending",
        countDesc: "Sort by question count: ascending"
    };

    button.title = labels[catalogSortMode];
    button.setAttribute("aria-label", labels[catalogSortMode]);
    button.classList.toggle("active", catalogSortMode !== "name");
    button.classList.toggle("descending", catalogSortMode === "countDesc");
}

function resetCatalogControls(placeholder) {
    catalogSearch = "";
    catalogSortMode = "name";
    $("catalogSearch").value = "";
    $("catalogSearch").placeholder = placeholder;
    updateCatalogSortButton();
}

function rerenderCurrentCatalog() {
    const raw = currentRoute || "home";
    const parts = raw.split("/").filter(Boolean);

    if (parts[0] === "collections") {
        showCollectionCatalog(parts.length > 1 ? parts[1] : null, false);
    } else if (parts[0] === "topics") {
        showTopicCatalog(parts.length > 1 ? parts[1] : null, false);
    }
}

function showCollectionCatalog(collectionId, resetTools = true) {
    if (resetTools) {
        resetCatalogControls(collectionId ? "Search sets…" : "Search collections…");
    } else {
        $("catalogSearch").placeholder = collectionId ? "Search sets…" : "Search collections…";
        updateCatalogSortButton();
    }

    if (!collectionId) {
        $("catalogView").classList.add("collections-root");
        setActiveView("catalog");
        setTopCenter("");
        $("catalogEyebrow").textContent = "BROWSE";
        $("catalogTitle").textContent = "Collections";
        $("catalogSubtitle").textContent = "Choose a collection to see its sets.";
        $("catalogBack").style.visibility = "hidden";
        const collections = sortCatalogItems(
            catalog.collections,
            c => questionCountForCollection(c.id)
        );

        $("catalogGrid").innerHTML = collections.map(c => {
            const count = questionCountForCollection(c.id);
            return `
                <button class="catalog-item pattern-square" onclick="go('#collections/${escAttr(c.id)}')">
                    <div class="catalog-item-main">
                        <div class="catalog-item-title">${esc(c.name)}</div>
                        <div class="catalog-item-meta">${count} question${count === 1 ? "" : "s"}</div>
                    </div>
                    <div class="catalog-item-arrow">→</div>
                </button>
            `;
        }).join("");

        if (!collections.length) {
            $("catalogGrid").innerHTML = `<div class="catalog-empty">${catalogSearch ? "No matching collections." : "No collections available."}</div>`;
        }

        return;
    }

    $("catalogView").classList.remove("collections-root");
    const collection = catalog.collections.find(c => c.id === collectionId);
    if (!collection) {
        showError("Collection not found.");
        return;
    }

    setActiveView("catalog");
    setTopCenter(collection.name);
    $("catalogEyebrow").textContent = "COLLECTION";
    $("catalogTitle").textContent = collection.name;
    $("catalogSubtitle").textContent = "Choose a set to start practising.";
    $("catalogBack").style.visibility = "visible";

    const sets = sortCatalogItems(
        collection.sets || [],
        set => questionCountForCollection(collection.id, set.id)
    );

    $("catalogGrid").innerHTML = sets.map(set => {
        const count = questionCountForCollection(collection.id, set.id);
        return `
            <button class="catalog-item pattern-rect" onclick="go('#collections/${escAttr(collection.id)}/${escAttr(set.id)}')">
                <div class="catalog-item-main">
                    <div class="catalog-item-title">${esc(set.name)}</div>
                    <div class="catalog-item-meta">${count} question${count === 1 ? "" : "s"}</div>
                </div>
                <div class="catalog-item-arrow">→</div>
            </button>
        `;
    }).join("");

    if (!sets.length) {
        $("catalogGrid").innerHTML = `<div class="catalog-empty">${catalogSearch ? "No matching sets." : "No sets available."}</div>`;
    }
}

function showTopicCatalog(topicId, resetTools = true) {
    $("catalogView").classList.remove("collections-root");
    if (resetTools) {
        resetCatalogControls(topicId ? "Search subtopics…" : "Search topics…");
    } else {
        $("catalogSearch").placeholder = topicId ? "Search subtopics…" : "Search topics…";
        updateCatalogSortButton();
    }

    if (!topicId) {
        setActiveView("catalog");
        setTopCenter("");
        $("catalogEyebrow").textContent = "BROWSE";
        $("catalogTitle").textContent = "Topics";
        $("catalogSubtitle").textContent = "Choose a topic to see its subtopics.";
        $("catalogBack").style.visibility = "hidden";
        const topics = sortCatalogItems(
            topicCatalog.topics,
            t => questionCountForTopic(t.id)
        );

        $("catalogGrid").innerHTML = topics.map(t => {
            const count = questionCountForTopic(t.id);
            return `
                <button class="catalog-item pattern-tri" onclick="go('#topics/${escAttr(t.id)}')">
                    <div class="catalog-item-main">
                        <div class="catalog-item-title">${esc(t.name)}</div>
                        <div class="catalog-item-meta">${count} question${count === 1 ? "" : "s"}</div>
                    </div>
                    <div class="catalog-item-arrow">→</div>
                </button>
            `;
        }).join("");

        if (!topics.length) {
            $("catalogGrid").innerHTML = `<div class="catalog-empty">${catalogSearch ? "No matching topics." : "No topics available."}</div>`;
        }

        return;
    }

    const topic = topicCatalog.topics.find(t => t.id === topicId);
    if (!topic) {
        showError("Topic not found.");
        return;
    }

    setActiveView("catalog");
    setTopCenter(topic.name);
    $("catalogEyebrow").textContent = "TOPIC";
    $("catalogTitle").textContent = topic.name;
    $("catalogSubtitle").textContent = "Choose a subtopic to start practising.";
    $("catalogBack").style.visibility = "visible";

    const subtopics = sortCatalogItems(
        topic.subtopics || [],
        sub => questionCountForTopic(topic.id, sub.id)
    );

    $("catalogGrid").innerHTML = subtopics.map(sub => {
        const count = questionCountForTopic(topic.id, sub.id);
        return `
            <button class="catalog-item pattern-hex" onclick="go('#topics/${escAttr(topic.id)}/${escAttr(sub.id)}')">
                <div class="catalog-item-main">
                    <div class="catalog-item-title">${esc(sub.name)}</div>
                    <div class="catalog-item-meta">${count} question${count === 1 ? "" : "s"}</div>
                </div>
                <div class="catalog-item-arrow">→</div>
            </button>
        `;
    }).join("");

    if (!subtopics.length) {
        $("catalogGrid").innerHTML = `<div class="catalog-empty">${catalogSearch ? "No matching subtopics." : "No subtopics available."}</div>`;
    }
}

function openQuestionView(context) {
    setActiveView("questions");
    $("search").value = "";
    clearPublicFilters(false);
    visibleCount = 50;

    let title = "";
    let subtitle = "";

    if (context.kind === "collection") {
        const c = catalog.collections.find(x => x.id === context.collectionId);
        const s = c?.sets?.find(x => x.id === context.setId);
        title = c?.name || "";
        subtitle = s?.name || "";
    } else {
        const t = topicCatalog.topics.find(x => x.id === context.topicId);
        const s = t?.subtopics?.find(x => x.id === context.subtopicId);
        title = t?.name || "";
        subtitle = s?.name || "";
    }

    $("questionView").dataset.kind = context.kind;
    $("questionView").dataset.id = context.kind === "collection"
        ? context.collectionId
        : context.topicId;
    $("questionView").dataset.subId = context.kind === "collection"
        ? context.setId
        : context.subtopicId;

    // $("questionContext").innerHTML = `
    //     <div class="public-context-main">${esc(title)}</div>
    //     <div class="public-context-sub">${esc(subtitle)}</div>
    // `;

    $("questionContext").innerHTML = `
        <div class="public-context-main">${esc(subtitle)}</div>
    `;

    setTopCenter(title);

    current = null;
    selectedAnswers = new Set();
    answerChecked = false;
    $("prevBtn").disabled = true;
    $("nextBtn").disabled = true;
    $("preview").innerHTML = `<div class="public-empty-question">Select a question from the list.</div>`;
    $("groupPreview").hidden = true;

    renderQuestionList();

    const filtered = filteredQuestions();
    if (filtered.length) {
        loadQuestion(filtered[0].id);
    }
}

function filteredQuestions() {
    const query = $("search").value.trim().toLowerCase();
    const tag = $("filterTag").value.trim().toLowerCase();
    const type = $("filterType").value;
    const collectionId = $("filterCollection").value;
    const setId = $("filterSet").value;
    const topicId = $("filterTopic").value;
    const subtopicId = $("filterSubtopic").value;
    const grade = $("filterGrade").value;
    const difficulty = $("filterDifficulty").value;
    const marks = $("filterMarks").value;

    const view = $("questionView");
    const kind = view.dataset.kind;
    const contextId = view.dataset.id;
    const contextSubId = view.dataset.subId;

    let filtered = allQ;

    if (kind === "collection") {
        filtered = filtered.filter(q =>
            (q.collections || []).some(m =>
                m.collection_id === contextId && m.set_id === contextSubId
            )
        );
    } else {
        filtered = filtered.filter(q =>
            (q.topics || []).some(m =>
                m.topic_id === contextId && m.subtopic_id === contextSubId
            )
        );
    }

    if (type && filtered.length) {
        filtered = filtered.filter(q => q.type === type);
    }

    if (collectionId) {
        if (collectionId === "__UNMAPPED_COLLECTION__") {
            filtered = filtered.filter(q => (q.collections || []).length === 0);
        } else {
            filtered = filtered.filter(q =>
                (q.collections || []).some(m => m.collection_id === collectionId)
            );
        }
    }

    if (setId) {
        filtered = filtered.filter(q =>
            (q.collections || []).some(m => m.set_id === setId)
        );
    }

    if (topicId === "__UNMAPPED_TOPIC__") {
        filtered = filtered.filter(q => (q.topics || []).length === 0);
    } else if (topicId) {
        filtered = filtered.filter(q =>
            (q.topics || []).some(m => m.topic_id === topicId)
        );
    }

    if (subtopicId === "__UNMAPPED_SUBTOPIC__") {
        filtered = filtered.filter(q => {
            const mappings = q.topics || [];
            if (topicId && topicId !== "__UNMAPPED_TOPIC__") {
                return mappings.some(m => m.topic_id === topicId && !m.subtopic_id);
            }
            return mappings.length === 0 || mappings.some(m => !m.subtopic_id);
        });
    } else if (subtopicId) {
        filtered = filtered.filter(q =>
            (q.topics || []).some(m =>
                m.topic_id === topicId && m.subtopic_id === subtopicId
            )
        );
    }

    if (tag) {
        filtered = filtered.filter(q =>
            (q.tags || []).some(t => String(t).toLowerCase().includes(tag))
        );
    }

    if (grade) {
        filtered = filtered.filter(q => String(q.grade || "") === grade);
    }

    if (difficulty) {
        filtered = filtered.filter(q => (q.difficulty || "") === difficulty);
    }

    if (marks) {
        filtered = filtered.filter(q => String(q.marks ?? "") === marks);
    }

    if (query) {
        filtered = filtered.filter(q => {
            const haystack = [
                q.preview,
                q.question,
                q.id,
                q.grade,
                q.type,
                ...(q.tags || []),
                JSON.stringify(q.topics || []),
                JSON.stringify(q.collections || [])
            ].join(" ").toLowerCase();

            return haystack.includes(query);
        });
    }

    $("filterBtn").classList.toggle("active-filter", !!(
        query || tag || type || collectionId || setId || topicId ||
        subtopicId || grade || difficulty || marks
    ));

    return filtered;
}
function renderQuestionList(append = false) {
    if (!append) visibleCount = 50;

    const filtered = filteredQuestions();

    $("questionList").innerHTML = filtered.slice(0, visibleCount).map(q => {
        const gradeLabel = q.grade ? `<span class="qmeta-grade">Grade ${esc(q.grade)}</span>` : "";
        const typeLabel = q.type ? `<span class="qmeta-type">${esc(q.type)}</span>` : "";
        const meta = [gradeLabel, typeLabel].filter(Boolean).join(" · ");

        return `
            <div class="qitem ${current && current.id === q.id ? "active" : ""}" data-id="${escAttr(q.id)}">
                <div class="qnum"><span>${esc(String(q.question_number || ""))}</span></div>
                <div class="qbody">
                    <div class="qtext">${esc(q.preview || "(empty)")}</div>
                    ${meta ? `<div class="qmeta">${meta}</div>` : ""}
                </div>
            </div>
        `;
    }).join("");

    document.querySelectorAll(".public-sidebar .qitem").forEach(el => {
        el.onclick = () => loadQuestion(el.dataset.id);
    });

    $("count").textContent = `${Math.min(visibleCount, filtered.length)} of ${filtered.length}`;
    updateQuestionNavButtons();
}

function scrollActiveQuestionIntoView() {
    if (!current) return;

    const filtered = filteredQuestions();
    const index = filtered.findIndex(q => q.id === current.id);

    if (index < 0) return;

    // Make sure the target question has actually been rendered.
    if (index >= visibleCount) {
        visibleCount = Math.min(filtered.length, index + 1);
        renderQuestionList(true);
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
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}`);
    if (!r.ok) {
        $("preview").innerHTML = `<div class="public-empty-question">Unable to load this question.</div>`;
        return;
    }

    current = await r.json();
    selectedAnswers = new Set();
    answerChecked = false;
    current.topics = current.topics || [];
    current.tags = current.tags || [];
    current.collections = current.collections || [];
    current.group_id = current.group_id || null;
    currentIndex = allQ.findIndex(q => q.id === current.id);

    renderQuestion();
    await renderGroupPreview();
    renderQuestionList(true);
    scrollActiveQuestionIntoView();
}

function getAnswerLetters() {
    if (Array.isArray(current?.answer)) {
        return current.answer.map(x => String(x).trim()).filter(Boolean);
    }

    if (typeof current?.answer === "string" && current.answer.trim()) {
        return current.answer.split(",").map(x => x.trim()).filter(Boolean);
    }

    return [];
}

function answersMatch(selected, correct) {
    if (selected.length !== correct.length) return false;
    const a = [...selected].sort();
    const b = [...correct].sort();
    return a.every((value, index) => value === b[index]);
}

function clearAnswerCheckState() {
    answerChecked = false;
    const preview = $("preview");
    preview.querySelectorAll(".pv-option").forEach(option => {
        option.classList.remove("correct", "incorrect", "missed-correct");
    });
    const result = preview.querySelector(".check-answer-result");
    if (result) result.remove();
    const solution = preview.querySelector(".public-solution-reveal");
    if (solution) solution.hidden = true;
}

function updateOptionSelectionStyles() {
    $("preview").querySelectorAll(".pv-option").forEach(option => {
        const letter = option.dataset.letter;
        option.classList.toggle("selected", selectedAnswers.has(letter));
    });
}

function togglePublicOption(letter) {
    if (answerChecked) clearAnswerCheckState();

    if (selectedAnswers.has(letter)) selectedAnswers.delete(letter);
    else selectedAnswers.add(letter);

    updateOptionSelectionStyles();
}

function checkAnswer() {
    const preview = $("preview");
    const result = document.createElement("div");
    result.className = "check-answer-result";

    if (current.type === "MCQ") {
        const correctAnswers = getAnswerLetters();

        if (!correctAnswers.length) {
            result.textContent = "Answer is not available.";
            result.classList.add("incorrect");
        } else if (!selectedAnswers.size) {
            result.textContent = "Select an answer first.";
            result.classList.add("incorrect");
        } else {
            const correct = answersMatch([...selectedAnswers], correctAnswers);
            result.textContent = correct ? "Correct" : "Incorrect";
            result.classList.add(correct ? "correct" : "incorrect");

            preview.querySelectorAll(".pv-option").forEach(option => {
                const letter = option.dataset.letter;
                if (correctAnswers.includes(letter)) {
                    option.classList.add(selectedAnswers.has(letter) ? "correct" : "missed-correct");
                } else if (selectedAnswers.has(letter)) {
                    option.classList.add("incorrect");
                }
            });

            answerChecked = true;
        }
    } else {
        // Subjective questions have no selectable answer, so Check Answer
        // simply reveals the solution below.
        result.textContent = "";
    }

    const oldResult = preview.querySelector(".check-answer-result");
    if (oldResult) oldResult.remove();

    const button = preview.querySelector(".check-answer-btn");
    if (button) button.insertAdjacentElement("afterend", result);

    const solution = preview.querySelector(".public-solution-reveal");
    if (solution) {
        solution.hidden = false;
    }
}

function renderQuestion() {
    const preview = $("preview");
    preview.innerHTML = "";

    const questionEl = document.createElement("div");
    questionEl.className = "pv-question";
    const question = current.question || current.preview || "";

    if (question) appendPreviewText(questionEl, question);
    else questionEl.innerHTML = '<span class="empty">[Question]</span>';

    preview.appendChild(questionEl);

    if (current.type === "MCQ") {
        const optionsEl = document.createElement("div");
        optionsEl.className = "pv-options";

        for (const label of ["A", "B", "C", "D"]) {
            const optionEl = document.createElement("button");
            optionEl.type = "button";
            optionEl.className = "pv-option";
            optionEl.dataset.letter = label;
            optionEl.setAttribute("aria-pressed", "false");
            optionEl.onclick = () => {
                togglePublicOption(label);
                optionEl.setAttribute("aria-pressed", selectedAnswers.has(label) ? "true" : "false");
            };

            const letterEl = document.createElement("div");
            letterEl.className = "pv-letter";
            letterEl.textContent = label;

            const textEl = document.createElement("div");
            textEl.className = "pv-text";
            appendPreviewText(textEl, current.options?.[label] || "");

            optionEl.appendChild(letterEl);
            optionEl.appendChild(textEl);
            optionsEl.appendChild(optionEl);
        }

        preview.appendChild(optionsEl);
    }

    const checkButton = document.createElement("button");
    checkButton.type = "button";
    checkButton.className = "btn secondary check-answer-btn";
    checkButton.textContent = "Check Answer";
    checkButton.onclick = checkAnswer;
    preview.appendChild(checkButton);

    const solution = document.createElement("div");
    solution.className = "public-solution-reveal";
    solution.hidden = true;

    const solutionLabel = document.createElement("div");
    solutionLabel.className = "public-solution-label";
    solutionLabel.textContent = "Solution";
    solution.appendChild(solutionLabel);

    const solutionBody = document.createElement("div");
    solutionBody.className = "public-solution-body";
    if (current.solution) appendPreviewText(solutionBody, current.solution);
    else appendPreviewText(solutionBody, "Solution is not available.");
    solution.appendChild(solutionBody);

    preview.appendChild(solution);

    const uuidEl = document.createElement("div");
    uuidEl.className = "pv-uuid";
    uuidEl.textContent = current.id || "";
    preview.appendChild(uuidEl);

    if (window.MathJax?.typesetPromise) {
        MathJax.typesetPromise([preview]).catch(() => { });
    }
}

function appendPreviewText(parent, text) {
    if (text == null) return;

    const normalized = String(text).replace(/<br\s*\/?>/gi, "\n");
    const parts = normalized.split("\n");

    parts.forEach((part, i) => {
        if (i > 0) parent.appendChild(document.createElement("br"));
        parent.appendChild(document.createTextNode(part));
    });
}

function groupChildIds(group) {
    if (Array.isArray(group?.children)) {
        const ids = group.children
            .map(x => typeof x === "string" ? x : (x?.id || x?.uuid))
            .filter(Boolean);

        if (ids.length) return ids;
    }

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

    const ids = groupChildIds(group);
    const index = ids.indexOf(current.id);
    const count = ids.length;

    title.textContent = `Group Question (${count} ${count === 1 ? "part" : "parts"})`;
    prev.disabled = index <= 0;
    next.disabled = index < 0 || index >= count - 1;

    content.innerHTML = "";
    const text = group?.content ?? group?.question ?? "";

    if (!group) {
        appendPreviewText(content, "Group content could not be loaded.");
    } else if (text) {
        appendPreviewText(content, typeof text === "string" ? text : JSON.stringify(text));
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
    const index = ids.indexOf(current.id);
    const target = ids[index + delta];

    if (target) await loadQuestion(target);
}

function updateQuestionNavButtons() {
    const filtered = filteredQuestions();
    const index = filtered.findIndex(q => q.id === current?.id);
    $("prevBtn").disabled = index <= 0;
    $("nextBtn").disabled = index < 0 || index >= filtered.length - 1;
}

function navigateGlobal(delta) {
    const filtered = filteredQuestions();
    const index = filtered.findIndex(q => q.id === current?.id);
    if (index < 0) return;

    const target = filtered[index + delta];
    if (target) loadQuestion(target.id);
}
