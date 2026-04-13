const DB_NAME = 'weeklyReportKakaoApp';
const STORE_NAME = 'kv';
const APP_VERSION = '1.0.0';
const APP_KEY = 'app-state';

const state = {
  currentUser: null,
  users: [],
  records: [],
  summaryHtml: '',
};

const el = (id) => document.getElementById(id);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function dtNow() {
  return new Date().toISOString();
}
function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${formatDate(dateStr)} ${`${d.getHours()}`.padStart(2,'0')}:${`${d.getMinutes()}`.padStart(2,'0')}`;
}
function sortRecords(records) {
  return [...records].sort((a, b) => {
    const da = a.meetingDate || '';
    const db = b.meetingDate || '';
    if (db !== da) return db.localeCompare(da);
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}
function weekRangeFrom(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const day = date.getDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [start.toISOString().slice(0,10), end.toISOString().slice(0,10)];
}
function statusClass(value='') {
  if (value === '완료') return 'done';
  if (value === '긴급') return 'danger';
  if (value === '보류') return 'warn';
  return '';
}
function matchesKeyword(record, keyword) {
  if (!keyword) return true;
  const text = [
    record.meetingTitle, record.category, record.target,
    record.agenda, record.result, record.owner, record.note,
    record.reporterName, record.meetingType, record.status
  ].join(' ').toLowerCase();
  return text.includes(keyword.toLowerCase());
}
function canEdit(record) {
  if (!state.currentUser) return false;
  return state.currentUser.role === 'admin' || record.reporterId === state.currentUser.id;
}
function authUserLabel(user) {
  return `${user.name} (${user.role === 'admin' ? '관리자' : '일반'})`;
}

const db = {
  conn: null,
  async open() {
    if (this.conn) return this.conn;
    this.conn = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.conn;
  },
  async get(key) {
    const database = await this.open();
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const database = await this.open();
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
};

async function saveState() {
  await db.set(APP_KEY, { version: APP_VERSION, users: state.users, records: state.records });
}
async function loadState() {
  const saved = await db.get(APP_KEY);
  if (saved && saved.users && saved.records) {
    state.users = saved.users;
    state.records = saved.records;
    return;
  }
  await resetToSeed(false);
}
async function resetToSeed(showAlert = true) {
  state.users = JSON.parse(JSON.stringify(window.SEED_DATA.users || []));
  state.records = JSON.parse(JSON.stringify(window.SEED_DATA.records || []));
  await saveState();
  if (showAlert) alert('초기 데이터로 재설정했습니다.');
  renderAll();
}
function logout() {
  state.currentUser = null;
  el('appView').classList.add('hidden');
  el('loginView').classList.remove('hidden');
  el('loginForm').reset();
}
function setActiveTab(tabId) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  document.querySelectorAll('.content > .panel').forEach(panel => panel.classList.add('hidden'));
  el(tabId).classList.remove('hidden');
}

function renderDashboard() {
  const total = state.records.length;
  const today = todayStr();
  const todayCount = state.records.filter(r => r.meetingDate === today).length;
  const urgentCount = state.records.filter(r => r.meetingType === '수시긴급' || r.status === '긴급').length;
  const userCount = state.users.length;
  const recent7 = state.records.filter(r => r.meetingDate && r.meetingDate >= weekRangeFrom(today)[0]).length;

  const cards = [
    { label: '전체 등록 건수', value: total, sub: '초기자료 포함 전체 누적' },
    { label: '오늘 등록 건수', value: todayCount, sub: `${formatDate(today)} 기준` },
    { label: '최근 1주 건수', value: recent7, sub: '이번 주 포함' },
    { label: '사용자 수', value: userCount, sub: '관리자 + 일반 사용자' },
    { label: '긴급 표시 건수', value: urgentCount, sub: '수시긴급 또는 상태=긴급' },
    { label: '내 등록 건수', value: state.records.filter(r => r.reporterId === state.currentUser?.id).length, sub: '현재 로그인 계정 기준' },
  ];

  el('dashboardCards').innerHTML = cards.map(card => `
    <div class="stat-card">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value">${card.value.toLocaleString()}</div>
      <div class="sub">${escapeHtml(card.sub)}</div>
    </div>
  `).join('');

  const recent = sortRecords(state.records).slice(0, 10);
  el('recentRecords').innerHTML = recent.map(renderRecordCard).join('') || '<div class="muted">등록된 데이터가 없습니다.</div>';
  bindRecordCardButtons();
}

function renderRecordCard(record) {
  const attachmentsHtml = (record.attachments || []).length
    ? `<div class="attachments">${record.attachments.map(att => `
        <span class="attachment-chip">
          <a href="${att.dataUrl}" download="${escapeHtml(att.name)}">${escapeHtml(att.name)}</a>
        </span>
      `).join('')}</div>`
    : '<span class="muted">첨부 없음</span>';

  const badge = record.status ? `<span class="status-badge ${statusClass(record.status)}">${escapeHtml(record.status)}</span>` : '';
  const sourceLabel = record.source?.sheet ? ` / 원본시트: ${escapeHtml(record.source.sheet)}-${record.source.row}` : '';

  return `
    <div class="record-card">
      <div class="record-head">
        <div>
          <div class="record-title">${escapeHtml(record.meetingTitle || '업무 보고')}</div>
          <div class="muted">${formatDate(record.meetingDate)} · ${escapeHtml(record.meetingType || '-')} · 등록자: ${escapeHtml(record.reporterName || '-')} ${sourceLabel}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${badge}
          ${canEdit(record) ? `<button class="btn light small action-edit" data-id="${record.id}">수정</button>` : ''}
          ${canEdit(record) ? `<button class="btn danger small action-delete" data-id="${record.id}">삭제</button>` : ''}
        </div>
      </div>
      <div class="record-grid">
        <div class="kv"><strong>구분</strong>${escapeHtml(record.category || '-')}</div>
        <div class="kv"><strong>대상 / 업체</strong>${escapeHtml(record.target || '-')}</div>
        <div class="kv"><strong>안건</strong>${escapeHtml(record.agenda || '-').replaceAll('\n', '<br>')}</div>
        <div class="kv"><strong>협의 결과</strong>${escapeHtml(record.result || '-').replaceAll('\n', '<br>')}</div>
        <div class="kv"><strong>담당자</strong>${escapeHtml(record.owner || '-')}</div>
        <div class="kv"><strong>비고</strong>${escapeHtml(record.note || '-')}</div>
        <div class="kv" style="grid-column:1 / -1;"><strong>첨부</strong>${attachmentsHtml}</div>
      </div>
    </div>
  `;
}

function bindRecordCardButtons() {
  document.querySelectorAll('.action-edit').forEach(btn => {
    btn.onclick = () => editRecord(btn.dataset.id);
  });
  document.querySelectorAll('.action-delete').forEach(btn => {
    btn.onclick = async () => {
      const record = state.records.find(r => r.id === btn.dataset.id);
      if (!record || !canEdit(record)) return alert('수정 권한이 없습니다.');
      if (!confirm('이 자료를 삭제하시겠습니까?')) return;
      state.records = state.records.filter(r => r.id !== record.id);
      await saveState();
      renderAll();
      setActiveTab('listPanel');
    };
  });
}

function renderReporterFilter() {
  const reporters = Array.from(new Set(state.records.map(r => `${r.reporterId}||${r.reporterName}`))).sort();
  const select = el('filterReporter');
  select.innerHTML = `<option value="">전체</option>` + reporters.map(item => {
    const [id, name] = item.split('||');
    return `<option value="${escapeHtml(id)}">${escapeHtml(name || id)}</option>`;
  }).join('');
}

function applyFilters() {
  const from = el('filterFrom').value;
  const to = el('filterTo').value;
  const type = el('filterType').value;
  const reporter = el('filterReporter').value;
  const keyword = el('filterKeyword').value.trim();

  let filtered = sortRecords(state.records).filter(record => {
    if (from && (record.meetingDate || '') < from) return false;
    if (to && (record.meetingDate || '') > to) return false;
    if (type && record.meetingType !== type) return false;
    if (reporter && record.reporterId !== reporter) return false;
    if (!matchesKeyword(record, keyword)) return false;
    return true;
  });

  const list = el('recordList');
  list.innerHTML = filtered.length
    ? filtered.map(renderRecordCard).join('')
    : '<div class="record-card"><div class="muted">조건에 맞는 자료가 없습니다.</div></div>';
  bindRecordCardButtons();
}

function renderUsers() {
  const isAdmin = state.currentUser?.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(node => node.classList.toggle('hidden', !isAdmin));
  if (!isAdmin && !el('usersPanel').classList.contains('hidden')) {
    setActiveTab('dashboardPanel');
  }

  el('userTableBody').innerHTML = state.users.map(user => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.name)}</td>
      <td>${user.role === 'admin' ? '관리자' : '일반사용자'}</td>
      <td>${formatDate(user.createdAt)}</td>
    </tr>
  `).join('');
}

function resetRecordForm() {
  el('recordForm').reset();
  el('recordId').value = '';
  el('meetingType').value = '주간보고';
  el('meetingDate').value = todayStr();
  el('meetingTitle').value = `주간업무 회의록(${todayStr().slice(5).replace('-', '/')}일)`;
  el('attachmentPreview').innerHTML = '';
  refreshCharCounts();
}

function refreshCharCounts() {
  ['owner','category','target','note','agenda','result'].forEach(id => {
    const input = el(id);
    const holder = document.querySelector(`.char-count[data-for="${id}"]`);
    if (!input || !holder) return;
    const max = input.getAttribute('maxlength') || '-';
    holder.textContent = `${input.value.length} / ${max}`;
  });
}

function setAttachmentPreview(attachments) {
  el('attachmentPreview').innerHTML = (attachments || []).map(att => `
    <span class="attachment-chip">
      <a href="${att.dataUrl}" download="${escapeHtml(att.name)}">${escapeHtml(att.name)}</a>
      <button type="button" class="btn danger small remove-attachment" data-id="${att.id}">삭제</button>
    </span>
  `).join('');
  document.querySelectorAll('.remove-attachment').forEach(btn => {
    btn.onclick = () => {
      const current = JSON.parse(el('attachmentPreview').dataset.items || '[]');
      const updated = current.filter(item => item.id !== btn.dataset.id);
      el('attachmentPreview').dataset.items = JSON.stringify(updated);
      setAttachmentPreview(updated);
    };
  });
  el('attachmentPreview').dataset.items = JSON.stringify(attachments || []);
}

async function filesToData(fileList) {
  const files = Array.from(fileList || []);
  const results = [];
  for (const file of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    results.push({
      id: uid('att'),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl,
      addedAt: dtNow(),
    });
  }
  return results;
}

async function submitRecord(event) {
  event.preventDefault();
  const existingId = el('recordId').value;
  const existingRecord = state.records.find(r => r.id === existingId);
  if (existingRecord && !canEdit(existingRecord)) {
    return alert('본인 또는 관리자만 수정할 수 있습니다.');
  }

  const newAttachments = await filesToData(el('attachmentInput').files);
  const currentAttachments = JSON.parse(el('attachmentPreview').dataset.items || '[]');
  const attachments = [...currentAttachments, ...newAttachments];
  const payload = {
    id: existingId || uid('rec'),
    meetingType: el('meetingType').value,
    meetingDate: el('meetingDate').value,
    meetingTitle: el('meetingTitle').value.trim(),
    category: el('category').value.trim(),
    target: el('target').value.trim(),
    agenda: el('agenda').value.trim(),
    result: el('result').value.trim(),
    owner: el('owner').value.trim(),
    note: el('note').value.trim(),
    status: el('status').value,
    reporterId: existingRecord?.reporterId || state.currentUser.id,
    reporterName: existingRecord?.reporterName || state.currentUser.name,
    createdAt: existingRecord?.createdAt || dtNow(),
    updatedAt: dtNow(),
    attachments,
    source: existingRecord?.source || { sheet: '앱 등록', row: '' },
  };

  if (!payload.meetingDate) return alert('일자를 입력해 주세요.');
  if (!payload.agenda && !payload.result && !payload.note) {
    return alert('안건, 협의 결과, 비고 중 하나 이상은 입력해 주세요.');
  }

  if (existingId) {
    state.records = state.records.map(r => r.id === existingId ? payload : r);
  } else {
    state.records.unshift(payload);
  }
  await saveState();
  alert(existingId ? '수정 완료되었습니다.' : '등록 완료되었습니다.');
  resetRecordForm();
  renderAll();
  setActiveTab('listPanel');
}

function editRecord(recordId) {
  const record = state.records.find(r => r.id === recordId);
  if (!record) return;
  if (!canEdit(record)) return alert('본인 또는 관리자만 수정할 수 있습니다.');

  el('recordId').value = record.id;
  el('meetingType').value = record.meetingType || '주간보고';
  el('meetingDate').value = record.meetingDate || todayStr();
  el('meetingTitle').value = record.meetingTitle || '';
  el('category').value = record.category || '';
  el('target').value = record.target || '';
  el('agenda').value = record.agenda || '';
  el('result').value = record.result || '';
  el('owner').value = record.owner || '';
  el('note').value = record.note || '';
  el('status').value = record.status || '';
  el('attachmentInput').value = '';
  setAttachmentPreview(record.attachments || []);
  refreshCharCounts();
  setActiveTab('entryPanel');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function groupedSummary(records) {
  const groups = {};
  sortRecords(records).reverse().forEach(record => {
    const dateKey = record.meetingDate || '날짜 미지정';
    groups[dateKey] ||= [];
    groups[dateKey].push(record);
  });
  return groups;
}

function buildSummaryHtml(records) {
  const title = el('summaryTitle').value.trim() || '주간업무 및 긴급사항 종합보고';
  const from = el('summaryFrom').value;
  const to = el('summaryTo').value;
  const type = el('summaryType').value;
  const rangeLabel = `${from || '-'} ~ ${to || '-'} ${type ? ` / ${type}` : ''}`.trim();
  const groups = groupedSummary(records);

  if (!records.length) {
    return `<div class="summary-sheet"><h1>${escapeHtml(title)}</h1><div class="range">${escapeHtml(rangeLabel)}</div><p>선택한 기간의 데이터가 없습니다.</p></div>`;
  }

  const daysHtml = Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0])).map(([date, items]) => `
    <div class="summary-day">
      <h3>${escapeHtml(date)} (${items.length}건)</h3>
      <table class="summary-table">
        <thead>
          <tr>
            <th style="width:10%;">구분</th>
            <th style="width:10%;">대상</th>
            <th style="width:22%;">안건</th>
            <th style="width:26%;">협의 결과</th>
            <th style="width:8%;">담당자</th>
            <th style="width:10%;">비고</th>
            <th style="width:8%;">등록자</th>
            <th style="width:6%;">상태</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${escapeHtml(item.category || '-')}</td>
              <td>${escapeHtml(item.target || '-')}</td>
              <td>${escapeHtml(item.agenda || '-').replaceAll('\n', '<br>')}</td>
              <td>${escapeHtml(item.result || '-').replaceAll('\n', '<br>')}</td>
              <td>${escapeHtml(item.owner || '-')}</td>
              <td>${escapeHtml(item.note || '-')}</td>
              <td>${escapeHtml(item.reporterName || '-')}</td>
              <td>${escapeHtml(item.status || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  return `
    <div class="summary-sheet">
      <h1>${escapeHtml(title)}</h1>
      <div class="range">${escapeHtml(rangeLabel)}</div>
      ${daysHtml}
    </div>
  `;
}

function generateSummary() {
  const from = el('summaryFrom').value;
  const to = el('summaryTo').value;
  const type = el('summaryType').value;

  const records = state.records.filter(record => {
    if (from && (record.meetingDate || '') < from) return false;
    if (to && (record.meetingDate || '') > to) return false;
    if (type && record.meetingType !== type) return false;
    return true;
  });

  state.summaryHtml = buildSummaryHtml(records);
  const holder = document.createElement('div');
  holder.innerHTML = state.summaryHtml;
  const next = holder.firstElementChild;
  next.id = 'summaryOutput';
  el('summaryOutput').replaceWith(next);
}

function summaryHtmlDocument() {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>주간 종합보고</title><link rel="stylesheet" href="styles.css"></head><body>${state.summaryHtml || buildSummaryHtml([])}</body></html>`;
}

async function downloadSummaryPng() {
  const summaryEl = el('summaryOutput');
  if (!summaryEl) return;
  const rect = summaryEl.getBoundingClientRect();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const text = summaryEl.innerText.split('\n').map(line => line.trimEnd());
  ctx.fillStyle = '#111111';
  ctx.font = '14px Malgun Gothic, Apple SD Gothic Neo, sans-serif';
  let x = 24;
  let y = 32;
  const maxWidth = rect.width - 48;
  const lineHeight = 22;

  function wrapLine(str) {
    const words = str.split(' ');
    let line = '';
    const lines = [];
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  text.forEach(rawLine => {
    const lines = wrapLine(rawLine || ' ');
    lines.forEach(line => {
      ctx.fillText(line, x, y);
      y += lineHeight;
    });
    y += 4;
  });

  canvas.toBlob(blob => {
    downloadBlob(`주간종합보고_${todayStr()}.png`, blob);
  });
}

function printSummary() {
  if (!state.summaryHtml) generateSummary();
  window.print();
}

function renderAll() {
  if (state.currentUser) {
    el('userBadge').textContent = `로그인: ${authUserLabel(state.currentUser)}`;
  }
  renderDashboard();
  renderReporterFilter();
  applyFilters();
  renderUsers();
}

async function addUser() {
  if (state.currentUser?.role !== 'admin') return alert('관리자만 가능합니다.');
  const username = el('newUsername').value.trim();
  const name = el('newName').value.trim();
  const password = el('newPassword').value.trim();
  const role = el('newRole').value;
  if (!username || !name || !password) return alert('아이디, 이름, 비밀번호를 입력해 주세요.');
  if (state.users.some(user => user.username === username)) return alert('이미 존재하는 아이디입니다.');

  state.users.push({
    id: uid('user'),
    username,
    name,
    password,
    role,
    createdAt: dtNow(),
  });
  await saveState();
  el('newUsername').value = '';
  el('newName').value = '';
  el('newPassword').value = '';
  el('newRole').value = 'user';
  renderUsers();
  alert('사용자를 추가했습니다.');
}

function bindEvents() {
  el('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = el('loginUsername').value.trim();
    const password = el('loginPassword').value.trim();
    const user = state.users.find(item => item.username === username && item.password === password);
    if (!user) return alert('아이디 또는 비밀번호가 다릅니다.');
    state.currentUser = user;
    el('loginView').classList.add('hidden');
    el('appView').classList.remove('hidden');
    renderAll();
  });

  el('seedResetBtn').onclick = async () => {
    if (!confirm('초기 데이터로 다시 불러오시겠습니까? 현재 저장 자료를 덮어쓸 수 있습니다.')) return;
    await resetToSeed(true);
  };

  el('logoutBtn').onclick = logout;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.classList.contains('admin-only') && state.currentUser?.role !== 'admin') {
        return alert('관리자만 접근할 수 있습니다.');
      }
      setActiveTab(btn.dataset.tab);
    };
  });

  el('recordForm').addEventListener('submit', submitRecord);
  el('newRecordBtn').onclick = resetRecordForm;
  el('attachmentInput').addEventListener('change', async (event) => {
    const current = JSON.parse(el('attachmentPreview').dataset.items || '[]');
    const newAttachments = await filesToData(event.target.files);
    setAttachmentPreview([...current, ...newAttachments]);
    event.target.value = '';
  });

  ['owner','category','target','note','agenda','result'].forEach(id => {
    el(id).addEventListener('input', refreshCharCounts);
  });

  el('filterApplyBtn').onclick = applyFilters;
  el('filterResetBtn').onclick = () => {
    el('filterFrom').value = '';
    el('filterTo').value = '';
    el('filterType').value = '';
    el('filterReporter').value = '';
    el('filterKeyword').value = '';
    applyFilters();
  };

  el('generateSummaryBtn').onclick = generateSummary;
  el('downloadHtmlBtn').onclick = () => {
    if (!state.summaryHtml) generateSummary();
    const html = summaryHtmlDocument();
    downloadBlob(`주간종합보고_${todayStr()}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
  };
  el('downloadPngBtn').onclick = downloadSummaryPng;
  el('printPdfBtn').onclick = printSummary;

  el('addUserBtn').onclick = addUser;
  el('exportJsonBtn').onclick = () => {
    const data = {
      version: APP_VERSION,
      exportedAt: dtNow(),
      users: state.users,
      records: state.records,
    };
    downloadBlob(`weekly_report_backup_${todayStr()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  };

  el('importJsonBtn').onclick = async () => {
    const file = el('importJsonInput').files[0];
    if (!file) return alert('복원할 JSON 파일을 선택해 주세요.');
    if (!confirm('현재 데이터를 덮어쓰고 JSON 파일로 복원할까요?')) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.users) || !Array.isArray(parsed.records)) throw new Error('형식 오류');
      state.users = parsed.users;
      state.records = parsed.records;
      await saveState();
      renderAll();
      alert('복원 완료되었습니다.');
    } catch (error) {
      alert('JSON 형식이 올바르지 않습니다.');
    }
  };

  el('factoryResetBtn').onclick = async () => {
    if (!confirm('정말 초기 데이터로 재설정하시겠습니까? 현재 등록 자료는 지워집니다.')) return;
    await resetToSeed(true);
  };
}

async function init() {
  await loadState();
  bindEvents();
  resetRecordForm();

  const [start, end] = weekRangeFrom(todayStr());
  el('summaryFrom').value = start;
  el('summaryTo').value = end;
  el('filterFrom').value = start;
  el('filterTo').value = end;
}
init();
