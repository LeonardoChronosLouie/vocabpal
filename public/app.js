'use strict';

/* ============================================================
 * VocabPal 背单词助手 —— 前端逻辑
 * PDF 提取 → 去重单词表 → 点击查看词义并发音 / 生词本 / 听音复习 / 导出
 * ============================================================ */

/* ---------------- 全局状态 ---------------- */
const state = {
  words: [],            // [{word, count}] 当前 PDF 的去重单词表
  fileName: '',
  totalWords: 0,
  filteredCount: 0,
  warning: '',
  activeTab: 'pdf',     // 'pdf' | 'bookmarks'
  sort: 'freq-desc',
  search: '',
  minLen: 3,
  keepStopwords: false,
  stem: true,
  bookmarks: loadBookmarks(),
  meanings: new Map(),  // word -> 在线词典结果缓存
  dict: loadDictSettings(), // { provider: 'youdao' | 'dictionaryapi' | 'custom:0'..., customs: [...] }
};

/* ---------------- 词典接口设置（localStorage） ---------------- */
const DICT_SETTINGS_KEY = 'vocabpal.dict.settings.v1';

function loadDictSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(DICT_SETTINGS_KEY) || 'null');
    if (s && s.customs && Array.isArray(s.customs)) return s;
  } catch (e) { /* 忽略损坏数据 */ }
  return { provider: 'youdao', customs: [] };
}

function saveDictSettings() {
  localStorage.setItem(DICT_SETTINGS_KEY, JSON.stringify(state.dict));
}

/* ---------------- DOM 快捷引用 ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let pendingFile = null;
let busy = false;

/* ============================================================
 * 语音合成（点按发音，使用系统语音，离线可用）
 * ============================================================ */
let enVoice = null;

function refreshVoices() {
  const voices = speechSynthesis.getVoices();
  enVoice =
    voices.find((v) => /^en[-_]US/i.test(v.lang) && /(Google|Microsoft|Zira|David|Samantha|Aria|Jenny|Guy|Christopher)/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null;
}

if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
  // 修复 Chrome 长时间空闲后语音暂停的已知问题
  setInterval(() => {
    if (speechSynthesis.speaking === false && speechSynthesis.paused) speechSynthesis.resume();
  }, 4000);
}

function speak(word) {
  if (!('speechSynthesis' in window)) {
    toast('当前浏览器不支持语音合成，请使用 Edge 或 Chrome', 'warn');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US';
  u.rate = 0.85;
  if (enVoice) u.voice = enVoice;
  u.onstart = () => highlightSpeaking(word);
  u.onend = () => highlightSpeaking(null);
  speechSynthesis.speak(u);
}

/* ============================================================
 * Toast 提示
 * ============================================================ */
function toast(msg, type = 'info') {
  const box = $('#toastBox');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

/* ============================================================
 * 生词本（localStorage 持久化）
 * ============================================================ */
const BK_KEY = 'vocabpal.bookmarks.v1';

function loadBookmarks() {
  try { return JSON.parse(localStorage.getItem(BK_KEY) || '[]'); }
  catch { return []; }
}

function saveBookmarks() {
  localStorage.setItem(BK_KEY, JSON.stringify(state.bookmarks));
}

function isBookmarked(word) {
  return state.bookmarks.some((b) => b.word === word);
}

function toggleBookmark(word, count) {
  const i = state.bookmarks.findIndex((b) => b.word === word);
  if (i >= 0) {
    state.bookmarks.splice(i, 1);
    toast(`已从生词本移除：${word}`, 'info');
  } else {
    state.bookmarks.unshift({ word, count: count || 0, addedAt: Date.now() });
    toast(`已加入生词本：${word}`, 'success');
  }
  saveBookmarks();
  render();
}

/* ============================================================
 * 上传与提取
 * ============================================================ */
const dropZone = $('#dropZone');
const fileInput = $('#fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag');
  const f = [...e.dataTransfer.files].find((x) => x.name.toLowerCase().endsWith('.pdf'));
  if (f) setFile(f);
  else toast('请拖入 PDF 文件', 'warn');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

function setFile(f) {
  pendingFile = f;
  $('#fileName').textContent = f.name;
  $('#fileName').title = f.name;
  dropZone.classList.add('has-file');
  $('#extractBtn').disabled = false;
}

function setBusy(b, msg) {
  busy = b;
  const st = $('#status');
  $('#extractBtn').disabled = b || !pendingFile;
  if (b) {
    st.hidden = false;
    st.className = 'status';
    st.textContent = msg || '处理中…';
  } else {
    st.hidden = true;
  }
}

async function doExtract() {
  if (!pendingFile || busy) return;
  const fd = new FormData();
  fd.append('pdf', pendingFile);
  fd.append('minLen', String(state.minLen));
  fd.append('keepStopwords', String(state.keepStopwords));
  fd.append('stem', String(state.stem));

  setBusy(true, `正在解析 ${pendingFile.name} …`);
  try {
    const res = await fetch('/api/extract', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '提取失败');

    state.words = data.words || [];
    state.totalWords = data.totalWords || 0;
    state.filteredCount = data.filteredCount || 0;
    state.fileName = data.fileName || '';
    state.warning = data.warning || '';
    state.meanings.clear();

    render();
    toast(`提取完成：文档 ${state.totalWords} 个词，去重后 ${data.uniqueWords} 个单词`, 'success');
    if (state.warning) toast(state.warning, 'warn');
  } catch (e) {
    toast('提取失败：' + e.message, 'error');
  } finally {
    setBusy(false);
  }
}

/* ============================================================
 * 列表渲染
 * ============================================================ */
function visibleWords() {
  let list = state.activeTab === 'pdf'
    ? state.words
    : state.bookmarks.map((b) => ({ word: b.word, count: b.count || 0 }));

  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((w) => w.word.toLowerCase().includes(q));

  const s = state.sort;
  const arr = [...list];
  if (s === 'freq-desc') arr.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  else if (s === 'freq-asc') arr.sort((a, b) => a.count - b.count || a.word.localeCompare(b.word));
  else if (s === 'alpha') arr.sort((a, b) => a.word.localeCompare(b.word));
  else if (s === 'length') arr.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
  return arr;
}

function render() {
  // tabs
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.activeTab));
  $('#bkCount').textContent = state.bookmarks.length;

  // stats
  const statsEl = $('#stats');
  if (state.words.length) {
    statsEl.hidden = false;
    $('#statFile').textContent = state.fileName || 'PDF';
    $('#statTotal').textContent = state.totalWords;
    $('#statUnique').textContent = state.words.length;
    $('#statFiltered').textContent = state.filteredCount;
  } else {
    statsEl.hidden = true;
  }

  // warning
  const warnEl = $('#warning');
  warnEl.hidden = !state.warning;
  warnEl.textContent = state.warning || '';

  const list = visibleWords();
  const listEl = $('#wordList');
  const emptyEl = $('#emptyState');

  if (state.activeTab === 'bookmarks' && !state.bookmarks.length) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    $('.empty-icon', emptyEl).textContent = '⭐';
    $('p', emptyEl).textContent = '生词本还是空的。在单词上点击 ☆ 即可收藏，收藏后在这里集中复习。';
    return;
  }
  if (!list.length) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    $('.empty-icon', emptyEl).textContent = state.words.length ? '🔍' : '🫧';
    $('p', emptyEl).textContent = state.words.length
      ? `没有匹配「${state.search}」的单词。`
      : '还没有单词。上传一个 PDF，即可自动提取并去重英文单词。';
    return;
  }

  emptyEl.hidden = true;
  listEl.hidden = false;
  listEl.innerHTML = list.map((w) => {
    const starred = isBookmarked(w.word);
    return `<button class="chip" data-word="${esc(w.word)}" title="点击查看词义与发音：${esc(w.word)}">
        <span class="word-text">${esc(w.word)}</span>
        <span class="count">${w.count}</span>
        <span class="icon-btn ${starred ? 'starred' : ''}" data-act="star" title="${starred ? '移出生词本' : '收藏到生词本'}" data-word="${esc(w.word)}">${starred ? '★' : '☆'}</span>
        <span class="icon-btn" data-act="info" title="查看释义" data-word="${esc(w.word)}">ⓘ</span>
      </button>`;
  }).join('');

  if (state.activeTab === 'bookmarks') {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.style.cssText = 'flex-basis:100%;margin:6px 2px 0;font-size:12.5px;';
    hint.textContent = '点击单词查看词义并发音 · ☆ 移出生词本';
    listEl.appendChild(hint);
  }
}

// 点按发音时高亮当前正在朗读的单词
function highlightSpeaking(word) {
  $$('.chip.speaking').forEach((c) => c.classList.remove('speaking'));
  if (word !== null) {
    const chip = $(`.chip[data-word="${CSS.escape(word)}"]`);
    if (chip) chip.classList.add('speaking');
  }
}

/* ---------------- 列表事件（事件委托） ---------------- */
$('#wordList').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const actEl = e.target.closest('[data-act]');
  const word = chip.dataset.word;

  if (actEl && actEl.dataset.act === 'star') {
    e.stopPropagation();
    const count = Number($('.count', chip)?.textContent) || 0;
    toggleBookmark(word, count);
    return;
  }
  if (actEl && actEl.dataset.act === 'info') {
    e.stopPropagation();
    openDetail(word);
    return;
  }
  // 点击单词卡片 = 发音 + 弹出词义
  openDetail(word);
});

/* ---------------- 顶部操作 ---------------- */
$('#extractBtn').addEventListener('click', doExtract);
$('#reviewBtn').addEventListener('click', startReview);
$('#exportTxtBtn').addEventListener('click', () => exportWords('txt'));
$('#exportCsvBtn').addEventListener('click', () => exportWords('csv'));

$$('.tab').forEach((t) => t.addEventListener('click', () => {
  state.activeTab = t.dataset.tab;
  render();
}));

$('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

/* ---------------- 提取选项（变更后自动重新提取） ---------------- */
$('#minLenRange').addEventListener('input', (e) => {
  state.minLen = Number(e.target.value);
  $('#minLenLabel').textContent = state.minLen;
  maybeReExtract();
});
$('#stopwordToggle').addEventListener('change', (e) => { state.keepStopwords = !e.target.checked; maybeReExtract(); });
$('#stemToggle').addEventListener('change', (e) => { state.stem = e.target.checked; maybeReExtract(); });

let reExtractTimer = null;
function maybeReExtract() {
  if (!pendingFile) return;
  clearTimeout(reExtractTimer);
  reExtractTimer = setTimeout(doExtract, 350);
}

/* ============================================================
 * 单词详情（词典接口查询 + 发音，接口可在设置中更换）
 * ============================================================ */
async function fetchMeaning(word) {
  const s = state.dict;
  // 自定义接口：POST 配置给后端代为请求
  if (typeof s.provider === 'string' && s.provider.startsWith('custom:')) {
    const idx = Number(s.provider.slice(7));
    const cfg = s.customs[idx];
    if (!cfg || !cfg.urlTemplate || !cfg.resultPath) {
      // 配置失效，退回有道
      const r = await fetch('/api/dict/' + encodeURIComponent(word) + '?p=youdao');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }
    const r = await fetch('/api/dict/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, config: cfg }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  // 内置接口
  const provider = ['youdao', 'dictionaryapi'].includes(s.provider) ? s.provider : 'youdao';
  const r = await fetch('/api/dict/' + encodeURIComponent(word) + '?p=' + encodeURIComponent(provider));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function openDetail(word) {
  $('#detailWord').textContent = word;
  $('#detailPhonetic').textContent = '';
  $('#detailMeanings').innerHTML = '<div class="detail-loading">正在获取释义…（也可直接点 🔊 发音）</div>';
  $('#detailStarBtn').textContent = isBookmarked(word) ? '★' : '☆';
  $('#detailModal').hidden = false;
  speak(word);

  let data = state.meanings.get(word);
  if (data === undefined) {
    try {
      data = await fetchMeaning(word);
    } catch {
      data = null;
    }
    state.meanings.set(word, data);
  }
  renderDetail(word, data);
}

function renderDetail(word, data) {
  if (!data || (!data.zhMeanings && !data.enMeanings && !data.customTexts)) {
    $('#detailMeanings').innerHTML =
      '<div class="detail-offline">未找到该单词的释义（离线、接口不可用或词条不存在）。单词仍可点按发音，或点击 ☆ 收藏到生词本。<br>可点击右上角 ⚙️ 更换词典接口试试。</div>';
    return;
  }

  // 音标行
  const phParts = [];
  if (data.phoneticUs) phParts.push(`美 / ${esc(data.phoneticUs)} /`);
  if (data.phoneticUk) phParts.push(`英 / ${esc(data.phoneticUk)} /`);
  if (!phParts.length && data.phonetic) phParts.push(`/ ${esc(data.phonetic)} /`);
  if (!phParts.length && data.phoneticText) phParts.push(`/ ${esc(data.phoneticText)} /`);
  $('#detailPhonetic').textContent = phParts.join('　');

  let html = '';
  if (data.provider === 'youdao') {
    html = data.zhMeanings.map((s) => `<div class="meaning"><span class="zh">${esc(s)}</span></div>`).join('');
    if (data.wfs && data.wfs.length) html += `<p class="wfs">词形变化：${data.wfs.map(esc).join(' · ')}</p>`;
    if (data.examTypes && data.examTypes.length) html += `<p class="wfs">考试要求：${data.examTypes.map(esc).join(' · ')}</p>`;
  } else if (data.provider === 'dictionaryapi') {
    html = data.enMeanings.map((m) => `<div class="meaning"><span class="pos">${esc(m.pos)}</span>${
      m.defs.map((d) => `<p class="def">• ${esc(d.def)}</p>${d.ex ? `<p class="ex">例：${esc(d.ex)}</p>` : ''}`).join('')
    }</div>`).join('');
  } else if (data.provider === 'custom') {
    html = data.customTexts.map((s) => `<div class="meaning"><span class="zh">${esc(s)}</span></div>`).join('');
  }

  if (data.note) html += `<p class="wfs">💡 ${esc(data.note)}</p>`;
  html += `<p class="wfs">来源：${esc(data.sourceName || data.provider || '未知')}</p>`;
  $('#detailMeanings').innerHTML = html;
}

$('#detailSpeakBtn').addEventListener('click', () => speak($('#detailWord').textContent));
$('#detailStarBtn').addEventListener('click', () => {
  const word = $('#detailWord').textContent;
  const count = state.words.find((w) => w.word === word)?.count || 0;
  toggleBookmark(word, count);
  $('#detailStarBtn').textContent = isBookmarked(word) ? '★' : '☆';
});

/* ============================================================
 * 听音复习模式
 * ============================================================ */
let review = null;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startReview() {
  const list = visibleWords();
  if (!list.length) { toast('当前列表为空，无法开始复习', 'warn'); return; }
  review = { queue: shuffle(list.map((w) => w.word)), idx: 0, known: [], unknown: [] };
  $('#reviewResult').classList.add('hidden');
  $('#reviewModal').hidden = false;
  showReviewItem();
}

function showReviewItem() {
  const r = review;
  if (r.idx >= r.queue.length) { finishReview(); return; }
  const word = r.queue[r.idx];
  $('#reviewProgress').textContent = `${r.idx + 1} / ${r.queue.length}`;
  $('#reviewWord').textContent = word;
  $('#reviewWord').classList.add('blurred');
  $('#reviewRevealBtn').classList.remove('hidden');
  $('#reviewButtons').classList.add('hidden');
  speak(word);
}

function revealReviewWord() {
  $('#reviewWord').classList.remove('blurred');
  $('#reviewRevealBtn').classList.add('hidden');
  $('#reviewButtons').classList.remove('hidden');
}

function markReview(kind) {
  const r = review;
  const word = r.queue[r.idx];
  (kind === 'known' ? r.known : r.unknown).push(word);
  r.idx++;
  setTimeout(showReviewItem, 260);
}

function finishReview() {
  const r = review;
  $('#reviewProgress').textContent = '完成 🎉';
  $('#reviewWord').textContent = `认识 ${r.known.length} · 不认识 ${r.unknown.length}`;
  $('#reviewWord').classList.remove('blurred');
  $('#reviewRevealBtn').classList.add('hidden');
  $('#reviewButtons').classList.add('hidden');
  const unknownEl = $('#reviewUnknown');
  unknownEl.innerHTML = r.unknown.length
    ? r.unknown.map((w) => `<button class="chip" data-speak="${esc(w)}">${esc(w)}</button>`).join('')
    : '<p class="muted">全部认识，太棒了！🎉</p>';
  $('#reviewResult').classList.remove('hidden');
  $('#reviewResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#reviewSpeakBtn').addEventListener('click', () => {
  if (review && review.idx < review.queue.length) speak(review.queue[review.idx]);
});
$('#reviewRevealBtn').addEventListener('click', revealReviewWord);
$('#reviewKnownBtn').addEventListener('click', () => markReview('known'));
$('#reviewUnknownBtn').addEventListener('click', () => markReview('unknown'));
$('#reviewRetryBtn').addEventListener('click', () => {
  if (!review) return;
  const unknown = review.unknown;
  if (!unknown.length) { toast('没有不认识的单词啦', 'success'); return; }
  $('#reviewResult').classList.add('hidden');
  review = { queue: shuffle(unknown), idx: 0, known: [], unknown: [] };
  showReviewItem();
});
$('#reviewModal').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-speak]');
  if (chip) speak(chip.dataset.speak);
});

/* ---------------- 弹窗开关 ---------------- */
$$('.modal-close').forEach((btn) => btn.addEventListener('click', () => {
  const modal = document.getElementById(btn.dataset.close);
  if (modal) {
    modal.hidden = true;
    if (modal.id === 'reviewModal') { speechSynthesis.cancel(); review = null; }
  }
}));
$$('.modal-overlay').forEach((ov) => ov.addEventListener('click', (e) => {
  if (e.target === ov) {
    ov.hidden = true;
    if (ov.id === 'reviewModal') { speechSynthesis.cancel(); review = null; }
  }
}));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal-overlay:not([hidden])').forEach((ov) => { ov.hidden = true; });
  }
});

/* ============================================================
 * 导出
 * ============================================================ */
function exportWords(kind) {
  const list = visibleWords();
  if (!list.length) { toast('没有可导出的单词', 'warn'); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'txt') {
    const content = list.map((w) => `${w.word} (${w.count})`).join('\n');
    download(content, `vocabpal-words-${stamp}.txt`, 'text/plain;charset=utf-8');
  } else {
    const rows = [['word', 'count'], ...list.map((w) => [w.word, String(w.count)])];
    const csv = '\ufeff' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
    download(csv, `vocabpal-words-${stamp}.csv`, 'text/csv;charset=utf-8');
  }
  toast(`已导出 ${list.length} 个单词`, 'success');
}

function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============================================================
 * 词典接口设置弹窗
 * ============================================================ */
let editingCustomIdx = null; // null=新增，数字=编辑第几个

const BUILTIN_DEFS = [
  { id: 'youdao', name: '有道词典', desc: '中文释义 · 英美音标 · 词形变化' },
  { id: 'dictionaryapi', name: 'Free Dictionary', desc: '英文释义 · 音标 · 例句（dictionaryapi.dev）' },
];

function providerLabel(provider) {
  if (typeof provider === 'string' && provider.startsWith('custom:')) {
    const idx = Number(provider.slice(7));
    const c = state.dict.customs[idx];
    return c ? '自定义：' + c.name : '自定义接口';
  }
  const b = BUILTIN_DEFS.find((x) => x.id === provider);
  return b ? b.name : '有道词典';
}

function openSettings() {
  renderSettings();
  $('#settingsModal').hidden = false;
}

function renderSettings() {
  // 内置接口
  $('#builtinList').innerHTML = BUILTIN_DEFS.map((b) => `
    <label class="provider-item">
      <input type="radio" name="provider" value="${b.id}" ${state.dict.provider === b.id ? 'checked' : ''}>
      <div class="provider-info"><b>${esc(b.name)}</b><span class="muted">${esc(b.desc)}</span></div>
    </label>`).join('');

  // 自定义接口
  const customs = state.dict.customs;
  $('#customEmpty').style.display = customs.length ? 'none' : 'block';
  $('#customList').innerHTML = customs.map((c, i) => `
    <div class="provider-item custom-item">
      <label class="provider-main">
        <input type="radio" name="provider" value="custom:${i}" ${state.dict.provider === 'custom:' + i ? 'checked' : ''}>
        <div class="provider-info"><b>${esc(c.name || '未命名接口')}</b><span class="muted">${esc(c.urlTemplate || '')}</span></div>
      </label>
      <div class="custom-ops">
        <button class="btn btn-round small" data-custom-edit="${i}" title="编辑">✏️</button>
        <button class="btn btn-round small" data-custom-del="${i}" title="删除">🗑</button>
      </div>
    </div>`).join('') || '';

  // 选中变化即保存
  $$('input[name="provider"]', $('#settingsModal')).forEach((el) => {
    el.addEventListener('change', () => {
      state.dict.provider = el.value;
      saveDictSettings();
      toast('已切换词典接口：' + providerLabel(el.value), 'success');
    });
  });
  $$('[data-custom-edit]', $('#settingsModal')).forEach((btn) => {
    btn.addEventListener('click', () => openCustomForm(Number(btn.dataset.customEdit)));
  });
  $$('[data-custom-del]', $('#settingsModal')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.customDel);
      state.dict.customs.splice(i, 1);
      if (state.dict.provider === 'custom:' + i) state.dict.provider = 'youdao';
      saveDictSettings();
      renderSettings();
      toast('已删除自定义接口', 'info');
    });
  });
}

function openCustomForm(idx) {
  editingCustomIdx = idx;
  const c = idx != null ? state.dict.customs[idx] : null;
  $('#customFormTitle').textContent = c ? '编辑接口：' + c.name : '添加自定义接口';
  $('#cfgName').value = c ? c.name : '';
  $('#cfgUrl').value = c ? c.urlTemplate : '';
  $('#cfgMethod').value = c ? (c.method || 'GET') : 'GET';
  $('#cfgHeaders').value = c && c.headers ? JSON.stringify(c.headers, null, 2) : '';
  $('#cfgBody').value = c ? (c.bodyTemplate || '') : '';
  $('#cfgResultPath').value = c ? c.resultPath : '';
  $('#cfgPhoneticPath').value = c ? (c.phoneticPath || '') : '';
  $('#cfgBodyRow').hidden = $('#cfgMethod').value !== 'POST';
  $('#customTestResult').hidden = true;
  $('#customForm').hidden = false;
  $('#customForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function collectCustomForm() {
  const name = $('#cfgName').value.trim();
  const urlTemplate = $('#cfgUrl').value.trim();
  const method = $('#cfgMethod').value;
  let headers = {};
  const headersRaw = $('#cfgHeaders').value.trim();
  if (headersRaw) {
    try { headers = JSON.parse(headersRaw); }
    catch { toast('请求头不是合法的 JSON', 'error'); return null; }
  }
  let bodyTemplate = $('#cfgBody').value.trim();
  if (method === 'POST' && !bodyTemplate) bodyTemplate = '{"word":"{word}"}';
  const resultPath = $('#cfgResultPath').value.trim();
  const phoneticPath = $('#cfgPhoneticPath').value.trim();
  if (!name || !urlTemplate || !resultPath) {
    toast('请填写：接口名称、URL 模板、释义路径', 'warn');
    return null;
  }
  if (!urlTemplate.includes('{word}')) {
    toast('URL 模板需要包含 {word} 占位符', 'warn');
    return null;
  }
  return { name, urlTemplate, method, headers, bodyTemplate, resultPath, phoneticPath };
}

async function testCustomInterface() {
  const cfg = collectCustomForm();
  if (!cfg) return;
  const out = $('#customTestResult');
  out.hidden = false;
  out.className = 'custom-test';
  out.textContent = '正在测试（单词：test）…';
  try {
    const r = await fetch('/api/dict/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'test', config: cfg }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    if (data.customTexts && data.customTexts.length) {
      out.className = 'custom-test ok';
      out.textContent = '✅ 查询成功：' + data.customTexts.slice(0, 3).join(' ｜ ');
    } else if (data.provider && data.provider !== 'custom') {
      out.className = 'custom-test warn';
      out.textContent = '⚠️ 接口未查到，已兜底：' + (data.note || data.sourceName || '其他接口');
    } else {
      out.className = 'custom-test warn';
      out.textContent = '⚠️ 接口返回正常但未取到释义，请检查「释义路径」';
    }
  } catch (e) {
    out.className = 'custom-test err';
    out.textContent = '❌ 测试失败：' + e.message;
  }
}

function saveCustomForm() {
  const cfg = collectCustomForm();
  if (!cfg) return;
  if (editingCustomIdx == null) {
    state.dict.customs.push(cfg);
    state.dict.provider = 'custom:' + (state.dict.customs.length - 1);
    toast('已添加自定义接口', 'success');
  } else {
    state.dict.customs[editingCustomIdx] = cfg;
    toast('已保存修改', 'success');
  }
  saveDictSettings();
  editingCustomIdx = null;
  $('#customForm').hidden = true;
  renderSettings();
}

$('#settingsBtn').addEventListener('click', openSettings);
$('#addCustomBtn').addEventListener('click', () => openCustomForm(null));
$('#saveCustomBtn').addEventListener('click', saveCustomForm);
$('#cancelCustomBtn').addEventListener('click', () => { editingCustomIdx = null; $('#customForm').hidden = true; });
$('#testCustomBtn').addEventListener('click', testCustomInterface);
$('#cfgMethod').addEventListener('change', () => { $('#cfgBodyRow').hidden = $('#cfgMethod').value !== 'POST'; });

/* ---------------- 初始化 ---------------- */
render();
