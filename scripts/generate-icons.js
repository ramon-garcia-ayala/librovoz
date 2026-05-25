const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'assets', 'icons');
const SVG_STD = path.join(ICONS_DIR, 'icon.svg');
const SVG_MASK = path.join(ICONS_DIR, 'icon-maskable.svg');

const SIZES = [192, 512];

async function generate() {
  const svgStd = fs.readFileSync(SVG_STD);
  const svgMask = fs.readFileSync(SVG_MASK);

  for (const size of SIZES) {
    await sharp(svgStd)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONS_DIR, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png`);

    await sharp(svgMask)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONS_DIR, `icon-${size}-maskable.png`));
    console.log(`✓ icon-${size}-maskable.png`);
  }

  await sharp(svgStd).resize(180, 180).png().toFile(path.join(ICONS_DIR, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  await sharp(svgStd).resize(32, 32).png().toFile(path.join(ICONS_DIR, 'favicon-32.png'));
  console.log('✓ favicon-32.png');
}

generate().catch(err => { console.error(err); process.exit(1); });
