const $ = id => document.getElementById(id);

let operation = null;

const CONFIG = {
  ingest: {
    title: "Ingest New Questions from JSON",
    description: "Choose the JSON export produced by the question scraper. The additive migration will skip UUIDs that already exist.",
    endpoint: "/api/bulk/ingest-json",
    button: "Ingest Questions",
  },
  delete: {
    title: "Delete Questions from JSON",
    description: "Choose the JSON export containing the questions you want to remove from SQLite.",
    endpoint: "/api/bulk/delete-json",
    button: "Delete Questions",
  }
};

function toast(message, type = "") {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast ${type} on`;
  setTimeout(() => el.classList.remove("on"), 2400);
}

function openOperation(kind) {
  operation = kind;
  const cfg = CONFIG[kind];

  $("modalTitle").textContent = cfg.title;
  $("modalDescription").textContent = cfg.description;
  $("executeBtn").textContent = cfg.button;
  $("jsonFile").value = "";
  $("fileName").textContent = "No file selected.";
  $("executeBtn").disabled = true;
  $("resultBox").classList.remove("open");
  $("resultText").textContent = "";
  $("deleteWarning").style.display = kind === "delete" ? "block" : "none";

  $("operationModal").classList.add("open");
}

function closeOperation() {
  $("operationModal").classList.remove("open");
  operation = null;
}

async function executeOperation() {
  if (!operation) return;

  const file = $("jsonFile").files[0];
  if (!file) {
    toast("Choose a JSON file first.", "err");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".json")) {
    toast("Please choose a .json file.", "err");
    return;
  }

  if (operation === "delete") {
    const confirmed = window.confirm(
      `Delete the questions listed in "${file.name}" from the SQLite database? This cannot be undone except by restoring a backup.`
    );
    if (!confirmed) return;
  }

  const form = new FormData();
  form.append("file", file, file.name);

  const button = $("executeBtn");
  button.disabled = true;
  button.textContent = operation === "delete" ? "Deleting…" : "Ingesting…";

  try {
    const response = await fetch(CONFIG[operation].endpoint, {
      method: "POST",
      body: form
    });

    const data = await response.json().catch(() => ({
      success: false,
      error: `Server returned ${response.status}.`
    }));

    const output = data.output || data.error || "Operation completed.";
    $("resultText").textContent = output;
    $("resultBox").classList.add("open");

    if (!response.ok || !data.success) {
      toast(data.error || "Operation failed.", "err");
      return;
    }

    toast(
      operation === "delete"
        ? "Questions deleted successfully."
        : "Questions ingested successfully.",
      "ok"
    );
  } catch (error) {
    $("resultText").textContent = error.message;
    $("resultBox").classList.add("open");
    toast("Operation failed.", "err");
  } finally {
    button.textContent = CONFIG[operation]?.button || "Execute";
    button.disabled = !$("jsonFile").files[0];
  }
}

$("operationModal").addEventListener("click", event => {
  if (event.target === $("operationModal")) closeOperation();
});

$("modalClose").onclick = closeOperation;
$("modalCancel").onclick = closeOperation;
$("executeBtn").onclick = executeOperation;

$("jsonFile").onchange = () => {
  const file = $("jsonFile").files[0];
  $("fileName").textContent = file ? file.name : "No file selected.";
  $("executeBtn").disabled = !file;
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("operationModal").classList.contains("open")) {
    closeOperation();
  }
});

document.querySelectorAll("[data-operation]").forEach(card => {
  card.addEventListener("click", () => openOperation(card.dataset.operation));
});
