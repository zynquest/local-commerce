// Backfills the JPEG twin (used for og:image link previews) next to every uploaded WebP that lacks one.
//   npm run images:share-jpegs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';

let made = 0;
let failed = 0;
const stores = await fs.readdir(config.uploadDir, { withFileTypes: true }).catch(() => []);
for (const dir of stores.filter((d) => d.isDirectory())) {
  const folder = path.join(config.uploadDir, dir.name);
  const files = new Set(await fs.readdir(folder));
  for (const file of files) {
    if (!file.endsWith('.webp') || files.has(file.replace(/\.webp$/, '.jpg'))) continue;
    try {
      const jpg = await sharp(path.join(folder, file)).flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      await fs.writeFile(path.join(folder, file.replace(/\.webp$/, '.jpg')), jpg);
      made++;
    } catch (err) {
      failed++;
      console.error(`  ${dir.name}/${file}: ${err.message}`);
    }
  }
}
console.log(`[images] created ${made} JPEG preview image(s)${failed ? `, ${failed} failed` : ''} in ${config.uploadDir}`);
