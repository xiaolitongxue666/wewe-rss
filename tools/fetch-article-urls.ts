/**
 * 从本机 WeWe-RSS 的 JSON Feed 接口分页拉取所有文章 URL，请求间可配置间隔。
 * 仅访问本地 /feeds/*.json，不抓取 mp.weixin.qq.com 正文。
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export type FetchAllArticleUrlsOptions = {
  baseUrl: string;
  /** `'all'` 对应 `/feeds/all.json`，否则为单个订阅 id，例如 `MP_WXS_xxx` */
  feedId: string;
  pageSize?: number;
  /** 相邻两次分页请求之间的间隔（毫秒），默认 2000 */
  delayMs?: number;
  /** 最多拉取页数；不设则无上限（直到某一页条目为空或不足一页） */
  maxPages?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/** JSON Feed 1.x 中与条目链接相关的字段 */
export type JsonFeedMinimal = {
  items?: Array<{ url?: string; link?: string }>;
};

export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/** 从单页 JSON Feed 正文解析出链接列表 */
export function collectUrlsFromJsonFeed(feed: JsonFeedMinimal): string[] {
  const items = feed.items ?? [];
  const urls: string[] = [];
  for (const item of items) {
    const u =
      typeof item.url === 'string'
        ? item.url
        : typeof item.link === 'string'
          ? item.link
          : '';
    if (u) urls.push(u);
  }
  return urls;
}

export async function fetchJsonFeedPage(
  baseUrl: string,
  feedId: string,
  page: number,
  limit: number,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<JsonFeedMinimal> {
  const root = normalizeBaseUrl(baseUrl);
  const segment = feedId === 'all' ? 'all' : feedId;
  const path =
    segment === 'all'
      ? `${root}/feeds/all.json`
      : `${root}/feeds/${segment}.json`;
  const url = new URL(path);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  const fetchFn = options?.fetchImpl ?? fetch;
  const res = await fetchFn(url, {
    signal: options?.signal,
    headers: { accept: 'application/json, */*' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} GET ${url}`);
  }
  const data = (await res.json()) as JsonFeedMinimal;
  return data;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchWithRetry(
  fn: () => Promise<JsonFeedMinimal>,
  maxRetries = 3,
): Promise<JsonFeedMinimal> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e instanceof Error ? e.message : e);
      const retryable =
        /\b429\b|\b503\b|\b502\b|\b504\b|\bECONNRESET\b/i.test(msg) ||
        msg.includes('fetch failed');
      if (!retryable || attempt === maxRetries - 1) throw e;
      await sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
    }
  }
  throw lastErr;
}

/**
 * 分页请求直到某一页无条目或条目数小于 pageSize，并对 URL 去重。
 */
export async function fetchAllArticleUrls(
  opts: FetchAllArticleUrlsOptions,
): Promise<string[]> {
  const pageSize = opts.pageSize ?? 80;
  const delayMs = opts.delayMs ?? 2000;
  const maxPages = opts.maxPages;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const seen = new Set<string>();
  let page = 1;

  while (true) {
    if (maxPages != null && page > maxPages) break;

    if (page > 1) await sleep(delayMs, opts.signal);

    const feed = await fetchWithRetry(() =>
      fetchJsonFeedPage(
        opts.baseUrl,
        opts.feedId,
        page,
        pageSize,
        { signal: opts.signal, fetchImpl },
      ),
    );

    const urls = collectUrlsFromJsonFeed(feed);
    if (urls.length === 0) break;

    for (const u of urls) seen.add(u);

    if (urls.length < pageSize) break;
    page += 1;
  }

  return [...seen];
}

function parseCliArgv(argv: string[]): {
  baseUrl: string;
  feedId: string;
  delayMs: number;
  pageSize: number;
  maxPages?: number;
  json: boolean;
  help: boolean;
} {
  let baseUrl = process.env.WEWE_RSS_BASE ?? 'http://localhost:4000';
  let feedId = process.env.WEWE_FEED ?? 'all';
  let delayMs = Number(process.env.WEWE_DELAY_MS ?? 2000);
  let pageSize = Number(process.env.WEWE_PAGE_SIZE ?? 80);
  let maxPages: number | undefined;
  let json = false;
  let help = false;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--help' || a === '-h') help = true;
    else if (a === '--json') json = true;
    else if (a === '--base' && argv[i + 1]) {
      baseUrl = argv[++i];
    } else if (a === '--feed' && argv[i + 1]) {
      feedId = argv[++i];
    } else if (a === '--delay' && argv[i + 1]) {
      delayMs = Number(argv[++i]);
    } else if (a === '--limit' && argv[i + 1]) {
      pageSize = Number(argv[++i]);
    } else if (a === '--max-pages' && argv[i + 1]) {
      maxPages = Number(argv[++i]);
    }
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = 2000;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 80;

  return { baseUrl, feedId, delayMs, pageSize, maxPages, json, help };
}

function printHelp(): void {
  console.log(`
Usage: pnpm urls:export -- [options]

  从本机 WeWe-RSS JSON Feed 分页拉取全部文章 URL（mp.weixin.qq.com/s/...），
  分页请求之间默认等待 2 秒，可用 --delay 调整。

Options:
  --base <url>       服务根地址 (默认 http://localhost:4000，或环境变量 WEWE_RSS_BASE)
  --feed <id>        all 或单个订阅 id，如 MP_WXS_xxx (默认 all，或 WEWE_FEED)
  --delay <ms>       分页间隔毫秒 (默认 2000)
  --limit <n>        每页条数，即服务端 limit 参数 (默认 80)
  --max-pages <n>    最多请求页数（调试用）
  --json             输出 JSON 数组；默认每行一个 URL
  -h, --help         显示帮助

Examples:
  pnpm urls:export -- --feed MP_WXS_xxx --delay 2500 --limit 100
  pnpm urls:export -- --base http://localhost:4000 --feed all
`);
}

async function main(): Promise<void> {
  const o = parseCliArgv(process.argv);
  if (o.help) {
    printHelp();
    process.exit(0);
  }

  const urls = await fetchAllArticleUrls({
    baseUrl: o.baseUrl,
    feedId: o.feedId,
    pageSize: o.pageSize,
    delayMs: o.delayMs,
    maxPages: o.maxPages,
  });

  if (o.json) {
    console.log(JSON.stringify(urls, null, 2));
  } else {
    for (const u of urls) console.log(u);
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
