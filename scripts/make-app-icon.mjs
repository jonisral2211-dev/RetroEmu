// Genera assets/AppIcon.appiconset/ desde assets/app-icon.svg.
// Requiere sharp (no se guarda en package.json): npm install --no-save sharp
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = process.env.RETROEMU_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets', 'app-icon.svg'));
const outDir = join(root, 'assets', 'AppIcon.appiconset');

// [nombre, tamaño en px, idiom, escala, tamaño en puntos]
const variants = [
  ['icon-20@2x.png', 40, 'iphone', '2x', '20x20'],
  ['icon-20@3x.png', 60, 'iphone', '3x', '20x20'],
  ['icon-29@2x.png', 58, 'iphone', '2x', '29x29'],
  ['icon-29@3x.png', 87, 'iphone', '3x', '29x29'],
  ['icon-40@2x.png', 80, 'iphone', '2x', '40x40'],
  ['icon-40@3x.png', 120, 'iphone', '3x', '40x40'],
  ['icon-60@2x.png', 120, 'iphone', '2x', '60x60'],
  ['icon-60@3x.png', 180, 'iphone', '3x', '60x60'],
  ['icon-1024.png', 1024, 'ios-marketing', '1x', '1024x1024'],
];

for (const [file, px] of variants) {
  await sharp(svg, { density: 300 }).resize(px, px).flatten({ background: '#0D0E12' }).png().toFile(join(outDir, file));
}

const images = variants.map(([file, , idiom, scale, size]) => ({
  filename: file, idiom, scale, size,
}));
writeFileSync(join(outDir, 'Contents.json'), JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2) + '\n');
console.log(`AppIcon generado en ${outDir}`);
