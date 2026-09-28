let catalog = { collections: [] };

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };
const escAttr = s => String(s ?? "").replace(/"/g, "&quot;");

document.addEventListener("DOMContentLoaded", async () => {
  await loadCatalog();
  renderManager();
  
  $("createCollectionBtn").onclick = createCollection;
  
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      window.location.href = '/';
    }
  });
});

async function loadCatalog() {
  const r = await fetch("/api/collections");
  catalog = await r.json();
  catalog.collections = catalog.collections || [];
}

function renderManager() {
  $("collectionManager").innerHTML = catalog.collections.map(c => `
    <div class="collection-card">
      <div class="collection-head" onclick="toggleCollection('${escAttr(c.id)}')">
        <button class="icon-btn chevron" id="chevron-${escAttr(c.id)}">›</button>
        <div class="collection-title-wrap">
          <span class="collection-name-text" data-id="${escAttr(c.id)}">${esc(c.name)}</span>
          <input class="collection-name" data-id="${escAttr(c.id)}" value="${escAttr(c.name)}" onclick="event.stopPropagation()" style="display:none">
          <div class="id-hover-icon" data-id="${escAttr(c.id)}"></div>
        </div>
        <button class="btn secondary edit-collection" data-id="${escAttr(c.id)}" onclick="event.stopPropagation(); startEditCollection('${escAttr(c.id)}')">Edit</button>
        <button class="btn secondary save-collection" data-id="${escAttr(c.id)}" onclick="event.stopPropagation()" style="display:none">Save</button>
      </div>
      <div class="set-list" id="sets-${escAttr(c.id)}">
        ${(c.sets || []).map(s => `
          <div class="set-row">
            <div class="set-title-wrap">
              <span class="set-name-text" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}">${esc(s.name)}</span>
              <input class="set-name" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}" value="${escAttr(s.name)}" style="display:none">
              <div class="id-hover-icon" data-id="${escAttr(s.id)}"></div>
            </div>
            <button class="btn secondary edit-set" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}" onclick="startEditSet('${escAttr(c.id)}', '${escAttr(s.id)}')">Edit</button>
            <button class="btn secondary save-set" data-cid="${escAttr(c.id)}" data-id="${escAttr(s.id)}" style="display:none">Save</button>
          </div>
        `).join("")}
        <div class="add-set-row">
          <input class="new-set-name" data-cid="${escAttr(c.id)}" placeholder="New set in this collection…">
          <button class="btn secondary add-set" data-cid="${escAttr(c.id)}">+ Add Set</button>
        </div>
      </div>
    </div>
  `).join("") || '<div style="color:var(--muted);font-size:15px;text-align:center;padding:40px;">No collections yet. Create your first one above.</div>';

  // Restore open state
  Object.keys(openCollections).forEach(id => {
    if (openCollections[id]) {
      const list = $(`sets-${id}`);
      const icon = $(`chevron-${id}`);
      if (list) list.classList.add("open");
      if (icon) icon.classList.add("open");
    }
  });

  document.querySelectorAll(".save-collection").forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const cid = b.dataset.id;
    const name = document.querySelector(`.collection-name[data-id="${CSS.escape(cid)}"]`).value.trim();
    await mutateCatalog(`/api/collections/${encodeURIComponent(cid)}`, "PUT", { name });
  });

  document.querySelectorAll(".save-set").forEach(b => b.onclick = async () => {
    const cid = b.dataset.cid;
    const sid = b.dataset.id;
    const name = document.querySelector(`.set-name[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).value.trim();
    await mutateCatalog(`/api/collections/${encodeURIComponent(cid)}/sets/${encodeURIComponent(sid)}`, "PUT", { name });
  });

  document.querySelectorAll(".add-set").forEach(b => b.onclick = async () => {
    const cid = b.dataset.cid;
    const input = document.querySelector(`.new-set-name[data-cid="${CSS.escape(cid)}"]`);
    await mutateCatalog(`/api/collections/${encodeURIComponent(cid)}/sets`, "POST", { name: input.value.trim() });
    openCollections[cid] = true; // Ensure it stays open after adding a set
  });
}

window.startEditCollection = function(id) {
  document.querySelector(`.collection-name-text[data-id="${CSS.escape(id)}"]`).style.display = "none";
  const input = document.querySelector(`.collection-name[data-id="${CSS.escape(id)}"]`);
  input.style.display = "block";
  input.focus();
  document.querySelector(`.edit-collection[data-id="${CSS.escape(id)}"]`).style.display = "none";
  document.querySelector(`.save-collection[data-id="${CSS.escape(id)}"]`).style.display = "block";
};

window.startEditSet = function(cid, sid) {
  document.querySelector(`.set-name-text[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).style.display = "none";
  const input = document.querySelector(`.set-name[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`);
  input.style.display = "block";
  input.focus();
  document.querySelector(`.edit-set[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).style.display = "none";
  document.querySelector(`.save-set[data-cid="${CSS.escape(cid)}"][data-id="${CSS.escape(sid)}"]`).style.display = "block";
};

const openCollections = {};
window.toggleCollection = function(id) {
  const list = $(`sets-${id}`);
  const icon = $(`chevron-${id}`);
  if (!list) return;
  const isOpen = list.classList.toggle("open");
  icon.classList.toggle("open", isOpen);
  openCollections[id] = isOpen;
};

async function createCollection() {
  const name = $("newCollectionName").value.trim();
  if (!name) return toast("Enter a collection name", "err");
  await mutateCatalog("/api/collections", "POST", { name });
  $("newCollectionName").value = "";
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
