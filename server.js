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
