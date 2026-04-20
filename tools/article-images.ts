/**
 * 从微信图文 HTML 中解析图片 URL，间隔下载到本地目录，并把 img 改写为相对路径，便于离线打开 HTML。
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { load, type Element } from 'cheerio';

import { sleep } from './fetch-article-urls.ts';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_FETCH_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

function randomJitter(maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

/** 解码常见 HTML 实体，便于作为合法 URL 请求 */
export function decodeHtmlEntitiesInUrl(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

export function normalizeImageUrl(raw: string, articleUrl: string): string | null {
  const s = decodeHtmlEntitiesInUrl(raw);
  if (!s || s.startsWith('data:')) return null;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  try {
    return new URL(s, articleUrl).href;
  } catch {
    return null;
  }
}

function extFromMime(ct: string | null): string {
  if (!ct) return '';
  const m = ct.split(';')[0]?.trim().toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/gif') return '.gif';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/svg+xml') return '.svg';
  if (m === 'image/bmp') return '.bmp';
  return '';
}

function extFromUrl(url: string): string {
  const u = url.split('?')[0]?.toLowerCase() ?? '';
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return '.jpg';
  if (u.endsWith('.png')) return '.png';
  if (u.endsWith('.gif')) return '.gif';
  if (u.endsWith('.webp')) return '.webp';
  if (u.endsWith('.svg')) return '.svg';
  return '';
}

export type LocalizeImagesOptions = {
  contentHtml: string;
  outDir: string;
  /** 与正文 HTML 同级的资源目录名，如 myId_assets */
  assetsDirName: string;
  /** 图文页 URL，作 Referer */
  articleUrl: string;
  /** 每张图下载前等待（首张图之前不等待） */
  imageDelayMs: number;
  imageJitterMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type LocalizeImagesResult = {
  html: string;
  imageCount: number;
  assetsDirName: string;
};

function pickImgRawSrc(el: Element): string | null {
  const attribs = el.attribs ?? {};
  const dataSrc =
    attribs['data-src'] ||
    attribs['data-original'] ||
    attribs['data-lazy-src'];
  const src = attribs['src'];
  const raw = (dataSrc || src || '').trim();
  return raw || null;
}

function extractStyleUrls(styleValue: string): string[] {
  const urls: string[] = [];
  const re = /url\((['"]?)(.*?)\1\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(styleValue)) !== null) {
    const raw = (m[2] ?? '').trim();
    if (raw) urls.push(raw);
  }
  return urls;
}

async function downloadOneImage(
  url: string,
  destPathWithoutExt: string,
  articleUrl: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const headers = {
    ...IMAGE_FETCH_HEADERS,
    referer: articleUrl,
    origin: 'https://mp.weixin.qq.com',
  };
  const res = await fetchImpl(url, { headers, signal, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} GET image`);
  }
  const len = res.headers.get('content-length');
  if (len && Number(len) > MAX_IMAGE_BYTES) {
    throw new Error(`image too large: ${len}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`image too large: ${buf.length} bytes`);
  }
  let ext = extFromUrl(url) || extFromMime(res.headers.get('content-type'));
  if (!ext) {
    const h = createHash('sha256').update(url).digest('hex').slice(0, 10);
    ext = `.bin-${h}`;
  }
  const base = basename(destPathWithoutExt);
  const dir = dirname(destPathWithoutExt);
  const fileName = `${base}${ext}`;
  await writeFile(join(dir, fileName), buf);
  return fileName;
}

/**
 * 将正文 HTML 中的远程图片下载到 `outDir/assetsDirName/`，并把 img 的 src 改为相对 `./assetsDirName/...`。
 */
export async function localizeWechatArticleImages(
  opts: LocalizeImagesOptions,
): Promise<LocalizeImagesResult> {
  const {
    contentHtml,
    outDir,
    assetsDirName,
    articleUrl,
    imageDelayMs,
    imageJitterMs,
    signal,
    fetchImpl = fetch,
  } = opts;

  const assetsAbs = join(outDir, assetsDirName);
  await mkdir(assetsAbs, { recursive: true });

  const wrapped = `<div id="__wechat_export_root__">${contentHtml}</div>`;
  const $ = load(wrapped, { decodeEntities: false });
  const $root = $('#__wechat_export_root__');

  const urlToFileName = new Map<string, string>();
  let downloadIndex = 0;
  let firstDownload = true;
  let saved = 0;

  async function ensureDownloaded(abs: string): Promise<string | null> {
    let fileName = urlToFileName.get(abs);
    if (fileName) return fileName;
    if (!firstDownload) {
      const wait = imageDelayMs + randomJitter(imageJitterMs);
      await sleep(wait, signal);
    }
    firstDownload = false;
    downloadIndex += 1;
    const baseNoExt = join(assetsAbs, `img_${String(downloadIndex).padStart(3, '0')}`);
    try {
      fileName = await downloadOneImage(abs, baseNoExt, articleUrl, fetchImpl, signal);
    } catch {
      downloadIndex -= 1;
      return null;
    }
    urlToFileName.set(abs, fileName);
    saved += 1;
    return fileName;
  }

  const imgs = $root.find('img').toArray();
  for (const el of imgs) {
    const raw = pickImgRawSrc(el);
    if (!raw) continue;
    const abs = normalizeImageUrl(raw, articleUrl);
    if (!abs) continue;
    const fileName = await ensureDownloaded(abs);
    if (!fileName) continue;
    const rel = `./${assetsDirName}/${fileName}`;
    const $img = $(el);
    $img.attr('src', rel);
    $img.removeAttr('data-src');
    $img.removeAttr('data-original');
    $img.removeAttr('data-lazy-src');
    $img.removeAttr('srcset');
  }

  const withStyle = $root.find('[style]').toArray();
  for (const el of withStyle) {
    const $el = $(el);
    const style = ($el.attr('style') ?? '').trim();
    if (!style) continue;
    const urls = extractStyleUrls(style);
    if (urls.length === 0) continue;
    let nextStyle = style;
    for (const raw of urls) {
      const abs = normalizeImageUrl(raw, articleUrl);
      if (!abs) continue;
      const fileName = await ensureDownloaded(abs);
      if (!fileName) continue;
      const rel = `./${assetsDirName}/${fileName}`;
      nextStyle = nextStyle.split(raw).join(rel);
    }
    $el.attr('style', nextStyle);
  }

  const html = $root.html() ?? '';
  return { html, imageCount: saved, assetsDirName };
}
