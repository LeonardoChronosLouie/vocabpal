'use strict';

/**
 * 英文单词提取与去重逻辑。
 * 重复单词只保留一遍（不区分大小写），并统计每个单词在文档中出现的次数。
 */

// 常见英语虚词 / 功能词（默认过滤，可在前端关闭）
const STOPWORDS = new Set(`
a an and are as at be been being but by can could did do does doing for from had
has have having he her here hers him his how i if in into is it its itself just
me more most my myself no nor not now of off on once one only or other our ours
ourselves out over own same she should so some such than that the their theirs
them themselves then there these they this those through to too under until up
upon us very we were what when where which while who whom why will with would
you your yours yourself yourselves
about above after again against all also am among any anybody anyone anything
anything anywhere because before below between both down each either else
every everybody everyone everything everywhere few get got least let like
lots many may might must neither never next nobody noone nothing nowhere
per plenty quite rather really say says several shall since somebody someone
something sometimes somewhere still such sure tell things those till try
unless well whatever when whenever where wherever whether whichever whoever
whom whose why
`.trim().split(/\s+/));

// 词形还原辅助：去掉常见的名词复数 / 动词时态后缀（尽力而为，不保证 100% 准确）
const PLURAL_RULES = [
  [/ies$/i, 'y'],        // studies -> study, babies -> baby
  [/ses$/i, 's'],        // cases -> case, buses -> bus
  [/xes$/i, 'x'],        // boxes -> box
  [/zes$/i, 'z'],        // quizzes -> quiz
  [/ches$/i, 'ch'],      // matches -> match
  [/shes$/i, 'sh'],      // dishes -> dish
  [/ves$/i, 'f'],        // leaves -> leaf (概略)
  [/s$/i, ''],           // words -> word
];
const TENSE_RULES = [
  [/ing$/i, ''],         // running -> run (概略)
  [/ed$/i, ''],          // played -> play (概略)
  [/es$/i, ''],
];

function tokenize(text) {
  // 匹配连续的英文字母，允许中间包含连字符或撇号（如 well-known、world's）
  const re = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) tokens.push(m[0]);
  return tokens;
}

function normalize(raw) {
  let w = raw.toLowerCase();
  // 去除所有格 's（world's -> world）
  w = w.replace(/^(.*)['’]s$/, '$1');
  // 只保留纯字母（过滤掉 don't / can't 之类的缩写形式）
  if (!/^[a-z]+$/.test(w)) return null;
  return w;
}

function stem(word) {
  // 仅对长度 >= 5 的词尝试还原，避免误伤短词（如 gas、bus、this）
  if (word.length < 5) return word;
  let w = word;
  for (const [re, rep] of PLURAL_RULES) {
    if (re.test(w) && w.replace(re, rep).length >= 3) {
      w = w.replace(re, rep);
      break;
    }
  }
  for (const [re, rep] of TENSE_RULES) {
    if (re.test(w) && w.replace(re, rep).length >= 3) {
      w = w.replace(re, rep);
      break;
    }
  }
  return w;
}

/**
 * 从纯文本中提取去重后的单词表。
 * @param {string} text 提取出的 PDF 文本
 * @param {{minLen?: number, keepStopwords?: boolean, stem?: boolean}} options
 * @returns {{totalWords:number, uniqueWords:number, filteredCount:number, words:Array<{word:string,count:number}>}}
 */
function extractWords(text, options = {}) {
  const minLen = options.minLen && options.minLen >= 1 ? options.minLen : 3;
  const keepStopwords = !!options.keepStopwords;
  const doStem = options.stem !== false; // 默认开启词形归并（learns/learning/learned -> learn）

  const tokens = tokenize(text || '');
  const freq = new Map();      // 原形 -> 次数
  const forms = new Map();     // 原形 -> 出现过的写法集合

  let dropped = 0;             // 被规则过滤掉的 token 数
  for (const raw of tokens) {
    const w = normalize(raw);
    if (!w) { dropped++; continue; }
    if (w.length < minLen) { dropped++; continue; }
    if (!keepStopwords && STOPWORDS.has(w)) { dropped++; continue; }
    const key = doStem ? stem(w) : w;
    freq.set(key, (freq.get(key) || 0) + 1);
    if (!forms.has(key)) forms.set(key, new Set());
    forms.get(key).add(w);
  }

  const words = [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => a.word.localeCompare(b.word));

  return {
    totalWords: tokens.length,
    uniqueWords: words.length,
    filteredCount: dropped,
    words,
  };
}

module.exports = { extractWords, STOPWORDS: [...STOPWORDS] };
