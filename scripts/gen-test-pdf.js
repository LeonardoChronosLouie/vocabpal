'use strict';

/**
 * 生成一个用于测试的 PDF（嵌入字体，接近真实文档），
 * 供端到端测试单词提取 / 去重 / 词形归并。
 * 用法: node scripts/gen-test-pdf.js [输出路径]
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const outPath = process.argv[2] || path.join(__dirname, '..', 'test-files', 'sample.pdf');

const paragraphs = [
  'Hello World',
  'The quick brown fox jumps over the lazy dog.',
  "Hello world again! The world's quick brown fox.",
  'Learning vocabulary helps you learn faster. Learning English is fun.',
  'Studies show that students study hard every day.',
  'The quick brown fox jumps over the lazy dog once more. Hello again!',
];

function buildPdf(lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // 优先嵌入系统字体（保证文本提取稳定可靠）
    const sysFonts = ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\times.ttf'];
    const fontFile = sysFonts.find((f) => fs.existsSync(f));
    if (fontFile) doc.font(fontFile);

    doc.fontSize(20);
    lines.forEach((line, i) => {
      if (i > 0) doc.moveDown(0.9);
      doc.text(line);
    });
    doc.end();
  });
}

(async () => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = await buildPdf(paragraphs);
  fs.writeFileSync(outPath, buf);
  console.log('已生成测试 PDF:', outPath, `(${buf.length} bytes)`);
})().catch((e) => {
  console.error('生成失败:', e.message);
  process.exit(1);
});
