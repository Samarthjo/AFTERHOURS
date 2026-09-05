import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../public/og-card.svg');
const destination = resolve(here, '../public/og-card.png');
const svg = readFileSync(source);
const image = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  background: '#071019',
});

writeFileSync(destination, image.render().asPng());
console.log(`Rendered ${destination}`);
