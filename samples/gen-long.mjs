#!/usr/bin/env node
// Generates samples/long-ar.md (~200k words, 60 chapters) by repeating the
// paragraphs of samples/sample-ar.md under different chapter titles.
// No dependencies: only Node's fs/path.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'sample-ar.md');
const TARGET = join(HERE, 'long-ar.md');

const CHAPTERS = 60;
const TOTAL_WORDS = 200_000;
const WORDS_PER_CHAPTER = Math.ceil(TOTAL_WORDS / CHAPTERS);

const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

/** Body of sample-ar.md, without the YAML frontmatter. */
function readBody(markdown) {
  const lines = markdown.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }
  return lines.slice(start);
}

/** Paragraph lines only: no headings, separators, quotes, footnotes, blank lines. */
function collectParagraphs(lines) {
  return lines
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('#') &&
        !line.startsWith('>') &&
        !line.startsWith('***') &&
        !line.startsWith('---') &&
        !/^\[\^\d+\]:/.test(line),
    )
    .map((line) => line.replace(/\[\^\d+\]/g, '').trim())
    .filter((line) => countWords(line) > 0);
}

/** 60 distinct chapter titles built from two word lists (10 x 6). */
function chapterTitles() {
  const first = [
    'طَرِيقُ', 'صَوْتُ', 'بَابُ', 'مَاءُ', 'حَجَرُ',
    'لَيْلُ', 'نُورُ', 'رِيحُ', 'ظِلُّ', 'خَيْطُ',
  ];
  const second = [
    'الْبَحْرِ', 'الْمِلْحِ', 'الْجَبَلِ', 'الْمَطَرِ', 'الرَّمَادِ', 'الصَّبَاحِ',
  ];
  const titles = [];
  for (const a of first) {
    for (const b of second) titles.push(`${a} ${b}`);
  }
  return titles;
}

const source = readFileSync(SOURCE, 'utf8');
const paragraphs = collectParagraphs(readBody(source));
if (paragraphs.length === 0) {
  throw new Error(`No paragraphs found in ${SOURCE}`);
}

const titles = chapterTitles();
const out = [
  '---',
  'title: "الرِّوَايَةُ الطَّوِيلَةُ لِلِاخْتِبَارِ"',
  'author: "روايتي"',
  'lang: ar',
  'dir: rtl',
  'coverColor: "#3E4A6B"',
  '---',
  '',
];

let total = 0;
for (let chapter = 0; chapter < CHAPTERS; chapter += 1) {
  out.push(`# الْفَصْلُ ${chapter + 1}: ${titles[chapter % titles.length]}`, '');
  let words = 0;
  let cursor = chapter % paragraphs.length;
  while (words < WORDS_PER_CHAPTER) {
    const paragraph = paragraphs[cursor % paragraphs.length];
    out.push(paragraph, '');
    words += countWords(paragraph);
    total += countWords(paragraph);
    cursor += 1;
  }
}

writeFileSync(TARGET, out.join('\n'), 'utf8');
console.log(`[gen-long] wrote ${TARGET}`);
console.log(`[gen-long] chapters: ${CHAPTERS}`);
console.log(`[gen-long] words: ${total}`);
