'use strict';

/**
 * 将 pdf-parse 自带的 pdf.worker.mjs 转换为可直接 require 的 CJS 文件。
 * 转换后的文件执行副作用：设置 globalThis.pdfjsWorker（主线程 fake worker 句柄），
 * 从而使 pdf.js 不再需要动态 import()（打包成 exe 后动态 import 不可用）。
 *
 * 用法: node scripts/build-worker-embed.js
 */

const fs = require('fs');
const path = require('path');

const workerMjs = path.join(
  __dirname, '..', 'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'cjs', 'pdf.worker.mjs'
);
const outCjs = path.join(__dirname, '..', 'lib', 'pdf.worker.embed.cjs');

if (!fs.existsSync(workerMjs)) {
  console.error('[build-worker-embed] 未找到', workerMjs);
  process.exit(1);
}

let src = fs.readFileSync(workerMjs, 'utf8');
// 去掉结尾的 export 语句，使其可作为普通脚本执行（其余代码均为副作用）
const cleaned = src
  .replace(/;\s*export\s*\{[^}]*\}\s*;?\s*$/, '')
  // import.meta 是 ESM 专属语法，仅出现在 OpenJPEG 解码器的 glue 代码中（与文本提取无关），替换为安全字面量
  .replace(/\bimport\.meta\.url\b/g, "'file:///pdf.worker.embed.cjs'");

if (cleaned === src) {
  console.error('[build-worker-embed] 警告：未找到结尾 export 语句，结果可能无效');
}

const banner = `'use strict';\n/* 自动生成，请勿手动编辑。由 scripts/build-worker-embed.js 生成。 */\n`;
fs.writeFileSync(outCjs, banner + cleaned + '\n');
console.log('[build-worker-embed] 已生成', outCjs, `(${(banner + cleaned).length} 字符)`);
