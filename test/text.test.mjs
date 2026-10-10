import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtml } from '../app/core/text.js';

test('merchant entities become plain text without recursively decoding or evaluating markup', () => {
  assert.equal(decodeHtml('A&#39;s &amp; B&#x2019;s &quot;Moon&quot;'), 'A\'s & B’s "Moon"');
  assert.equal(decodeHtml('&#x1f319;'), '🌙');
  assert.equal(decodeHtml('&amp;quot;'), '&quot;');
  assert.equal(decodeHtml('&#0; &#xD800; &#99999999; &unknown;'), '&#0; &#xD800; &#99999999; &unknown;');
  assert.equal(decodeHtml('&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>');
});
