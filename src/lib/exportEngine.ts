import type { SpriteAnimation } from '@/lib/types';
import {
  assembleGridSheet,
  assembleStripSheet,
  canvasToBlob,
  downloadFile,
  downloadAsZip,
  resizeFrame,
  sanitizeFilename,
} from '@/lib/downloadUtils';
import {
  buildGodotAnimationEntries,
  buildUnityAnimationClip,
  buildUnitySpriteMeta,
  createUnityGuid,
  type ExportAnimationMeta,
} from '@/lib/exportSerializers';
import { loadImage } from '@/lib/spriteUtils';
import { PARTS, type Outfit, type PartCategory } from '@/lib/parts/catalog';

export interface ExportOptions {
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;
  frameWidth: number;
  frameHeight: number;
  padding: number;
  powerOfTwo: boolean;
  resizeWidth?: number;
  resizeHeight?: number;
  includeMetadata: boolean;
  sheetName: string;
}

// ─── Helpers ───

async function loadFrameCanvases(
  frames: SpriteAnimation['frames'],
  frameDataUrls: Map<string, string>,
  resizeW?: number,
  resizeH?: number
): Promise<HTMLCanvasElement[]> {
  const canvases: HTMLCanvasElement[] = [];
  for (const frame of frames) {
    const url = frameDataUrls.get(frame.id);
    if (!url) continue;
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    if (resizeW && resizeH && (resizeW !== canvas.width || resizeH !== canvas.height)) {
      canvases.push(resizeFrame(canvas, resizeW, resizeH));
    } else {
      canvases.push(canvas);
    }
  }
  return canvases;
}

function optimalColumns(totalFrames: number): number {
  // Try to make roughly square sheets
  const sqrt = Math.ceil(Math.sqrt(totalFrames));
  return Math.min(sqrt, totalFrames);
}

// ─── TexturePacker JSON Hash ───

export async function exportTexturePacker(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, includeMetadata, sheetName } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  // Collect all frames across animations
  const allFrames: { anim: SpriteAnimation; frameIdx: number; canvas: HTMLCanvasElement; name: string }[] = [];

  for (const anim of animations) {
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    for (let i = 0; i < canvases.length; i++) {
      const name = `${sanitizeFilename(anim.name)}_${i}`;
      allFrames.push({ anim, frameIdx: i, canvas: canvases[i], name });
    }
  }

  if (allFrames.length === 0) return;

  const columns = optimalColumns(allFrames.length);
  const sheet = assembleGridSheet(
    allFrames.map((f) => f.canvas),
    columns,
    padding,
    powerOfTwo
  );

  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const jsonFilename = `${sanitizeFilename(sheetName)}.json`;

  // Build JSON Hash
  const framesObj: Record<string, unknown> = {};
  for (let i = 0; i < allFrames.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);

    framesObj[`${allFrames[i].name}.png`] = {
      frame: { x, y, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
    };
  }

  // Build frameTags
  const frameTags: unknown[] = [];
  let frameOffset = 0;
  for (const anim of animations) {
    const count = anim.frames.length;
    if (count === 0) continue;
    frameTags.push({
      name: anim.name,
      from: frameOffset,
      to: frameOffset + count - 1,
      direction: 'forward',
    });
    frameOffset += count;
  }

  const meta = {
    app: 'SpriteBrew',
    version: '1.0',
    image: pngFilename,
    format: 'RGBA8888',
    size: { w: sheet.width, h: sheet.height },
    scale: '1',
    frameTags,
  };

  const jsonData = JSON.stringify({ frames: framesObj, meta }, null, 2);
  const pngBlob = await canvasToBlob(sheet);

  if (includeMetadata) {
    await downloadAsZip(
      [
        { name: pngFilename, data: pngBlob },
        { name: jsonFilename, data: jsonData },
      ],
      `spritebrew_export_texturepacker.zip`
    );
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

// ─── Aseprite JSON ───

export async function exportAseprite(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, includeMetadata, sheetName } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const allFrames: { anim: SpriteAnimation; frameIdx: number; canvas: HTMLCanvasElement; name: string }[] = [];

  for (const anim of animations) {
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    for (let i = 0; i < canvases.length; i++) {
      const name = `${sanitizeFilename(anim.name)}_${i}`;
      allFrames.push({ anim, frameIdx: i, canvas: canvases[i], name });
    }
  }

  if (allFrames.length === 0) return;

  const columns = optimalColumns(allFrames.length);
  const sheet = assembleGridSheet(
    allFrames.map((f) => f.canvas),
    columns,
    padding,
    powerOfTwo
  );

  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const jsonFilename = `${sanitizeFilename(sheetName)}.json`;

  // Build Aseprite frames array
  const framesArr = allFrames.map((f, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);
    const duration = Math.round(1000 / f.anim.fps);

    return {
      filename: `${f.name}.png`,
      frame: { x, y, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
      duration,
    };
  });

  // Build frameTags
  const frameTags: unknown[] = [];
  const tagColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#88ff00'];
  let frameOffset = 0;
  animations.forEach((anim, idx) => {
    const count = anim.frames.length;
    if (count === 0) return;
    frameTags.push({
      name: anim.name,
      from: frameOffset,
      to: frameOffset + count - 1,
      direction: 'forward',
      color: tagColors[idx % tagColors.length],
    });
    frameOffset += count;
  });

  const meta = {
    app: 'SpriteBrew',
    version: '1.0',
    image: pngFilename,
    format: 'RGBA8888',
    size: { w: sheet.width, h: sheet.height },
    scale: '1',
    frameTags,
    layers: [{ name: 'Layer 1', opacity: 255, blendMode: 'normal' }],
  };

  const jsonData = JSON.stringify({ frames: framesArr, meta }, null, 2);
  const pngBlob = await canvasToBlob(sheet);

  if (includeMetadata) {
    await downloadAsZip(
      [
        { name: pngFilename, data: pngBlob },
        { name: jsonFilename, data: jsonData },
      ],
      `spritebrew_export_aseprite.zip`
    );
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

// ─── GameMaker Strip ───

export async function exportGameMaker(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const files: { name: string; data: Blob }[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const strip = assembleStripSheet(canvases);
    const blob = await canvasToBlob(strip);
    const name = `${sanitizeFilename(anim.name)}_strip${canvases.length}.png`;
    files.push({ name, data: blob });
  }

  if (files.length === 0) return;

  if (files.length === 1) {
    downloadFile(files[0].data, files[0].name);
  } else {
    await downloadAsZip(files, 'spritebrew_export_gamemaker.zip');
  }
}

// ─── RPG Maker MV/MZ ───

export interface RPGMakerOptions extends ExportOptions {
  rpgFrameWidth: number;
  rpgFrameHeight: number;
  /** Maps row index (0-3) to animation ID. Rows: 0=Down,1=Left,2=Right,3=Up */
  directionMap: (string | null)[];
}

export async function exportRPGMaker(opts: RPGMakerOptions): Promise<{ warnings: string[] }> {
  const { animations, frameDataUrls, rpgFrameWidth, rpgFrameHeight, directionMap, sheetName } = opts;
  const warnings: string[] = [];

  const COLS = 3;
  const ROWS = 4;

  const canvas = document.createElement('canvas');
  canvas.width = rpgFrameWidth * COLS;
  canvas.height = rpgFrameHeight * ROWS;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let row = 0; row < ROWS; row++) {
    const animId = directionMap[row];
    const anim = animId ? animations.find((a) => a.id === animId) : null;

    if (!anim || anim.frames.length === 0) {
      // Leave row blank
      continue;
    }

    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, rpgFrameWidth, rpgFrameHeight);

    if (canvases.length > COLS) {
      warnings.push(`"${anim.name}" has ${canvases.length} frames but RPG Maker uses 3 per direction. Extra frames ignored.`);
    }

    for (let col = 0; col < COLS; col++) {
      // Repeat/pad frames to fill 3 columns
      const frameCanvas = canvases[col % canvases.length];
      ctx.drawImage(frameCanvas, col * rpgFrameWidth, row * rpgFrameHeight);
    }
  }

  const filename = `$${sanitizeFilename(sheetName)}.png`;
  const blob = await canvasToBlob(canvas);
  downloadFile(blob, filename);

  return { warnings };
}

// ─── Godot SpriteFrames (.tres) ───

export async function exportGodot(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, includeMetadata, sheetName } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  // Build combined sheet
  const allCanvases: HTMLCanvasElement[] = [];
  const animMeta: ExportAnimationMeta[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    animMeta.push({ name: anim.name, startIdx: allCanvases.length, count: canvases.length, fps: anim.fps, loop: anim.loop });
    allCanvases.push(...canvases);
  }

  if (allCanvases.length === 0) return;

  const columns = optimalColumns(allCanvases.length);
  const sheet = assembleGridSheet(allCanvases, columns, padding, powerOfTwo);

  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const tresFilename = `${sanitizeFilename(sheetName)}.tres`;

  // Build atlas sub-resources
  const subResources: string[] = [];
  for (let i = 0; i < allCanvases.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);
    subResources.push(
      `[sub_resource type="AtlasTexture" id="atlas_${i}"]\natlas = ExtResource("1")\nregion = Rect2(${x}, ${y}, ${fw}, ${fh})`
    );
  }

  // Build animation entries in Godot resource format
  const animEntries = buildGodotAnimationEntries(
    animMeta,
    (frameIndex) => `SubResource("atlas_${frameIndex}")`,
  );

  const tres = `[gd_resource type="SpriteFrames" load_steps=${allCanvases.length + 2} format=3]

[ext_resource type="Texture2D" path="res://${pngFilename}" id="1"]

${subResources.join('\n\n')}

[resource]
animations = [${animEntries}]
`;

  const pngBlob = await canvasToBlob(sheet);

  if (includeMetadata) {
    await downloadAsZip(
      [
        { name: pngFilename, data: pngBlob },
        { name: tresFilename, data: tres },
      ],
      'spritebrew_export_godot.zip'
    );
  } else {
    downloadFile(pngBlob, pngFilename);
  }
}

// ─── Unity AnimationClip (.anim) + Atlas Metadata ───

export async function exportUnityAnim(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, padding, powerOfTwo, sheetName } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const allCanvases: HTMLCanvasElement[] = [];
  const animMeta: ExportAnimationMeta[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    animMeta.push({ name: anim.name, startIdx: allCanvases.length, count: canvases.length, fps: anim.fps, loop: anim.loop });
    allCanvases.push(...canvases);
  }

  if (allCanvases.length === 0) return;

  const columns = optimalColumns(allCanvases.length);
  const sheet = assembleGridSheet(allCanvases, columns, padding, powerOfTwo);
  const pngFilename = `${sanitizeFilename(sheetName)}.png`;
  const frameAssets = await Promise.all(allCanvases.map(async (canvas, index) => {
    const name = `${sanitizeFilename(sheetName)}_${index}.png`;
    const guid = createUnityGuid(`${sanitizeFilename(sheetName)}:${index}`);
    return {
      name,
      guid,
      data: await canvasToBlob(canvas),
    };
  }));

  // Build Unity .anim YAML for each animation
  const animFiles: { name: string; data: string }[] = [];
  for (const am of animMeta) {
    const frameGuids = Array.from(
      { length: am.count },
      (_, index) => frameAssets[am.startIdx + index].guid,
    );
    animFiles.push({
      name: `${sanitizeFilename(am.name)}.anim`,
      data: buildUnityAnimationClip({
        clipName: am.name,
        fps: am.fps,
        loop: am.loop,
        frameGuids,
      }),
    });
  }

  // Build sprite atlas metadata JSON (maps sprite names to atlas regions)
  const sprites: Record<string, { x: number; y: number; w: number; h: number; pivot: { x: number; y: number } }> = {};
  for (let i = 0; i < allCanvases.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    sprites[`${sanitizeFilename(sheetName)}_${i}`] = {
      x: col * (fw + padding),
      y: row * (fh + padding),
      w: fw,
      h: fh,
      pivot: { x: 0.5, y: 0 }, // bottom-center pivot for characters
    };
  }

  const atlasMeta = JSON.stringify({
    generator: 'SpriteBrew',
    texture: pngFilename,
    textureSize: { w: sheet.width, h: sheet.height },
    spriteSize: { w: fw, h: fh },
    sprites,
    animations: animMeta.map((am) => ({
      name: am.name,
      fps: am.fps,
      loop: am.loop,
      frames: Array.from({ length: am.count }, (_, i) => `${sanitizeFilename(sheetName)}_${am.startIdx + i}`),
    })),
  }, null, 2);

  const pngBlob = await canvasToBlob(sheet);
  await downloadAsZip(
    [
      { name: pngFilename, data: pngBlob },
      { name: `${sanitizeFilename(sheetName)}_atlas.json`, data: atlasMeta },
      ...animFiles,
      ...frameAssets.flatMap((asset) => [
        { name: `frames/${asset.name}`, data: asset.data },
        { name: `frames/${asset.name}.meta`, data: buildUnitySpriteMeta(asset.guid) },
      ]),
    ],
    'spritebrew_export_unity.zip'
  );
}

// ─── Layered (runtime-composable) ───
//
// Bundles the current composed sheet alongside the parts that were chosen at
// generation time, plus a layout.json + README. The "base.png" is the composed
// sheet — true uncomposed layering would require keeping the pre-outfit base
// across the slice/edit pipeline; v1 ships the kit form.

export interface LayeredExportOptions extends ExportOptions {
  outfit: Outfit;
}

export async function exportLayered(opts: LayeredExportOptions): Promise<void> {
  const { animations, frameDataUrls, outfit, sheetName } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  if (animations.length === 0) return;

  // Build the composed base sheet (one strip per animation).
  const allCanvases: HTMLCanvasElement[] = [];
  const animMeta: { name: string; startIdx: number; count: number; fps: number; loop: boolean }[] = [];
  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    animMeta.push({
      name: anim.name,
      startIdx: allCanvases.length,
      count: canvases.length,
      fps: anim.fps,
      loop: anim.loop,
    });
    allCanvases.push(...canvases);
  }
  if (allCanvases.length === 0) return;

  const columns = optimalColumns(allCanvases.length);
  const sheet = assembleGridSheet(allCanvases, columns, opts.padding, opts.powerOfTwo);
  const baseBlob = await canvasToBlob(sheet);

  const files: { name: string; data: Blob | string }[] = [
    { name: 'base.png', data: baseBlob },
  ];

  // Fetch each selected part PNG and resize to frame size for runtime overlay.
  const partsManifest: Record<string, { source: string; width: number; height: number; frames: number; kind: string }> = {};
  for (const cat of Object.keys(outfit) as PartCategory[]) {
    const partName = outfit[cat];
    if (!partName) continue;
    const part = PARTS[cat].find((p) => p.name === partName);
    if (!part) continue;

    const partUrl = `/parts/${cat}/${partName}${part.frames && part.frames > 1 ? `/${partName}-${pickFirstFrameSuffix(part)}` : ''}.png`;
    const partImg = await loadImage(partUrl).catch(() => null);
    if (!partImg) continue;

    const partCanvas = document.createElement('canvas');
    partCanvas.width = fw;
    partCanvas.height = fh;
    const pctx = partCanvas.getContext('2d')!;
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(partImg, 0, 0, fw, fh);
    const partBlob = await canvasToBlob(partCanvas);

    files.push({ name: `parts/${cat}.png`, data: partBlob });
    partsManifest[cat] = {
      source: `parts/${cat}.png`,
      width: fw,
      height: fh,
      frames: part.frames ?? 1,
      kind: part.kind ?? 'static',
    };
  }

  const layout = {
    generator: 'SpriteBrew',
    version: '1.0',
    base: 'base.png',
    columns,
    padding: opts.padding,
    frameWidth: fw,
    frameHeight: fh,
    layerOrder: ['base', 'top', 'body', 'heads', 'eyes'],
    parts: partsManifest,
    animations: animMeta.map((am) => ({
      name: am.name,
      startIndex: am.startIdx,
      frameCount: am.count,
      fps: am.fps,
      loop: am.loop,
    })),
  };
  files.push({ name: 'layout.json', data: JSON.stringify(layout, null, 2) });

  const readme = [
    '# SpriteBrew Layered Export',
    '',
    'This bundle contains the composed sprite sheet (`base.png`), the parts',
    'selected at generation time (under `parts/`), and `layout.json` describing',
    'frame indices and intended layer order.',
    '',
    '## Files',
    '',
    '- `base.png` — composed sprite sheet at the chosen frame size.',
    '- `parts/{category}.png` — first frame of the selected part, resized to the',
    '  same frame size as the sheet. Use these for runtime decoration (e.g.',
    '  swap eyes per state).',
    '- `layout.json` — frame layout, animation tags, and selected parts.',
    '',
    '## Recompositing at runtime',
    '',
    'Render `base.png`, then composite the part overlays in the order listed in',
    '`layout.json` -> `layerOrder`. Each part PNG is sized to fit one frame of',
    'the base sheet — translate it to `(frameIndex * frameWidth, 0)` to match.',
    '',
    'Note: in v1 the base is already composed with the chosen outfit. To keep',
    'the parts swappable at runtime, regenerate with no outfit selected, then',
    'use this Layered export with the outfit you actually want bundled.',
    '',
  ].join('\n');
  files.push({ name: 'README.md', data: readme });

  await downloadAsZip(files, `${sanitizeFilename(sheetName)}_layered.zip`);
}

function pickFirstFrameSuffix(part: { frames?: number; kind?: string }): string {
  if (part.kind === 'blink') return 'open';
  if (part.kind === 'sequence') return '01';
  return '01';
}

// ─── Collision / Region Metadata (JSON) ───

export async function exportCollisionMeta(opts: ExportOptions): Promise<void> {
  const { animations, frameDataUrls, sheetName } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const animCollisions: unknown[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const frames: unknown[] = [];

    for (let i = 0; i < canvases.length; i++) {
      const canvas = canvases[i];
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.getImageData(0, 0, fw, fh);
      const { aabb, hull } = computeCollision(imgData, fw, fh);
      frames.push({ frame: i, aabb, convexHull: hull });
    }

    animCollisions.push({ name: anim.name, frames });
  }

  const meta = JSON.stringify({
    generator: 'SpriteBrew',
    frameSize: { w: fw, h: fh },
    animations: animCollisions,
  }, null, 2);

  const files: { name: string; data: string }[] = [
    { name: `${sanitizeFilename(sheetName)}_collision.json`, data: meta },
  ];
  await downloadAsZip(files, 'spritebrew_export_collision.zip');
}

function computeCollision(
  imgData: ImageData,
  w: number,
  h: number,
): { aabb: { x: number; y: number; w: number; h: number }; hull: Array<{ x: number; y: number }> } {
  const data = imgData.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const opaquePoints: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        // Sample edge pixels for hull (every 2px on boundary)
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
            data[((y - 1) * w + x) * 4 + 3] <= 16 ||
            data[((y + 1) * w + x) * 4 + 3] <= 16 ||
            data[(y * w + x - 1) * 4 + 3] <= 16 ||
            data[(y * w + x + 1) * 4 + 3] <= 16) {
          opaquePoints.push({ x, y });
        }
      }
    }
  }

  const aabb = maxX < 0
    ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

  // Convex hull via gift wrapping (Jarvis march) on sampled edge points
  const hull = opaquePoints.length > 2 ? convexHull(opaquePoints) : opaquePoints;

  return { aabb, hull };
}

function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  // Downsample if too many points
  let pts = points;
  if (pts.length > 200) {
    const step = Math.ceil(pts.length / 200);
    pts = pts.filter((_, i) => i % step === 0);
  }

  // Find leftmost point
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[start].x || (pts[i].x === pts[start].x && pts[i].y < pts[start].y)) {
      start = i;
    }
  }

  const hull: Array<{ x: number; y: number }> = [];
  let current = start;
  do {
    hull.push(pts[current]);
    let next = 0;
    for (let i = 1; i < pts.length; i++) {
      if (i === current) continue;
      if (next === current) { next = i; continue; }
      const cross = (pts[i].x - pts[current].x) * (pts[next].y - pts[current].y) -
                    (pts[i].y - pts[current].y) * (pts[next].x - pts[current].x);
      if (cross > 0) next = i;
    }
    current = next;
    if (hull.length > 64) break; // safety limit
  } while (current !== start);

  return hull;
}

// ─── Raw Individual Frames ───

export async function exportRawFrames(opts: ExportOptions & { includeManifest: boolean }): Promise<void> {
  const { animations, frameDataUrls, includeManifest } = opts;
  const fw = opts.resizeWidth ?? opts.frameWidth;
  const fh = opts.resizeHeight ?? opts.frameHeight;

  const files: { name: string; data: Blob | string }[] = [];
  const manifestAnimations: unknown[] = [];

  for (const anim of animations) {
    if (anim.frames.length === 0) continue;
    const canvases = await loadFrameCanvases(anim.frames, frameDataUrls, fw, fh);
    const animName = sanitizeFilename(anim.name);
    const frameFiles: string[] = [];

    for (let i = 0; i < canvases.length; i++) {
      const filename = `${animName}_${String(i).padStart(2, '0')}.png`;
      const blob = await canvasToBlob(canvases[i]);
      files.push({ name: filename, data: blob });
      frameFiles.push(filename);
    }

    manifestAnimations.push({
      name: anim.name,
      type: anim.type,
      fps: anim.fps,
      loop: anim.loop,
      frameCount: canvases.length,
      files: frameFiles,
    });
  }

  if (files.length === 0) return;

  if (includeManifest) {
    const manifest = JSON.stringify(
      {
        generator: 'SpriteBrew',
        version: '1.0',
        frameSize: { width: fw, height: fh },
        animations: manifestAnimations,
      },
      null,
      2
    );
    files.push({ name: 'manifest.json', data: manifest });
  }

  await downloadAsZip(files, 'spritebrew_export_raw_frames.zip');
}
