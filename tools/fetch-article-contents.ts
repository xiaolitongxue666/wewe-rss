/**
 * 通过本机 WeWe-RSS JSON Feed（mode=fulltext、limit=1）按页拉取正文并落盘；
 * 两次请求之间长间隔 + 抖动，降低风控压力。每篇 JSON 必含 url。
 */

import { appendFile, access, mkdir, writeFile } from 'node:fs/promises';
import { constants as FsConstants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import {
  fetchJsonFeedPage,
  normalizeBaseUrl,
  sleep,
} from './fetch-article-urls.ts';

type JsonFeedItem = Record<string, unknown>;

type JsonFeedWithItems = { items?: JsonFeedItem[] };

function randomJitter(maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

/** 从 mp.weixin.qq.com/s/{id} 取 id */
export function extractWeixinArticleId(articleUrl: string): string | null {
  const m = articleUrl.match(/mp\.weixin\.qq\.com\/s\/([^/?#]+)/);
  return m?.[1] ?? null;
}

function sanitizeFileId(raw: string): string {
  return raw.replace(/[^\w.-]+/g, '_').slice(0, 200) || 'article';
}

/** 从 JSON Feed 单条目中尽量取出 HTML / 纯文本正文 */
export function extractContentFromFeedItem(item: JsonFeedItem): {
  contentHtml: string;
  contentText: string;
} {
  let html = '';

  if (typeof item.content_html === 'string') html = item.content_html;
  else if (typeof item.contentHtml === 'string') html = item.contentHtml;
  else if (typeof item.content_text === 'string') html = item.content_text;
  else if (typeof item.contentText === 'string') html = item.contentText;
  else if (typeof item.content === 'string') html = item.content;
  else if (item.content && typeof item.content === 'object') {
    const c = item.content as Record<string, unknown>;
    if (typeof c.html === 'string') html = c.html;
    else if (typeof c.value === 'string') html = c.value;
  }

  const contentText = htmlToPlainText(html);
  return { contentHtml: html, contentText };
}

function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemUrl(item: JsonFeedItem): string {
  const u = item.url ?? item.link;
  return typeof u === 'string' ? u : '';
}

function itemTitle(item: JsonFeedItem): string | undefined {
  const t = item.title;
  return typeof t === 'string' ? t : undefined;
}

function escapeHtmlMinimal(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PREVIEW_CHARS = 800;

function previewText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, FsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fetchPageWithRetry(
  baseUrl: string,
  feedId: string,
  page: number,
  maxRetries: number,
): Promise<JsonFeedWithItems> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const feed = (await fetchJsonFeedPage(baseUrl, feedId, page, 1, {
        mode: 'fulltext',
      })) as JsonFeedWithItems;
      return feed;
    } catch (e) {
      lastErr = e;
      const msg = String(e instanceof Error ? e.message : e);
      const retryable =
        /\b429\b|\b503\b|\b502\b|\b504\b|\bECONNRESET\b/i.test(msg) ||
        msg.includes('fetch failed');
      if (!retryable || attempt === maxRetries - 1) throw e;
      await sleep(Math.min(1000 * Math.pow(2, attempt), 15000));
    }
  }
  throw lastErr;
}

export type ExportArticleContentsCli = {
  baseUrl: string;
  feedId: string;
  outDir: string;
  delayMs: number;
  jitterMs: number;
  startPage: number;
  maxPages?: number;
  resume: boolean;
  continueOnError: boolean;
  /** 为 true 时仍写入单个大 JSON（含 contentHtml），默认 false 为拆分：小 JSON + .html + .txt */
  bundle: boolean;
  help: boolean;
};

export function parseArticleContentsArgv(argv: string[]): ExportArticleContentsCli {
  let baseUrl = process.env.WEWE_RSS_BASE ?? 'http://localhost:4000';
  let feedId = process.env.WEWE_FEED ?? 'all';
  let outDir = process.env.WEWE_ARTICLES_OUT ?? 'exports/articles';
  let delayMs = Number(process.env.WEWE_ARTICLE_DELAY_MS ?? 45000);
  let jitterMs = Number(process.env.WEWE_ARTICLE_JITTER_MS ?? 10000);
  let startPage = Number(process.env.WEWE_START_PAGE ?? 1);
  let maxPages: number | undefined;
  let resume = false;
  let continueOnError = false;
  let bundle = false;
  let help = false;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--help' || a === '-h') help = true;
    else if (a === '--resume') resume = true;
    else if (a === '--bundle') bundle = true;
    else if (a === '--continue-on-error') continueOnError = true;
    else if (a === '--base' && argv[i + 1]) baseUrl = argv[++i];
    else if (a === '--feed' && argv[i + 1]) feedId = argv[++i];
    else if (a === '--out-dir' && argv[i + 1]) outDir = argv[++i];
    else if (a === '--delay-ms' && argv[i + 1]) delayMs = Number(argv[++i]);
    else if (a === '--jitter-ms' && argv[i + 1]) jitterMs = Number(argv[++i]);
    else if (a === '--start-page' && argv[i + 1]) startPage = Number(argv[++i]);
    else if (a === '--max-pages' && argv[i + 1]) maxPages = Number(argv[++i]);
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = 45000;
  if (!Number.isFinite(jitterMs) || jitterMs < 0) jitterMs = 10000;
  if (!Number.isFinite(startPage) || startPage < 1) startPage = 1;

  return {
    baseUrl,
    feedId,
    outDir,
    delayMs,
    jitterMs,
    startPage,
    maxPages,
    resume,
    continueOnError,
    bundle,
    help,
  };
}

function printHelp(): void {
  console.log(`
Usage: pnpm articles:export -- [options]

  通过本机 WeWe-RSS 的 JSON Feed（mode=fulltext、limit=1）逐页拉取正文；
  服务端再请求 mp.weixin.qq.com。两次请求之间默认约 45s + 随机抖动。

Options:
  --base <url>           服务根 (默认 http://localhost:4000)
  --feed <id>            all 或 MP_WXS_xxx
  --out-dir <path>       输出目录 (默认 exports/articles)
  --delay-ms <n>         相邻两次请求间隔毫秒 (默认 45000)
  --jitter-ms <n>        每次额外随机 0..n 毫秒 (默认 10000)
  --start-page <n>       从第几页开始 (默认 1)
  --max-pages <n>        最多拉取页数（调试用）
  --resume               若 {id}.json 已存在则跳过该篇
  --continue-on-error    单页失败后写 errors.log 并继续
  --bundle               单文件 JSON 内含完整 HTML（体积大、难读）；默认拆分输出
  -h, --help

  默认每篇生成：{id}.json（元数据 + 纯文本正文）+ {id}.html（原始 HTML）+ {id}.txt（同纯文本便于阅读）

Example:
  pnpm articles:export -- --feed MP_WXS_xxx --out-dir exports/huitianyi --delay-ms 60000
`);
}

async function logError(outDir: string, line: string): Promise<void> {
  const p = join(outDir, 'errors.log');
  await appendFile(p, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

async function main(): Promise<void> {
  const o = parseArticleContentsArgv(process.argv);
  if (o.help) {
    printHelp();
    process.exit(0);
  }

  normalizeBaseUrl(o.baseUrl);
  await mkdir(o.outDir, { recursive: true });

  let page = o.startPage;
  let pagesDone = 0;

  while (true) {
    if (o.maxPages != null && pagesDone >= o.maxPages) break;

    if (page > o.startPage || pagesDone > 0) {
      const wait = o.delayMs + randomJitter(o.jitterMs);
      console.error(`[articles:export] sleep ${wait}ms before page ${page}`);
      await sleep(wait);
    }

    let feed: JsonFeedWithItems;
    try {
      feed = await fetchPageWithRetry(o.baseUrl, o.feedId, page, 3);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logError(o.outDir, `page=${page} fetch_failed ${msg}`);
      if (o.continueOnError) {
        page += 1;
        pagesDone += 1;
        continue;
      }
      throw e;
    }

    const items = feed.items ?? [];
    if (items.length === 0) {
      console.error(`[articles:export] empty page ${page}, stop.`);
      break;
    }

    const item = items[0]!;
    const url = itemUrl(item);
    if (!url) {
      await logError(o.outDir, `page=${page} missing_item_url`);
      if (!o.continueOnError) {
        throw new Error(`page ${page}: item has no url`);
      }
      page += 1;
      pagesDone += 1;
      continue;
    }

    const wxId = extractWeixinArticleId(url) ?? (typeof item.id === 'string' ? item.id : null);
    const fileId = sanitizeFileId(wxId ?? `page-${page}`);
    const outPath = join(o.outDir, `${fileId}.json`);

    if (o.resume && (await fileExists(outPath))) {
      console.error(`[articles:export] skip existing ${outPath}`);
      page += 1;
      pagesDone += 1;
      continue;
    }

    const { contentHtml, contentText } = extractContentFromFeedItem(item);
    const title = itemTitle(item);
    const base = join(o.outDir, fileId);
    const htmlPath = `${base}.html`;
    const txtPath = `${base}.txt`;

    if (o.bundle) {
      const payload = {
        url,
        title: title ?? null,
        contentHtml,
        contentText,
        fetchedAt: new Date().toISOString(),
        feedPage: page,
      };
      await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
      console.error(`[articles:export] wrote ${outPath} (bundle)`);
    } else {
      if (contentHtml) {
        await writeFile(
          htmlPath,
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtmlMinimal(title ?? fileId)}</title></head><body>\n<!-- source: ${url} -->\n${contentHtml}\n</body></html>\n`,
          'utf8',
        );
      }
      await writeFile(txtPath, `${url}\n\n${title ? `${title}\n\n` : ''}${contentText}\n`, 'utf8');

      const payload = {
        url,
        title: title ?? null,
        fetchedAt: new Date().toISOString(),
        feedPage: page,
        contentPreview: previewText(contentText, PREVIEW_CHARS),
        contentHtmlFile: contentHtml ? `${fileId}.html` : null,
        contentTextFile: `${fileId}.txt`,
      };
      await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
      console.error(
        `[articles:export] wrote ${outPath} + ${contentHtml ? `${fileId}.html ` : ''}${fileId}.txt`,
      );
    }

    page += 1;
    pagesDone += 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === resolve(thisFile);

if (invokedAsCli) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
