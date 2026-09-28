let catalog = { topics: [] };

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };
const escAttr = s => String(s ?? "").replace(/"/g, "&quot;");

document.addEventListener("DOMContentLoaded", async () => {
  await loadCatalog();
  renderManager();
  
  $("createTopicBtn").onclick = createTopic;
  
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      window.location.href = '/';
    }
  });
});

async function loadCatalog() {
  const r = await fetch("/api/topics");
  catalog = await r.json();
  catalog.topics = catalog.topics || [];
}

function renderManager() {
  $("topicManager").innerHTML = catalog.topics.map(c => `
    <div class="topic-card">
      <div class="topic-head" onclick="toggleTopic('${escAttr(c.id)}')">
        <button class="icon-btn chevron" id="chevron-${escAttr(c.id)}">›</button>
        <div class="topic-title-wrap">
          <span class="topic-name-text" data-id="${escAttr(c.id)}">${esc(c.name)}</span>
          <input class="topic-name" data-id="${escAttr(c.id)}" value="${escAttr(c.name)}" onclick="event.stopPropagation()" style="display:none">
          <div class="id-hover-icon" data-id="${escAttr(c.id)}"></div>
        </div>
        <button class="btn secondary edit-topic" data-id="${escAttr(c.id)}" onclick="event.stopPropagation(); startEditTopic('${escAttr(c.id)}')">Edit</button>
        <button class="btn secondary save-topic" data-id="${escAttr(c.id)}" onclick="event.stopPropagation()" style="display:none">Save</button>
      </div>
      <div class="subtopic-list" id="subtopics-${escAttr(c.id)}">
        ${(c.subtopics || []).map(s => `
          <div class="subtopic-row">
            <div class="subtopic-title-wrap">
              <span class="subtopic-name-text" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}">${esc(s.name)}</span>
              <input class="subtopic-name" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}" value="${escAttr(s.name)}" style="display:none">
              <div class="id-hover-icon" data-id="${escAttr(s.id)}"></div>
            </div>
            <button class="btn secondary edit-subtopic" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}" onclick="startEditSubtopic('${escAttr(c.id)}', '${escAttr(s.id)}')">Edit</button>
            <button class="btn secondary save-subtopic" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}" style="display:none">Save</button>
          </div>
        `).join("")}
        <div class="add-subtopic-row">
          <input class="new-subtopic-name" data-cid="${escAttr(c.id)}" placeholder="New subtopic in this topic…">
          <button class="btn secondary add-subtopic" data-cid="${escAttr(c.id)}">+ Add subtopic</button>
        </div>
      </div>
    </div>
  `).join("") || '<div style="color:var(--muted);font-size:15px;text-align:center;padding:40px;">No topics yet. Create your first one above.</div>';

  // Restore open state
  Object.keys(openTopics).forEach(id => {
    if (openTopics[id]) {
      const list = $(`subtopics-${id}`);
      const icon = $(`chevron-${id}`);
      if (list) list.classList.add("open");
      if (icon) icon.classList.add("open");
    }
  });

  document.querySelectorAll(".save-topic").forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const cid = b.dataset.id;
    const name = document.querySelector(`.topic-name[data-id="${CSS.escape(cid)}"]`).value.trim();
    await mutateCatalog(`/api/topics/${encodeURIComponent(cid)}`, "PUT", { name });
  });

  document.querySelectorAll(".save-subtopic").forEach(b => b.onclick = async () => {
    const cid = b.dataset.cid;
    const sid = b.dataset.id;
    const name = document.querySelector(`.subtopic-name[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).value.trim();
    await mutateCatalog(`/api/topics/${encodeURIComponent(cid)}/subtopics/${encodeURIComponent(sid)}`, "PUT", { name });
  });

  document.querySelectorAll(".add-subtopic").forEach(b => b.onclick = async () => {
    const cid = b.dataset.cid;
    const input = document.querySelector(`.new-subtopic-name[data-cid="${CSS.escape(cid)}"]`);
    await mutateCatalog(`/api/topics/${encodeURIComponent(cid)}/subtopics`, "POST", { name: input.value.trim() });
    openTopics[cid] = true; // Ensure it stays open after adding a subtopic
  });
}

window.startEditTopic = function(id) {
  document.querySelector(`.topic-name-text[data-id="${CSS.escape(id)}"]`).style.display = "none";
  const input = document.querySelector(`.topic-name[data-id="${CSS.escape(id)}"]`);
  input.style.display = "block";
  input.focus();
  document.querySelector(`.edit-topic[data-id="${CSS.escape(id)}"]`).style.display = "none";
  document.querySelector(`.save-topic[data-id="${CSS.escape(id)}"]`).style.display = "block";
};

window.startEditSubtopic = function(cid, sid) {
  document.querySelector(`.subtopic-name-text[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).style.display = "none";
  const input = document.querySelector(`.subtopic-name[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`);
  input.style.display = "block";
  input.focus();
  document.querySelector(`.edit-subtopic[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).style.display = "none";
  document.querySelector(`.save-subtopic[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).style.display = "block";
};

const openTopics = {};
window.toggleTopic = function(id) {
  const list = $(`subtopics-${id}`);
  const icon = $(`chevron-${id}`);
  if (!list) return;
  const isOpen = list.classList.toggle("open");
  icon.classList.toggle("open", isOpen);
  openTopics[id] = isOpen;
};

async function createTopic() {
  const name = $("newTopicName").value.trim();
  if (!name) return toast("Enter a topic name", "err");
  await mutateCatalog("/api/topics", "POST", { name });
  $("newTopicName").value = "";
}

async function mutateCatalog(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!d.success) {
    toast(d.error || "Operation failed", "err");
    return;
  }
  await loadCatalog();
  renderManager();
  toast("Updated", "ok");
}

function toast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type} on`;
  setTimeout(() => t.classList.remove("on"), 2200);
}


