# 📖 VocabPal 背单词助手

自动识别 PDF 中的英文单词并录入单词表，重复单词只保留一遍（统计出现次数），点按任意单词即可发音。

> 🛡️ **隐私说明**：本应用完全本地运行。PDF 文件只在你的电脑上解析，不会上传到任何第三方服务器；仅「在线释义」功能会在你主动点击 ⓘ 时联网查询 `api.dictionaryapi.dev`。

## ✨ 功能

- **PDF 单词自动提取**：拖入 PDF 或点击选择，自动解析其中的英文单词
- **自动去重**：重复单词只保留一遍（不区分大小写），并统计每个单词在文档中出现的频率
- **词形归并**（默认开启）：`learns / learning / learned` 归并为 `learn`，`students` → `student`，避免重复收录
- **过滤虚词**（默认开启）：`the / and / of` 等常见功能词不收录，可随时开关
- **点按发音**：点击任意单词立即朗读（使用系统语音，离线可用）
- **查看释义**：点击 ⓘ 在线查询音标与释义（需联网，失败时不影响发音）
- **生词本**：⭐ 收藏单词，保存在浏览器本地，跨会话保留
- **听音复习**：🔁 听发音回忆单词，标记「认识 / 不认识」，可反复练习不认识的词
- **排序与搜索**：按频率 / 字母 / 长度排序，支持关键字过滤
- **导出**：一键导出 TXT / CSV 单词表

## 🚀 快速开始

### 方式一：双击启动（Windows）

双击 `start.bat`，首次运行会自动安装依赖，然后自动打开服务。

### 方式二：命令行

```bash
cd vocab-app
npm install        # 首次运行需要
npm start          # 启动服务
```

启动后在浏览器打开：**http://127.0.0.1:3789**

> 发音依赖浏览器的语音合成能力，推荐使用 **Edge / Chrome**（Windows 自带微软英语语音）。
> 如果听不到声音：确认系统已安装英语语音包（设置 → 时间和语言 → 语音），并在浏览器设置中允许自动播放/语音。

## 📌 使用流程

1. 打开页面，把 PDF 拖进虚线区域（或点击选择文件）
2. 点「⚡ 开始提取单词」，稍候即可看到去重后的单词表
3. 点击单词即可听发音；点 ☆ 收藏到生词本；点 ⓘ 看释义
4. 点「🔁 听音复习」把当前列表变成听力训练
5. 用「⬇ TXT / CSV」导出单词表

## ⚙️ 提取选项

| 选项 | 说明 |
| --- | --- |
| 最短词长 | 少于该字母数的词不收录（默认 3） |
| 词形归并 | 自动合并单复数 / 时态变体（默认开启） |
| 过滤虚词 | 剔除 the、and、of 等高频功能词（默认开启） |

选项变更后会自动重新提取。

## 🗂 目录结构

```
vocab-app/
├── server.js              # Express 服务器 + PDF 解析接口
├── lib/words.js           # 单词提取 / 去重 / 词形归并逻辑
├── public/                # 前端界面
│   ├── index.html
│   ├── style.css
│   └── app.js
├── scripts/
│   ├── gen-test-pdf.js    # 生成测试 PDF（pdfkit）
│   ├── test-api.mjs       # 接口端到端测试
│   └── test-api-real.mjs  # 用真实 PDF 测试
├── test-files/            # 测试用 PDF
├── start.bat              # Windows 一键启动
└── package.json
```

## 🔌 API

`POST /api/extract`（multipart 表单）

| 字段 | 说明 |
| --- | --- |
| `pdf` | PDF 文件（必填，≤100MB） |
| `minLen` | 最短词长，默认 3 |
| `keepStopwords` | `true` 保留虚词，默认 `false` 过滤 |
| `stem` | `true` 开启词形归并，默认 `true` |

响应：

```json
{
  "totalWords": 5603,
  "uniqueWords": 1071,
  "filteredCount": 2430,
  "words": [ { "word": "model", "count": 88 }, ... ],
  "fileName": "paper.pdf",
  "hasText": true
}
```

## ⚠️ 已知限制

- **扫描版 / 图片型 PDF** 没有可提取的文字层，需要先 OCR（如 Adobe 的「导出」或在线 OCR 工具）再导入
- 释义查询依赖 `api.dictionaryapi.dev`，离线时自动降级（仅发音）
- 词形归并为尽力而为的规则算法，个别不规则变化（如 `children`）可能不会被归并

## 🧪 开发测试

```bash
npm run gen:test    # 生成测试 PDF 到 test-files/sample.pdf
npm run test:api    # 启动服务后运行接口测试（用小样本 PDF）
node scripts/test-api-real.mjs   # 用 test-files/arxiv-test.pdf 真实论文测试
```
