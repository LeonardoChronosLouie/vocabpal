'use strict';
// 端到端测试脚本：用 Node 原生 fetch 上传 PDF 并打印提取结果
// 用法: node scripts/test-api.mjs [端口] [PDF路径]  默认 3789 / test-files/sample.pdf
import fs from 'fs';

const port = process.argv[2] || '3789';
const pdfPath = process.argv[3] || 'E:/DeepSeek Harness/vocab-app/test-files/sample.pdf';
const base = `http://127.0.0.1:${port}`;

const form = new FormData();
form.append(
  'pdf',
  new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }),
  'sample.pdf'
);
form.append('minLen', '3');
form.append('keepStopwords', 'false');
form.append('stem', 'true');

const res = await fetch(`${base}/api/extract`, { method: 'POST', body: form });
console.log('HTTP', res.status);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
