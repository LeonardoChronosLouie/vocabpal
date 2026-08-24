'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { extractWords } = require('./lib/words');

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

app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`  VocabPal 背单词助手已启动`);
  console.log(`  请在浏览器打开: http://127.0.0.1:${PORT}`);
  console.log('==================================================');
});
