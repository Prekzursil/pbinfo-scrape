import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rendererAssetsRoot = join(repoRoot, 'src', 'gui', 'renderer', 'assets');
const desktopAssetsRoot = join(repoRoot, 'assets', 'desktop');

const palette = {
  parchment: '#F2E4C6',
  parchmentSoft: '#FBF4E5',
  ink: '#182033',
  inkSoft: '#243252',
  bronze: '#B87A27',
  bronzeSoft: '#D9A25F',
  accent: '#3CA4B5',
  slate: '#44516D',
  mono: '#0F1723',
};

await main();

async function main() {
  mkdirSync(rendererAssetsRoot, {
    recursive: true,
  });
  mkdirSync(desktopAssetsRoot, {
    recursive: true,
  });

  const markSvg = buildMarkSvg();
  const monoMarkSvg = buildMonoMarkSvg();
  const logoSvg = buildLogoSvg();

  write(join(rendererAssetsRoot, 'problem-archive-crawler-mark.svg'), markSvg);
  write(
    join(rendererAssetsRoot, 'problem-archive-crawler-mark-mono.svg'),
    monoMarkSvg,
  );
  write(join(rendererAssetsRoot, 'problem-archive-crawler-logo.svg'), logoSvg);

  const basePng = await sharp(Buffer.from(markSvg))
    .resize(1024, 1024)
    .png()
    .toBuffer();
  await writeBuffer(
    join(desktopAssetsRoot, 'problem-archive-crawler-mark-512.png'),
    await sharp(basePng).resize(512, 512).png().toBuffer(),
  );
  await writeBuffer(
    join(desktopAssetsRoot, 'problem-archive-crawler-notification.png'),
    await sharp(basePng).resize(256, 256).png().toBuffer(),
  );
  await writeBuffer(
    join(desktopAssetsRoot, 'problem-archive-crawler-tray.png'),
    await sharp(basePng).resize(64, 64).png().toBuffer(),
  );

  const icoBuffer = await pngToIco([
    await sharp(basePng).resize(256, 256).png().toBuffer(),
    await sharp(basePng).resize(128, 128).png().toBuffer(),
    await sharp(basePng).resize(64, 64).png().toBuffer(),
    await sharp(basePng).resize(48, 48).png().toBuffer(),
    await sharp(basePng).resize(32, 32).png().toBuffer(),
    await sharp(basePng).resize(16, 16).png().toBuffer(),
  ]);
  await writeBuffer(
    join(desktopAssetsRoot, 'problem-archive-crawler.ico'),
    icoBuffer,
  );
}

function buildMarkSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="128" y1="96" x2="896" y2="928" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.inkSoft}"/>
      <stop offset="1" stop-color="${palette.ink}"/>
    </linearGradient>
    <linearGradient id="sheet" x1="252" y1="208" x2="784" y2="760" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.parchmentSoft}"/>
      <stop offset="1" stop-color="${palette.parchment}"/>
    </linearGradient>
    <linearGradient id="bronze" x1="286" y1="228" x2="746" y2="744" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.bronzeSoft}"/>
      <stop offset="1" stop-color="${palette.bronze}"/>
    </linearGradient>
  </defs>
  <rect x="88" y="88" width="848" height="848" rx="236" fill="url(#bg)"/>
  <rect x="220" y="186" width="428" height="516" rx="52" transform="rotate(-6 220 186)" fill="url(#sheet)" stroke="url(#bronze)" stroke-width="22"/>
  <rect x="358" y="252" width="446" height="542" rx="58" fill="url(#sheet)" stroke="url(#bronze)" stroke-width="24"/>
  <circle cx="666" cy="520" r="118" fill="none" stroke="${palette.accent}" stroke-width="22"/>
  <circle cx="666" cy="520" r="62" fill="none" stroke="${palette.bronzeSoft}" stroke-width="20"/>
  <path d="M666 360V680" stroke="${palette.accent}" stroke-width="18" stroke-linecap="round"/>
  <path d="M506 520H826" stroke="${palette.accent}" stroke-width="18" stroke-linecap="round"/>
  <path d="M446 388H594" stroke="${palette.slate}" stroke-width="20" stroke-linecap="round"/>
  <path d="M446 462H560" stroke="${palette.slate}" stroke-width="20" stroke-linecap="round"/>
  <path d="M446 598H566" stroke="${palette.slate}" stroke-width="20" stroke-linecap="round"/>
  <path d="M446 672H532" stroke="${palette.slate}" stroke-width="20" stroke-linecap="round"/>
</svg>`;
}

function buildMonoMarkSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="88" y="88" width="848" height="848" rx="236" fill="${palette.mono}"/>
  <rect x="220" y="186" width="428" height="516" rx="52" transform="rotate(-6 220 186)" fill="white" stroke="${palette.mono}" stroke-width="22"/>
  <rect x="358" y="252" width="446" height="542" rx="58" fill="white" stroke="${palette.mono}" stroke-width="24"/>
  <circle cx="666" cy="520" r="118" fill="none" stroke="${palette.mono}" stroke-width="22"/>
  <circle cx="666" cy="520" r="62" fill="none" stroke="${palette.mono}" stroke-width="20"/>
  <path d="M666 360V680" stroke="${palette.mono}" stroke-width="18" stroke-linecap="round"/>
  <path d="M506 520H826" stroke="${palette.mono}" stroke-width="18" stroke-linecap="round"/>
  <path d="M446 388H594" stroke="${palette.mono}" stroke-width="20" stroke-linecap="round"/>
  <path d="M446 462H560" stroke="${palette.mono}" stroke-width="20" stroke-linecap="round"/>
  <path d="M446 598H566" stroke="${palette.mono}" stroke-width="20" stroke-linecap="round"/>
  <path d="M446 672H532" stroke="${palette.mono}" stroke-width="20" stroke-linecap="round"/>
</svg>`;
}

function buildLogoSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1480" height="420" viewBox="0 0 1480 420" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1480" height="420" rx="48" fill="${palette.parchmentSoft}"/>
  <g transform="translate(36 30) scale(0.35)">
    ${buildMarkSvg()
      .replace('<?xml version="1.0" encoding="UTF-8"?>', '')
      .replace('<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">', '')
      .replace('</svg>', '')}
  </g>
  <text x="430" y="148" fill="${palette.bronze}" font-size="34" font-family="Manrope, Segoe UI, sans-serif" letter-spacing="6">PBINFO ARCHIVAL OPERATOR CONSOLE</text>
  <text x="430" y="228" fill="${palette.ink}" font-size="88" font-weight="800" font-family="Sora, Segoe UI, sans-serif">Problem Archive</text>
  <text x="430" y="324" fill="${palette.inkSoft}" font-size="88" font-weight="800" font-family="Sora, Segoe UI, sans-serif">Crawler</text>
</svg>`;
}

function write(path, contents) {
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, contents, 'utf8');
}

async function writeBuffer(path, contents) {
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, contents);
}
