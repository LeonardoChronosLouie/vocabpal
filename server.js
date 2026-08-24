'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { extractWords } = require('./lib/words');

// 预加载 pdf.js worker（主线程 fake worker），设置 globalThis.pdfjsWorker，
// 使 pdf.js 不再需要动态 import()（打包成 exe 后动态 import 不可用）。
try {
  require('./lib/pdf.worker.embed.cjs');
} catch (e1) {
  try {
    // 开发模式兜底：嵌入文件缺失时，从 node_modules 现场生成
    const fs = require('fs');
    const srcPath = path.join(__dirname, 'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'cjs', 'pdf.worker.mjs');
    const src = fs.readFileSync(srcPath, 'utf8')
      .replace(/;\s*export\s*\{[^}]*\}\s*;?\s*$/, '')
      .replace(/\bimport\.meta\.url\b/g, "'file:///pdf.worker.embed.cjs'");
    const embedPath = path.join(__dirname, 'lib', 'pdf.worker.embed.cjs');
    fs.writeFileSync(embedPath, "'use strict';\n" + src + "\n");
    require(embedPath);
  } catch (e2) {
    console.warn('[worker] pdf.js worker 预加载失败，使用默认方式:', e2.message);
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 3789;

// 静态前端
app.use(express.static(path.join(__dirname, 'public')));
// JSON body 解析（自定义接口查询等）
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 上限
  fileFilter(req, file, cb) {
    const ok = file.originalname.toLowerCase().endsWith('.pdf') ||
               (file.mimetype && file.mimetype === 'application/pdf');
    // 注意：multer 2.x 必须显式传第二个参数，否则文件会被当作「拒绝」而丢弃
    cb(ok ? null : new Error('只支持 PDF 文件'), ok);
  },
});

/**
 * POST /api/extract
 * multipart 表单：pdf=文件, minLen=最短词长, keepStopwords=true/false, stem=true/false
 */
app.post('/api/extract', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到 PDF 文件' });

    let text = '';
    try {
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      text = result.text || '';
      await parser.destroy().catch(() => {});
    } catch (err) {
      return res.status(422).json({ error: 'PDF 解析失败：' + err.message });
    }

    const options = {
      minLen: parseInt(req.body.minLen, 10) || 3,
      keepStopwords: req.body.keepStopwords === 'true',
      stem: req.body.stem !== 'false',
    };

    const result = extractWords(text, options);
    result.fileName = req.file.originalname;
    result.hasText = text.trim().length > 0;
    if (!result.hasText) {
      result.warning = '未能从该 PDF 中提取到文字，可能是扫描版/图片型 PDF，需要先做 OCR。';
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// multer 错误（如非 PDF 文件）统一返回 JSON
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'VocabPal' }));

/* ============================================================
 * 词典接口系统：内置接口注册表 + 自定义接口（用户可配置）
 * 前端无法直连有道等接口（无 CORS），统一由后端代理。
 * 查询时按用户选择的接口，查不到自动尝试其他接口兜底。
 * ============================================================ */
const DICT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const dictCache = new Map(); // word+provider -> data（简单容量限制）
const DICT_CACHE_MAX = 3000;

const BUILTIN_PROVIDERS = [
  { id: 'youdao', name: '有道词典', lang: '中文释义 · 英美音标', sourceName: '有道词典' },
  { id: 'dictionaryapi', name: 'Free Dictionary', lang: '英文释义 · 音标', sourceName: 'Free Dictionary (dictionaryapi.dev)' },
];

function getByPath(obj, path) {
  if (!path || obj == null) return undefined;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** 把取出的值规范化为字符串列表（字符串→单项；数组→每项取字符串或首个字符串字段） */
function toTextList(value) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (item == null) continue;
      if (typeof item === 'string') { if (item.trim()) out.push(item.trim()); }
      else if (typeof item === 'object') {
        const first = Object.values(item).find((v) => typeof v === 'string' && v.trim());
        if (first) out.push(first.trim());
      } else if (typeof item === 'number') {
        out.push(String(item));
      }
    }
    return out;
  }
  return [String(value)];
}

/* ---------- 内置接口：有道（中文） ---------- */
async function queryYoudao(word) {
  const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': DICT_UA, Referer: 'https://dict.youdao.com/', Accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('youdao HTTP ' + res.status);
  const data = await res.json();
  const ec = data && data.ec && data.ec.word && data.ec.word[0];
  if (!ec) return null;
  const zhMeanings = (ec.trs || [])
    .map((t) => t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i && t.tr[0].l.i[0])
    .filter((s) => s && /[\u4e00-\u9fa5]/.test(s));
  if (!zhMeanings.length) return null;
  return {
    word,
    provider: 'youdao',
    sourceName: '有道词典',
    phoneticUs: ec.usphone || null,
    phoneticUk: ec.ukphone || null,
    zhMeanings,
    wfs: (ec.wfs || []).map((w) => w.wf && w.wf.value).filter(Boolean),
    examTypes: ec.exam_type || [],
  };
}

/* ---------- 内置接口：Free Dictionary（英文） ---------- */
async function queryDictionaryApi(word) {
  const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word);
  const res = await fetch(url, { headers: { 'User-Agent': DICT_UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('dictapi HTTP ' + res.status);
  const arr = await res.json();
  const d = Array.isArray(arr) && arr[0];
  if (!d) return null;
  const enMeanings = (d.meanings || []).slice(0, 3)
    .map((m) => ({
      pos: m.partOfSpeech || '',
      defs: (m.definitions || []).slice(0, 3)
        .map((dd) => ({ def: dd.definition || '', ex: dd.example || '' }))
        .filter((x) => x.def),
    }))
    .filter((g) => g.defs.length);
  if (!enMeanings.length) return null;
  const ph = d.phonetic || (d.phonetics || []).find((p) => p.text)?.text || null;
  return { word, provider: 'dictionaryapi', sourceName: 'Free Dictionary (dictionaryapi.dev)', phonetic: ph, enMeanings };
}

const BUILTIN_QUERIES = { youdao: queryYoudao, dictionaryapi: queryDictionaryApi };

/* ---------- 自定义接口 ---------- */
async function queryCustom(word, config) {
  if (!config || !config.urlTemplate || !config.resultPath) {
    throw new Error('自定义接口配置不完整（需要 URL 模板与释义路径）');
  }
  const method = (config.method || 'GET').toUpperCase();
  const url = String(config.urlTemplate).replace(/\{word\}/g, encodeURIComponent(word));
  const headers = {};
  if (config.headers && typeof config.headers === 'object') {
    for (const [k, v] of Object.entries(config.headers)) headers[k] = String(v).replace(/\{word\}/g, word);
  }
  const fetchOpts = { method, headers, signal: AbortSignal.timeout(12000) };
  if (method === 'POST') {
    let body = config.bodyTemplate != null && config.bodyTemplate !== '' ? config.bodyTemplate : '{"word":"{word}"}';
    body = String(body).replace(/\{word\}/g, word);
    fetchOpts.body = body;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error('自定义接口 HTTP ' + res.status);
  const data = await res.json();
  const texts = toTextList(getByPath(data, config.resultPath));
  if (!texts.length) return null;
  const ph = getByPath(data, config.phoneticPath);
  const phoneticText = typeof ph === 'string' && ph.trim() ? ph.trim() : null;
  return {
    word,
    provider: 'custom',
    sourceName: '自定义：' + (config.name || '未命名接口'),
    phoneticText,
    customTexts: texts.slice(0, 8),
  };
}

/** 按优先级依次尝试查询，返回第一个成功的结果 */
async function queryWithFallback(word, preferredQueries, preferredSourceName) {
  let result = null;
  for (const q of preferredQueries) {
    try { result = await q(word); } catch (e) { result = null; }
    if (result) break;
  }
  if (result && preferredSourceName && result.sourceName !== preferredSourceName) {
    result.note = `所选接口未查到，已自动使用 ${result.sourceName}`;
  }
  return result;
}

app.get('/api/dict/providers', (req, res) => {
  res.json({ builtin: BUILTIN_PROVIDERS });
});

/**
 * GET /api/dict/:word?p=youdao|dictionaryapi
 * 按所选内置接口查询，查不到时自动兜底另一个内置接口。
 */
app.get('/api/dict/:word', async (req, res) => {
  try {
    const word = String(req.params.word || '').trim().toLowerCase();
    if (!/^[a-z]+$/.test(word)) return res.status(400).json({ error: '无效单词' });
    const preferred = String(req.query.p || 'youdao');
    const cacheKey = word + '|' + preferred;
    const cached = dictCache.get(cacheKey);
    if (cached) return res.json(cached);

    const preferredQuery = BUILTIN_QUERIES[preferred] || queryYoudao;
    const fallbackQueries = BUILTIN_PROVIDERS.map((p) => BUILTIN_QUERIES[p.id]).filter((q) => q !== preferredQuery);
    const data = await queryWithFallback(word, [preferredQuery, ...fallbackQueries], BUILTIN_PROVIDERS.find((p) => p.id === preferred)?.sourceName);
    if (!data) return res.status(404).json({ word, provider: null, error: '未找到释义' });

    if (dictCache.size > DICT_CACHE_MAX) dictCache.clear();
    dictCache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dict/custom  body: { word, config }
 * 按自定义接口配置查询，失败时自动兜底内置接口。
 */
app.post('/api/dict/custom', async (req, res) => {
  try {
    const word = String((req.body && req.body.word) || '').trim().toLowerCase();
    const config = (req.body && req.body.config) || null;
    if (!/^[a-z]+$/.test(word)) return res.status(400).json({ error: '无效单词' });
    if (!config) return res.status(400).json({ error: '缺少接口配置' });

    const cacheKey = word + '|custom|' + JSON.stringify(config);
    const cached = dictCache.get(cacheKey);
    if (cached) return res.json(cached);

    const fallbackQueries = BUILTIN_PROVIDERS.map((p) => BUILTIN_QUERIES[p.id]);
    let data = null;
    try { data = await queryCustom(word, config); } catch (e) { data = null; }
    if (!data) {
      data = await queryWithFallback(word, fallbackQueries, '自定义接口');
    }
    if (!data) return res.status(404).json({ word, provider: null, error: '未找到释义' });

    if (dictCache.size > DICT_CACHE_MAX) dictCache.clear();
    dictCache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PREFERRED_PORT = Number(process.env.PORT) || 3789;
const MAX_PORT_TRIES = 10;

function listen(port, remaining) {
  const server = app.listen(port, () => {
    console.log('==================================================');
    console.log('  VocabPal 背单词助手已启动');
    console.log(`  请在浏览器打开: http://127.0.0.1:${port}`);
    console.log('==================================================');
    // 独立 exe 双击运行时自动打开浏览器（设置 VOCABPAL_NO_OPEN=1 可关闭）
    if (process.pkg && !process.env.VOCABPAL_NO_OPEN) {
      try {
        require('child_process').exec(`start "" "http://127.0.0.1:${port}"`);
      } catch (e) { /* 忽略打开失败 */ }
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && remaining > 0) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1} …`);
      listen(port + 1, remaining - 1);
    } else {
      console.error('启动失败:', err.message);
      process.exit(1);
    }
  });
}

listen(PREFERRED_PORT, MAX_PORT_TRIES);
