import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectUrlsFromJsonFeed,
  normalizeBaseUrl,
} from './fetch-article-urls.ts';

test('normalizeBaseUrl trims trailing slashes', () => {
  assert.equal(normalizeBaseUrl('http://localhost:4000/'), 'http://localhost:4000');
});

test('collectUrlsFromJsonFeed reads url and link', () => {
  assert.deepEqual(
    collectUrlsFromJsonFeed({
      items: [
        { url: 'https://mp.weixin.qq.com/s/a' },
        { link: 'https://mp.weixin.qq.com/s/b' },
      ],
    }),
    ['https://mp.weixin.qq.com/s/a', 'https://mp.weixin.qq.com/s/b'],
  );
});

test('collectUrlsFromJsonFeed skips empty', () => {
  assert.deepEqual(
    collectUrlsFromJsonFeed({ items: [{}, { url: '' }] }),
    [],
  );
});
