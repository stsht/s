import { cp, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const out = join(root, 'dist');

const files = [
  '404.html',
  '_redirects',
  '_worker.js',
  'animate.css',
  'animate.js',
  'gate.css',
  'gate.js',
  'logo-hero.png',
  'logo-hero-white.png',
  'logo.png',
  'logo.svg',
  'payment-qr.png',
];

const directories = [];

for (const file of files) {
  const target = join(out, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, file), target);
}

for (const directory of directories) {
  await cp(join(root, directory), join(out, directory), { recursive: true });
}
