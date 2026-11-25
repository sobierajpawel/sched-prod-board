import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const error = document.querySelector('.error');

const acked = new Map(); // incident id -> ackedAt
const pending = new Set(); // incident ids with an ack in flight

// R5: viewer's own zone and locale order (en-GB, de-DE, … put the day first).
const timeFormat = new Intl.DateTimeFormat(navigator.languages?.[0] ?? navigator.language, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function rowHtml(i) {
  return `<span class="id">${escape(i.id)}</span>
    <span class="sev">${escape(i.severity)}</span>
    <span class="what">${escape(i.service)} · ${escape(i.region)} · ${escape(i.summary)}</span>
    <time datetime="${escape(i.openedAt)}">${escape(timeFormat.format(new Date(i.openedAt)))}</time>
    <span class="act"></span>`;
}

function renderAction(li) {
  const id = li.dataset.id;
  const slot = li.querySelector('.act');
  if (acked.has(id)) {
    if (!slot.querySelector('[data-testid="acked"]')) {
      slot.innerHTML = '<span data-testid="acked" class="acked">✓ acked</span>';
    }
    li.classList.add('is-acked');
  } else if (!slot.querySelector('[data-testid="ack"]')) {
    slot.innerHTML = '<button type="button" data-testid="ack">Ack</button>';
  }
  const btn = slot.querySelector('[data-testid="ack"]');
  if (btn) btn.disabled = pending.has(id);
}

// R1: keyed update, newest first; existing rows stay in the DOM, new ones go in above them.
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  let prev = null;
  for (const i of sorted) {
    let li = existing.get(i.id);
    if (!li) {
      li = document.createElement('li');
      li.dataset.testid = 'incident-row';
      li.dataset.id = i.id;
    }
    existing.delete(i.id);
    li.className = `row ${i.severity}`;
    const html = rowHtml(i);
    if (li.dataset.html !== html) {
      li.innerHTML = html;
      li.dataset.html = html;
    }
    renderAction(li);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  for (const li of existing.values()) li.remove();
  empty.hidden = sorted.length > 0;
}

// R2: Ack the row that was clicked.
list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn) return;
  const li = btn.closest('[data-testid="incident-row"]');
  const id = li.dataset.id;
  if (pending.has(id) || acked.has(id)) return;
  pending.add(id);
  renderAction(li);
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
  } catch (err) {
    showError(err);
  } finally {
    pending.delete(id);
    const row = list.querySelector(`[data-testid="incident-row"][data-id="${CSS.escape(id)}"]`);
    if (row) renderAction(row);
  }
});

function showError(err) {
  console.error(err);
  error.textContent = `Could not reach the incident API: ${err.message}`;
  error.hidden = false;
}

// R3 + R4: loader until the first answer, then refresh every 2 s while open.
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    loader.remove();
    error.hidden = true;
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
  }
}

await tick();
setInterval(tick, REFRESH_MS);
