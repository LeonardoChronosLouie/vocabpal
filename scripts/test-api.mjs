'use strict';
// 端到端测试脚本：用 Node 原生 fetch 上传 PDF 并打印提取结果
import fs from 'fs';

const pdfPath = 'E:/DeepSeek Harness/vocab-app/test-files/sample.pdf';
const form = new FormData();
form.append(
  'pdf',
  new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }),
  'sample.pdf'
);
form.append('minLen', '3');
form.append('keepStopwords', 'false');
form.append('stem', 'true');

const res = await fetch('http://127.0.0.1:3789/api/extract', { method: 'POST', body: form });
console.log('HTTP', res.status);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
