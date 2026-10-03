/* Preview sizes belong on cards, never in the downloaded original or viewer.
 * Shopify supports both query parameters and older filename size suffixes.
 * Keep its version parameter so edits to the original still reach the CDN. */
export function originalImage(src) {
  try {
    const url = new URL(src.startsWith('//') ? 'https:' + src : src);
    const shopify = url.hostname === 'cdn.shopify.com' || url.hostname.endsWith('.myshopify.com')
      || /^\/cdn\/shop\/(files|products)\//.test(url.pathname);
    if (!shopify) return src;
    for (const key of ['width', 'height', 'crop', 'scale']) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(
      /_(?:\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(?:_crop_[a-z]+)?(?:@\d+x)?(?=\.(?:jpe?g|png|webp|gif)$)/i, '');
    return url.toString();
  } catch { return src; }
}
