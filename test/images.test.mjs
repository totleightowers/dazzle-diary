import test from 'node:test';
import assert from 'node:assert/strict';
import { originalImage } from '../app/core/images.js';

test('Shopify originals remove preview dimensions but keep the source version', () => {
  for (const host of ['https://cdn.shopify.com', 'https://shop.myshopify.com', 'https://www.diamondartclub.com']) {
    const src = host + '/cdn/shop/files/kit_900x900_crop_center@2x.jpg?v=1758342277&width=900&height=900&crop=center&scale=2';
    assert.equal(originalImage(src), host + '/cdn/shop/files/kit.jpg?v=1758342277');
  }
  assert.equal(originalImage('//cdn.shopify.com/kit_grande.jpg?v=7'), 'https://cdn.shopify.com/kit.jpg?v=7');
  assert.equal(originalImage('https://cdn.shopify.com/kit_x900.webp'), 'https://cdn.shopify.com/kit.webp');
});

test('original image selection leaves other shops, local files and source names alone', () => {
  for (const src of ['/covers/kit-full3.jpg', '/photos/own.jpg', 'data:image/png;base64,AA==',
    'https://another-shop.com/kit_small.jpg?width=900',
    'https://cdn.shopify.com/kit-1193813836.jpg?v=1758342277'])
    assert.equal(originalImage(src), src);
});
