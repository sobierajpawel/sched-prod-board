import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const error = document.querySelector('.error');
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelAck = document.querySelector('[data-testid="panel-ack"]');

const incidents = new Map(); // incident id -> incident, as last answered
const acked = new Map(); // incident id -> ackedAt
let selectedId = null; // the incident the panel names; Ack only ever acks this id
let acking = false;

// R5: viewer's own zone and locale order (en-GB, de-DE, … put the day first).
const timeFormat = new Intl.DateTimeFormat(navigator.languages?.[0] ?? navigator.language, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const localTime = (iso) => timeFormat.format(new Date(iso));

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function rowHtml(i) {
  return `<span class="id">${escape(i.id)}</span>
    <span class="sev">${escape(i.severity)}</span>
    <span class="what">${escape(i.service)} · ${escape(i.region)} · ${escape(i.summary)}</span>
    <time datetime="${escape(i.openedAt)}">${escape(localTime(i.openedAt))}</time>
    <span class="state">${acked.has(i.id) ? '<span data-testid="acked" class="acked">✓ acked</span>' : ''}</span>`;
}

function paintRow(li, i) {
  li.className = `row ${i.severity}${acked.has(i.id) ? ' is-acked' : ''}${i.id === selectedId ? ' is-selected' : ''}`;
  li.setAttribute('aria-selected', String(i.id === selectedId));
  const html = rowHtml(i);
  if (li.dataset.html !== html) {
    li.innerHTML = html;
    li.dataset.html = html;
  }
}

// R1: new incidents go in at the top, newest first. Rows already on the board are never moved or removed,
// so the list only grows from the top.
function render(page) {
  const fresh = [];
  for (const i of page.incidents) {
    if (!incidents.has(i.id)) fresh.push(i);
    incidents.set(i.id, i);
  }
  fresh.sort((a, b) => a.openedAt.localeCompare(b.openedAt)); // oldest first, each prepended → newest on top
  for (const i of fresh) {
    const li = document.createElement('li');
    li.dataset.testid = 'incident-row';
    li.dataset.id = i.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    list.prepend(li);
  }
  for (const li of list.children) paintRow(li, incidents.get(li.dataset.id));
  empty.hidden = incidents.size > 0;
  renderPanel();
}

// R2 (product, after step 1): a row opens its incident panel; Ack lives in the panel and acks the incident
// the panel names, wherever that row has moved since.
function renderPanel() {
  const i = selectedId && incidents.get(selectedId);
  panel.hidden = !i;
  if (!i) return;
  panel.querySelector('.p-id').textContent = i.id;
  panel.querySelector('.p-sev').textContent = i.severity;
  panel.querySelector('.p-sev').className = `p-sev ${i.severity}`;
  panel.querySelector('.p-what').textContent = `${i.service} · ${i.region}`;
  panel.querySelector('.p-summary').textContent = i.summary;
  const t = panel.querySelector('.p-time');
  t.dateTime = i.openedAt;
  t.textContent = localTime(i.openedAt);
  const done = acked.has(i.id);
  panel.querySelector('.p-acked').hidden = !done;
  panelAck.hidden = done;
  panelAck.disabled = acking;
  panelAck.textContent = acking ? 'Acking…' : `Ack ${i.id}`;
}

function select(id) {
  if (acking) return;
  selectedId = id;
  for (const li of list.children) paintRow(li, incidents.get(li.dataset.id));
  renderPanel();
}

list.addEventListener('click', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li) select(li.dataset.id);
});
list.addEventListener('keydown', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    select(li.dataset.id);
  }
});
panel.querySelector('.p-close').addEventListener('click', () => select(null));

panelAck.addEventListener('click', async () => {
  const id = selectedId;
  if (!id || acking || acked.has(id)) return;
  acking = true;
  renderPanel();
  try {
    const reply = await ack(id);
    acked.set(reply.id, reply.ackedAt);
  } catch (err) {
    showError(err);
  } finally {
    acking = false;
    for (const li of list.children) paintRow(li, incidents.get(li.dataset.id));
    renderPanel();
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
    render(await fetchIncidents());
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
