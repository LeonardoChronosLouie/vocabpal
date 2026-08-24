'use strict';
// 用真实 PDF 做端到端测试
import fs from 'fs';

const pdfPath = 'E:/DeepSeek Harness/vocab-app/test-files/arxiv-test.pdf';
const form = new FormData();
form.append('pdf', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), 'arxiv-test.pdf');
form.append('minLen', '3');
form.append('keepStopwords', 'false');
form.append('stem', 'true');

const res = await fetch('http://127.0.0.1:3789/api/extract', { method: 'POST', body: form });
const d = await res.json();
console.log('HTTP', res.status);
console.log('totalWords:', d.totalWords, '| uniqueWords:', d.uniqueWords, '| filteredCount:', d.filteredCount, '| hasText:', d.hasText);
console.log('--- top 15 by frequency ---');
d.words.sort((a, b) => b.count - a.count).slice(0, 15).forEach((w) => console.log(String(w.count).padStart(5), w.word));
console.log('--- sample alphabetical ---');
console.log(d.words.slice(0, 10).map((w) => w.word).join(', '));
