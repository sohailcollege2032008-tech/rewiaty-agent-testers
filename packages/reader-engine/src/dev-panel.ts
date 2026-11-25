import { parseBook, parseTxt, type Book } from '@rewiaty/book-format';
import { DEFAULT_SETTINGS, type ReaderSettings, type TocEntry, type WebToRNMessage } from './types.js';

declare const __BUILTIN_SAMPLE_AR__: string;
declare const __BUILTIN_SAMPLE_EN__: string;

const iframe = document.getElementById('reader-frame') as HTMLIFrameElement;
const statusEl = document.getElementById('status-text') as HTMLElement;
const tocSelect = document.getElementById('toc-select') as HTMLSelectElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;

const controls = {
  sampleArBtn: document.getElementById('load-ar') as HTMLButtonElement,
  sampleEnBtn: document.getElementById('load-en') as HTMLButtonElement,
  prevBtn: document.getElementById('btn-prev') as HTMLButtonElement,
  nextBtn: document.getElementById('btn-next') as HTMLButtonElement,
  fontFamily: document.getElementById('setting-font') as HTMLSelectElement,
  fontSize: document.getElementById('setting-size') as HTMLInputElement,
  fontSizeVal: document.getElementById('val-size') as HTMLElement,
  lineHeight: document.getElementById('setting-lh') as HTMLInputElement,
  lineHeightVal: document.getElementById('val-lh') as HTMLElement,
  wordSpacing: document.getElementById('setting-ws') as HTMLInputElement,
  wordSpacingVal: document.getElementById('val-ws') as HTMLElement,
  paragraphSpacing: document.getElementById('setting-ps') as HTMLInputElement,
  paragraphSpacingVal: document.getElementById('val-ps') as HTMLElement,
  marginHorizontal: document.getElementById('setting-mh') as HTMLInputElement,
  marginHorizontalVal: document.getElementById('val-mh') as HTMLElement,
  fontWeight: document.getElementById('setting-weight') as HTMLSelectElement,
  textAlign: document.getElementById('setting-align') as HTMLSelectElement,
  indentMode: document.getElementById('setting-indent') as HTMLSelectElement,
  spread: document.getElementById('setting-spread') as HTMLSelectElement,
  theme: document.getElementById('setting-theme') as HTMLSelectElement,
  disableAnimation: document.getElementById('setting-noanim') as HTMLInputElement,
};

let currentBook: Book = parseBook(__BUILTIN_SAMPLE_AR__, 'sample-ar.md');
let currentSettings: ReaderSettings = { ...DEFAULT_SETTINGS };
let frameReady = false;

function sendToReader(msg: unknown): void {
  iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
}

function syncControlsFromSettings(): void {
  controls.fontFamily.value = currentSettings.fontFamily;
  controls.fontSize.value = String(currentSettings.fontSize);
  controls.fontSizeVal.textContent = `${currentSettings.fontSize}px`;
  controls.lineHeight.value = String(currentSettings.lineHeight);
  controls.lineHeightVal.textContent = currentSettings.lineHeight.toFixed(2);
  controls.wordSpacing.value = String(currentSettings.wordSpacing);
  controls.wordSpacingVal.textContent = `${currentSettings.wordSpacing}px`;
  controls.paragraphSpacing.value = String(currentSettings.paragraphSpacing);
  controls.paragraphSpacingVal.textContent = `${currentSettings.paragraphSpacing}px`;
  controls.marginHorizontal.value = String(currentSettings.marginHorizontal);
  controls.marginHorizontalVal.textContent = `${currentSettings.marginHorizontal}px`;
  controls.fontWeight.value = String(currentSettings.fontWeight);
  controls.textAlign.value = currentSettings.textAlign;
  controls.indentMode.value = currentSettings.indentMode;
  controls.spread.value = currentSettings.spread ?? 'auto';
  controls.theme.value = currentSettings.theme;
  controls.disableAnimation.checked = currentSettings.disableAnimation;
}

function loadBookIntoReader(book: Book): void {
  currentBook = book;
  if (book.meta.dir === 'ltr') {
    currentSettings = {
      ...currentSettings,
      fontFamily: 'Literata',
      lineHeight: 1.7,
    };
  } else {
    currentSettings = {
      ...currentSettings,
      fontFamily: DEFAULT_SETTINGS.fontFamily,
      lineHeight: 1.95,
    };
  }
  syncControlsFromSettings();
  sendToReader({ type: 'load', book: currentBook, settings: currentSettings });
}

function updateSetting(partial: Partial<ReaderSettings>): void {
  currentSettings = { ...currentSettings, ...partial };
  syncControlsFromSettings();
  sendToReader({ type: 'settings', partial });
}

function populateToc(chapters: TocEntry[]): void {
  const prevVal = tocSelect.value;
  tocSelect.innerHTML = '';
  for (const ch of chapters) {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `${ch.title} (${ch.pageCount}p)`;
    tocSelect.appendChild(opt);
  }
  if (prevVal && chapters.some((c) => c.id === prevVal)) {
    tocSelect.value = prevVal;
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) return;
  if (typeof event.data !== 'string') return;
  let msg: WebToRNMessage;
  try {
    msg = JSON.parse(event.data) as WebToRNMessage;
  } catch {
    return;
  }

  if (msg.type === 'position') {
    tocSelect.value = msg.chapterId;
    const pct = Math.round(msg.bookProgress * 100);
    statusEl.textContent = `Chapter ${msg.chapterId} · Ch Page ${msg.chapterPage}/${msg.chapterPageCount} · Book ${msg.page}/${msg.pageCount} (${pct}%) · ${msg.spread ? 'spread' : 'single'} · Anchor: ${msg.anchor.blockId}:${msg.anchor.charOffset}`;
  } else if (msg.type === 'toc') {
    populateToc(msg.chapters);
  } else if (msg.type === 'tap') {
    statusEl.dataset.lastTap = msg.zone;
  } else if (msg.type === 'error') {
    statusEl.textContent = `Error: ${msg.message}`;
  }
});

iframe.addEventListener('load', () => {
  frameReady = true;
  loadBookIntoReader(currentBook);
});

controls.sampleArBtn.addEventListener('click', () => {
  if (!frameReady) return;
  loadBookIntoReader(parseBook(__BUILTIN_SAMPLE_AR__, 'sample-ar.md'));
});

controls.sampleEnBtn.addEventListener('click', () => {
  if (!frameReady) return;
  loadBookIntoReader(parseBook(__BUILTIN_SAMPLE_EN__, 'sample-en.md'));
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const book = file.name.toLowerCase().endsWith('.txt')
    ? parseTxt(text, file.name)
    : parseBook(text, file.name);
  loadBookIntoReader(book);
});

controls.prevBtn.addEventListener('click', () => sendToReader({ type: 'prev' }));
controls.nextBtn.addEventListener('click', () => sendToReader({ type: 'next' }));

tocSelect.addEventListener('change', () => {
  sendToReader({ type: 'goto', chapterId: tocSelect.value });
});

controls.fontFamily.addEventListener('change', () => updateSetting({ fontFamily: controls.fontFamily.value }));
controls.fontSize.addEventListener('input', () => updateSetting({ fontSize: Number(controls.fontSize.value) }));
controls.lineHeight.addEventListener('input', () => updateSetting({ lineHeight: Number(controls.lineHeight.value) }));
controls.wordSpacing.addEventListener('input', () => updateSetting({ wordSpacing: Number(controls.wordSpacing.value) }));
controls.paragraphSpacing.addEventListener('input', () => updateSetting({ paragraphSpacing: Number(controls.paragraphSpacing.value) }));
controls.marginHorizontal.addEventListener('input', () => updateSetting({ marginHorizontal: Number(controls.marginHorizontal.value) }));
controls.fontWeight.addEventListener('change', () => updateSetting({ fontWeight: Number(controls.fontWeight.value) }));
controls.textAlign.addEventListener('change', () =>
  updateSetting({ textAlign: controls.textAlign.value as ReaderSettings['textAlign'] }),
);
controls.indentMode.addEventListener('change', () =>
  updateSetting({ indentMode: controls.indentMode.value as ReaderSettings['indentMode'] }),
);
controls.spread.addEventListener('change', () =>
  updateSetting({ spread: controls.spread.value === 'single' ? 'single' : 'auto' }),
);
controls.theme.addEventListener('change', () =>
  updateSetting({ theme: controls.theme.value as ReaderSettings['theme'] }),
);
controls.disableAnimation.addEventListener('change', () =>
  updateSetting({ disableAnimation: controls.disableAnimation.checked }),
);

syncControlsFromSettings();
