import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodeHtmlEntitiesInUrl,
  normalizeImageUrl,
} from './article-images.ts';

test('decodeHtmlEntitiesInUrl', () => {
  assert.equal(
    decodeHtmlEntitiesInUrl(
      'https://mmbiz.qpic.cn/x?wx_fmt=jpeg&amp;tp=webp',
    ),
    'https://mmbiz.qpic.cn/x?wx_fmt=jpeg&tp=webp',
  );
});

test('normalizeImageUrl protocol relative', () => {
  assert.equal(
    normalizeImageUrl('//mmbiz.qpic.cn/a.png', 'https://mp.weixin.qq.com/s/x'),
    'https://mmbiz.qpic.cn/a.png',
  );
});

test('normalizeImageUrl resolves relative path', () => {
  assert.equal(
    normalizeImageUrl('/x/y.png', 'https://mp.weixin.qq.com/s/abc'),
    'https://mp.weixin.qq.com/x/y.png',
  );
});
