import { useState } from 'react';
import { optimizeImage, placeholderImage } from '../services/imageService.js';

/** Lazy image with Cloudinary/Drive optimisation and a branded fallback for broken links. */
export default function SmartImage({ src, alt = '', width = 600, className = '', eager = false, ...rest }) {
  const [failed, setFailed] = useState(false);
  const url = !src || failed ? placeholderImage(alt) : optimizeImage(src, width);
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
