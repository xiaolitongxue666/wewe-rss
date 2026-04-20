import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractContentFromFeedItem,
  extractWeixinArticleId,
} from './fetch-article-contents.ts';

test('extractWeixinArticleId', () => {
  assert.equal(
    extractWeixinArticleId('https://mp.weixin.qq.com/s/AbCdEfGh'),
    'AbCdEfGh',
  );
  assert.equal(extractWeixinArticleId('https://example.com/x'), null);
});

test('extractContentFromFeedItem prefers content_html', () => {
  const { contentHtml, contentText } = extractContentFromFeedItem({
    content_html: '<p>Hi <b>there</b></p>',
  });
  assert.equal(contentHtml, '<p>Hi <b>there</b></p>');
  assert.ok(contentText.includes('Hi'));
  assert.ok(contentText.includes('there'));
});
