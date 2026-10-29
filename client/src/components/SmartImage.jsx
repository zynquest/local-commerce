import { useState } from 'react';
import { optimizeImage, placeholderImage } from '../services/imageService.js';
import { artColors, artFor } from '../lib/artwork.js';

/**
 * Lazy image with Cloudinary/Drive optimisation. Without a photo (or with a broken link) it shows artwork picked from
 * the item's name: kind 'product' | 'service' | 'shop' | 'appointments', hint = the store type.
 */
export default function SmartImage({ src, alt = '', width = 600, className = '', eager = false, kind = 'product', hint = '', ...rest }) {
  const [failed, setFailed] = useState(false);
  // Only product tiles carry the name under the picture; logos and service tiles are too small for it.
  const url = !src || failed ? placeholderImage(alt, artFor(alt, kind, hint), artColors(kind), kind === 'product') : optimizeImage(src, width);
  return (
    <img
      src={url}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      {...rest}
    />
  );
}
