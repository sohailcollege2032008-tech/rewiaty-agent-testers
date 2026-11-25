import { describe, expect, it } from 'vitest';
import { isSafeImageSrc, parseBook } from '../src/index.js';

function blocksOf(md: string) {
  return parseBook(`# فصل\n\n${md}\n`, 'obsidian.md').chapters[0]!.blocks;
}

function imageBlocks(md: string) {
  return blocksOf(md).filter((b) => b.kind === 'image');
}

describe('Obsidian image embeds', () => {
  it('maps a bare file name into assets/', () => {
    expect(imageBlocks('![[img.webp]]')).toEqual([
      expect.objectContaining({ kind: 'image', html: '<img src="assets/img.webp" alt="">' }),
    ]);
  });

  it('keeps a relative path as written', () => {
    expect(imageBlocks('![[images/map.png]]')[0]!.html).toBe(
      '<img src="images/map.png" alt="">',
    );
    expect(imageBlocks('![[assets/scene.jpg]]')[0]!.html).toBe(
      '<img src="assets/scene.jpg" alt="">',
    );
  });

  it('uses the pipe text as alt text', () => {
    expect(imageBlocks('![[img.webp|وصف الصورة]]')[0]!.html).toBe(
      '<img src="assets/img.webp" alt="وصف الصورة">',
    );
  });

  it('treats Obsidian size syntax as a size, not as alt text', () => {
    expect(imageBlocks('![[img.webp|300]]')[0]!.html).toBe(
      '<img src="assets/img.webp" alt="">',
    );
    expect(imageBlocks('![[img.webp|300x200]]')[0]!.html).toBe(
      '<img src="assets/img.webp" alt="">',
    );
  });

  it('picks the alt text when a size follows it', () => {
    expect(imageBlocks('![[img.webp|وصف|300]]')[0]!.html).toBe(
      '<img src="assets/img.webp" alt="وصف">',
    );
  });

  it.each([
    '![[../secret.png]]',
    '![[../../etc/secret.png]]',
    '![[/etc/passwd]]',
    '![[..\\secret.png]]',
    '![[javascript:alert(1)]]',
    '![[evil.svg]]',
    '![[page.html]]',
  ])('degrades unsafe embed %s to escaped text', (line) => {
    const blocks = blocksOf(line);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('p');
    expect(blocks[0]!.html).not.toContain('<img');
    expect(blocks[0]!.html).toContain('![[');
    // Only entities produced by escaping may appear; no live tag survives.
    expect(blocks[0]!.html).not.toMatch(/<(?!\/?(?:em|strong|br|sup|a)\b)/);
  });

  it('does not eat a normal Markdown image line', () => {
    expect(imageBlocks('![alt](assets/a.png)')[0]!.html).toBe(
      '<img src="assets/a.png" alt="alt">',
    );
  });

  it('keeps a prose line that merely contains an embed as prose', () => {
    const blocks = blocksOf('كان ينظر إلى ![[img.webp]] بحسرة');
    expect(blocks.every((b) => b.kind === 'p')).toBe(true);
  });
});

describe('isSafeImageSrc — traversal hardening', () => {
  it.each([
    '../secret.png',
    'assets/../../secret.png',
    '..\\secret.png',
    '/etc/passwd',
    '//evil.example/x.png',
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'file:///etc/passwd',
    'blob:https://x/y',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'assets/evil.svg',
    '%2e%2e/secret.png',
  ])('rejects %s', (src) => {
    expect(isSafeImageSrc(src)).toBe(false);
  });

  it.each([
    'assets/ch01.webp',
    'images/map.png',
    'https://example.com/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('accepts %s', (src) => {
    expect(isSafeImageSrc(src)).toBe(true);
  });
});
