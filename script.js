// ---------- CONFIG ----------
const BACKEND_URL = "http://localhost:3000"; // Node backend that returns presigned URLs
const BUCKET_NAME = "cloudnote-aws-bucket";
let USER_ID = null;

// ---------- ELEMENTS ----------
const content = document.querySelector('.content');
const boldBtn = document.getElementById('boldBtn');
const italicBtn = document.getElementById('italicBtn');
const underlineBtn = document.getElementById('underlineBtn');
const fontSizeSelector = document.getElementById('fontSizeSelector');
const saveButton = document.getElementById('saveButton');
const viewNotesButton = document.getElementById('viewNotesButton');
const notesPanel = document.getElementById('notesPanel');
const notesList = document.getElementById('notesList');
const dateBox = document.getElementById('dateBox');

let savedRange = null;
let currentFontSize = null; // keep chosen font size active across cursor moves

// ---------- UTIL: date ----------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
dateBox.value = todayISO();

// ---------- Selection helpers ----------
function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}
function restoreSelection() {
  const sel = window.getSelection();
  sel.removeAllRanges();
  if (savedRange) sel.addRange(savedRange);
}

// ---------- Formatting helpers ----------
function exec(cmd, value = null) {
  restoreSelection();
  document.execCommand(cmd, false, value);
  content.focus();
  updateActiveButtons();
  setTimeout(replaceFontTags, 0);
}
boldBtn?.addEventListener('click', () => exec('bold'));
italicBtn?.addEventListener('click', () => exec('italic'));
underlineBtn?.addEventListener('click', () => exec('underline'));

// map select values to px sizes
const sizeMap = { '2':'12px','3':'16px','4':'20px' };

// Keep selection saved while interacting with the font-size select
content.addEventListener('mouseup', saveSelection);
content.addEventListener('keyup', saveSelection);
content.addEventListener('focus', saveSelection);
fontSizeSelector?.addEventListener('mousedown', saveSelection);

// Apply chosen size
fontSizeSelector?.addEventListener('change', (e) => {
  const val = e.target.value;
  if (!val) return;
  restoreSelection();
  exec('fontSize', val);
  currentFontSize = sizeMap[val] || null;
});

// preserve typed text size when currentFontSize is active
content.addEventListener('beforeinput', (e) => {
  if (!currentFontSize) return;
  if (e.inputType === 'insertText' || e.inputType === 'insertCompositionText') {
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = currentFontSize;
    span.textContent = e.data || '';
    range.deleteContents();
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    content.dispatchEvent(new Event('input', { bubbles: true }));
    saveSelection();
  } else if (e.inputType === 'insertParagraph') {
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const br = document.createElement('br');
    range.deleteContents();
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    content.dispatchEvent(new Event('input', { bubbles: true }));
    saveSelection();
  }
});

// Replace <font size="..."> tags with span style
function replaceFontTags() {
  content.querySelectorAll('font[size]').forEach(font => {
    const size = font.getAttribute('size');
    const span = document.createElement('span');
    span.style.fontSize = sizeMap[size] || '16px';
    span.innerHTML = font.innerHTML;
    font.parentNode.replaceChild(span, font);
  });
}

// Update toolbar active states
function updateActiveButtons() {
  boldBtn?.classList.toggle('active', document.queryCommandState('bold'));
  italicBtn?.classList.toggle('active', document.queryCommandState('italic'));
  underlineBtn?.classList.toggle('active', document.queryCommandState('underline'));
}

document.addEventListener('selectionchange', () => {
  updateActiveButtons();
  saveSelection();
});

// ensure content is focusable on click
content.addEventListener('click', () => {
  content.focus();
  saveSelection();
});
content.addEventListener('input', replaceFontTags);

// ---------- USER ID management (chrome.storage fallback to localStorage) ----------
function setUserIdStorage(value) {
  if (window.chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ userId: value });
  } else {
    localStorage.setItem('userId', value);
  }
}
function getUserIdStorage() {
  return new Promise((resolve) => {
    if (window.chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('userId', ({ userId }) => resolve(userId));
    } else {
      resolve(localStorage.getItem('userId'));
    }
  });
}
async function ensureUserId() {
  if (USER_ID) return USER_ID;
  const stored = await getUserIdStorage();
  if (stored) { USER_ID = stored; return USER_ID; }
  const promptVal = prompt("Enter your username/email to separate your notes:");
  if (promptVal && promptVal.trim()) {
    USER_ID = promptVal.trim();
    setUserIdStorage(USER_ID);
    return USER_ID;
  }
  return null;
}

// ---------- SAVE to AWS S3 via backend presign endpoint B ----------
saveButton.addEventListener('click', async () => {
  const text = content.innerText.trim();
  if (!text) return alert("Please enter some text to save.");

  const userId = await ensureUserId();
  if (!userId) return alert("User ID not set. Save cancelled.");

  const date = dateBox.value || todayISO();
  const now = new Date();
  const hours = String(now.getHours()).padStart(2,'0');
  const minutes = String(now.getMinutes()).padStart(2,'0');
  const seconds = String(now.getSeconds()).padStart(2,'0');
  const fileName = `NoteBook[${date}][${hours}:${minutes}:${seconds}].txt`;

  try {
    // request pre-signed URL from existing backend (option B)
    const presign = await fetch(`${BACKEND_URL}/api/s3-upload-url?fileName=${encodeURIComponent(fileName)}&userId=${encodeURIComponent(userId)}`);
    if (!presign.ok) throw new Error(`Presign request failed (${presign.status})`);
    const { uploadUrl } = await presign.json();
    if (!uploadUrl) throw new Error("No uploadUrl returned from backend");

    // upload directly to S3
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: text
    });

    if (!putRes.ok) {
      // try to capture response body to assist debugging
      let errmsg = `Upload failed: ${putRes.status}`;
      try { const txt = await putRes.text(); errmsg += ` — ${txt.slice(0,200)}` } catch(e){/*ignore*/}
      throw new Error(errmsg);
    }

    alert("✅ File saved to AWS successfully!");
    // refresh list if panel open
    if (!notesPanel.classList.contains('hidden')) populateNotesListFromS3();
  } catch (err) {
    console.error("Error saving to S3:", err);
    alert("❌ Error saving to AWS: " + (err.message || err));
  }
});

// ---------- LIST / OPEN notes from S3 (user folder) ----------
viewNotesButton.addEventListener('click', () => {
  notesPanel.classList.toggle('hidden');
  if (!notesPanel.classList.contains('hidden')) populateNotesListFromS3();
});

async function populateNotesListFromS3() {
  notesList.innerHTML = '<li style="padding:8px;color:#666">Loading…</li>';
  const userId = await ensureUserId();
  if (!userId) { notesList.innerHTML = '<li style="padding:8px;color:#c00">User not set</li>'; return; }

  try {
    const res = await fetch(`${BACKEND_URL}/api/list-files?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`List request failed (${res.status})`);
    const files = await res.json();
    if (!Array.isArray(files) || !files.length) {
      notesList.innerHTML = '<li style="padding:8px;color:#666">No saved notes</li>';
      return;
    }

    notesList.innerHTML = files.map(f => {
      // f: { name, key }
      const snippet = f.name;
      return `<li data-key="${encodeURIComponent(f.key)}"><strong>${snippet}</strong></li>`;
    }).join('');
  } catch (err) {
    console.error("Failed to list files:", err);
    notesList.innerHTML = `<li style="padding:8px;color:#c00">Error loading notes</li>`;
  }
}

// click to open a file from S3
notesList.addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const key = decodeURIComponent(li.getAttribute('data-key'));
  if (!key) return;

  try {
    const userId = await ensureUserId();
    if (!userId) return alert("No user id");

    const res = await fetch(`${BACKEND_URL}/api/get-download-url?key=${encodeURIComponent(key)}&userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`Download-url request failed (${res.status})`);
    const { downloadUrl } = await res.json();
    if (!downloadUrl) throw new Error("No downloadUrl returned");

    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) throw new Error(`Failed to fetch file contents (${fileRes.status})`);
    const text = await fileRes.text();

    // set content and date
    content.innerText = text;
    // attempt to parse filename timestamp to set date box (best-effort)
    const filename = key.split('/').pop() || '';
    const m = filename.match(/\[(\d{4}-\d{2}-\d{2})T?([^\]]+)\]/); // not strict
    if (m) dateBox.value = m[1];
    notesPanel.classList.add('hidden');
  } catch (err) {
    console.error("Error opening file:", err);
    alert("Failed to open note: " + (err.message || err));
  }
});

// Initialize: ensure USER_ID loaded (but non-blocking)
getUserIdStorage().then(stored => {
  if (stored) USER_ID = stored;
  else {
    // do not prompt immediately if chrome.storage exists already handled elsewhere,
    // but ensure user is prompted before first save/list via ensureUserId()
  }
});
