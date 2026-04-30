# SpriteBrew 整合改造实施计划（合并版）

> **项目：** SpriteBrew（fork 自 GAlbanese09/spritebrew）
> **创建：** 2026-04-30 · **最后同步：** 2026-04-30 (Phase 1–8 全部完成)
> **目标：** 本地单用户部署 + GPT Image 2 / Gemini 双后端 + 整合 pixabots compositor + 适配 AgentHydration 和 game-simulate 两个消费方
> **协议：** AGPL-3.0
> **本文档是唯一计划源**（`adaptation-plan.md` 已合并到本文）

---

## 进度速览

| Phase | 内容 | 状态 |
|---|---|---|
| Phase 1 | 去云依赖（Clerk/KV/Stripe + runtime） | ✅ 完成（commit `1196647`） |
| Phase 2 | imageGenAdapter 双后端 | ✅ 完成（commit `f83181d`） |
| Phase 3 | 后处理流水线 | ✅ 完成（commit `00419bf`） |
| Phase 4 | pixabots compositor + parts 移植 | ✅ 完成（commit `97ce656`） |
| Phase 5 | Create New 整合（含 outfit picker） | ✅ 完成（commit `56d6733`） |
| Phase 6 | Animate My Character 改造 | ✅ 完成（commit `0bfa963`） |
| Phase 7 | 双模式导出（baked + layered） | ✅ 完成（commit `9d58541`） |
| Phase 8 | AgentHydration 接入（SpriteBrew 端） | ✅ 完成 |

**当前可工作功能：** Create New + Animate My Character + Outfit Picker + Layered 导出 + AgentHydration 7 状态批量。需配置 `OPENAI_API_KEY` 或 `GEMINI_API_KEY`，并设置 `IMAGE_GEN_API_PROVIDER=gpt-image|gemini`。AgentHydration 仓库侧的 PixiJS 集成（§9.3）未做。

---

## 0. 总览与范围

### 0.1 v1 目标功能清单

- ✅ **Create New**（文本生成像素角色）
- ✅ **Animate My Character**（上传角色 + 动作 → 动画 sprite sheet）
- 🔜 **Outfit / Parts**（从 pixabots 移植，可选叠加部件）
- 🔜 **GPT Image 2 / Gemini 双后端**（env 切换）
- 🔜 **双导出**（baked PNG + 分层 zip）
- 🔜 **AgentHydration 适配**（character 模板预设，一键产出 7 状态 sprite sheet）
- ✅ **game-simulate 适配**（Godot SpriteFrames `.tres`，沿用现有导出器）
- ✅ **本地单用户部署**（无 Clerk/KV/Stripe）

### 0.2 v1 不做（phase 2 再考虑）

- ❌ Token 余额持久化（v1 在本地无需限额）
- ❌ 多用户隔离（v1 单用户）
- ❌ 在线部署（v1 仅本地，AGPL 触发条件不达成）
- ❌ Animate 模式的 12/16 帧档位（先跑通 4/6/8）

### 0.3 工作量估算

| Phase | 内容 | 估时 | 状态 |
|---|---|---|---|
| Phase 1 | 去云依赖 | 0.5 天 | ✅ |
| Phase 2 | imageGenAdapter 双后端 | 1 天 | ⏳ |
| Phase 3 | 后处理流水线 | 0.5 天 | ⏳ |
| Phase 4 | pixabots compositor + parts 移植 | 1 天 | ⏳ |
| Phase 5 | Create New 整合（含 outfit picker UI） | 0.5 天 | ⏳ |
| Phase 6 | Animate My Character 改造 | 0.5 天 | ⏳ |
| Phase 7 | 双模式导出 | 0.5 天 | ⏳ |
| Phase 8 | AgentHydration 接入 | 0.5 天 | ⏳ |
| **合计** | | **5 天** | **0.5 / 5** |

---

## 1. 环境变量

`.env.local`（不提交，已在 `.gitignore`）：

```env
# 二选一
IMAGE_GEN_API_PROVIDER=gpt-image    # gpt-image | gemini

# GPT Image 2（默认 gpt-image-2，2026-04 发布）
OPENAI_BASE_URL=https://api.openai.com    # 中转站则改成中转域名（不带末尾 /）
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-2

# Nano Banana 2（默认 gemini-3.1-flash-image-preview，2026-03 发布）
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_API_KEY=...
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

详细字段说明见 `docs/usage.md` §1.2（含中转站接入策略）。

**安全规则**：禁止把真实 key 写进任何 `.md` / `.ts` / git 跟踪的文件，只放在 `.env.local`。

---

## 2. Phase 1：去云依赖 ✅ 已完成

> **commit `1196647`** · **2026-04-30**

### 2.1 实际改动概要

**删除文件（19 个）：**
- `src/app/sign-in/`、`src/app/sign-up/`、`src/app/buy-tokens/`、`src/app/admin/test-references/`、`src/app/refund-policy/`
- `src/app/api/stripe/`、`src/app/api/token-balance/`、`src/app/api/generation-limit/`、`src/app/api/waitlist/`
- `src/lib/stripe.ts`、`accountLock.ts`、`tokenBalance.ts`、`tokenDebit.ts`、`serverRateLimit.ts`、`disputeEvidence.ts`、`tokenPacks.ts`
- `src/components/layout/ClerkClientProvider.tsx`、`WaitlistModal.tsx`

**修改文件：**
- `src/app/api/generate/route.ts` — 删除 JWT/account-lock/debit-credit 逻辑；`runtime: 'edge' → 'nodejs'`；保留 RD 调用作为临时桥
- `src/app/layout.tsx` — 移除 `ClerkClientProvider` 包装
- `src/app/page.tsx` — 替换为 minimal 本地 landing
- `src/app/{generate,gallery}/page.tsx` — 移除 `useAuth()`，引入模块级 `userId = null` 常量
- `src/components/sprites/{GenerationForm,AnimateForm,GenerationResult}.tsx` — 同上
- `src/components/layout/{Sidebar,Header}.tsx` — 移除 sign-in / buy-tokens 导航
- `src/app/{privacy,terms}/page.tsx` — runtime 切到 nodejs
- `package.json` — 删除 `@clerk/react`、`stripe` deps

**验证：**
- `npx tsc --noEmit` 无错误
- `NODE_OPTIONS= npm run build` 成功
- 8 个 lint errors / 30 warnings 均为**改动前已存在的** set-state-in-effect / `<img>` 提示，未在 Phase 1 处理

### 2.2 重要保留项

- `tokenBalance` 字段仍在 `spriteStore.ts`（无 callers，留作 cleanup 候选）
- `getTokenCost`、`isAdminUser` 仍在 `styleRegistry.ts` / `generationLimits.ts`（无 callers，Phase 5 重设 styleRegistry 时一起清理）
- `ClerkClientProvider` 已删，但 `@clerk/react` 包对应代码已无引用

---

## 3. Phase 2：imageGenAdapter 双后端适配层

### 3.1 目标

抽象统一接口，让 `/api/generate/route.ts` 不感知具体后端。env 切 provider 即可换 API。

### 3.2 新增文件：`src/lib/imageGen/types.ts`

```typescript
export interface GenerateRequest {
  prompt: string;
  width: number;          // 目标尺寸（最终输出像素，不是 API 调用尺寸）
  height: number;
  referenceImages?: string[];  // base64，无 data: 前缀
}

export interface EditRequest {
  referenceImage: string;      // base64
  prompt: string;
  canvasSize?: { w: number; h: number };  // API 调用画布大小，默认 1024x1024
}

export interface GenResult {
  rawBase64Image: string;      // API 返回大图，base64（无 data: 前缀）
  rawWidth: number;
  rawHeight: number;
  cost?: number;
}

export interface ImageGenAdapter {
  generate(req: GenerateRequest): Promise<GenResult>;
  editWithReference(req: EditRequest): Promise<GenResult>;
}
```

### 3.3 新增文件：`src/lib/imageGen/gptImageAdapter.ts`

封装 OpenAI Images API：

- 端点：`https://api.openai.com/v1/images/generations`（generate）、`/v1/images/edits`（editWithReference）
- 模型：`gpt-image-1`
- 关键参数：`size: '1024x1024'`（generate）/ `'auto'`（edit）、`quality: 'medium'`、`background: 'transparent'`、`response_format: 'b64_json'`
- 参考图：`generate` 不直接支持 ref，要走 `edit` 端点上传
- 错误重试：429/5xx 指数退避（max 3 次）

### 3.4 新增文件：`src/lib/imageGen/geminiAdapter.ts`

封装 Gemini Image API：

- 端点：`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
- 关键参数：`contents` 含 prompt 和（可选）inline image data
- 输出：从 `candidates[0].content.parts[].inlineData.data` 提取 base64
- 透明背景：通过 prompt 文本要求 `"on transparent background, no background color, alpha channel"`

### 3.5 新增文件：`src/lib/imageGen/index.ts`

```typescript
import { GptImageAdapter } from './gptImageAdapter';
import { GeminiAdapter } from './geminiAdapter';
import type { ImageGenAdapter } from './types';

let cachedAdapter: ImageGenAdapter | null = null;

export function getImageGenAdapter(): ImageGenAdapter {
  if (cachedAdapter) return cachedAdapter;
  const provider = process.env.IMAGE_GEN_API_PROVIDER ?? 'gpt-image';
  switch (provider) {
    case 'gpt-image': cachedAdapter = new GptImageAdapter(); break;
    case 'gemini':    cachedAdapter = new GeminiAdapter(); break;
    default: throw new Error(`Unknown IMAGE_GEN_API_PROVIDER: ${provider}`);
  }
  return cachedAdapter;
}
```

### 3.6 验证标准

- 切换 env 不重启代码生效（开发时 Next.js 自动重载）
- 两后端各跑 1 次 generate + 1 次 editWithReference，输出可解析为 PNG

---

## 4. Phase 3：后处理流水线

### 4.1 目标

把 GPT/Gemini 返回的 1024px 高清图转换为目标尺寸的干净像素画。

### 4.2 新增文件：`src/lib/imageGen/postProcess.ts`

```typescript
export interface PostProcessOptions {
  targetWidth: number;
  targetHeight: number;
  paletteColors?: number;          // 可选，调色板量化色数
  removeBackground?: boolean;      // 默认 true
  bgSampleStrategy?: 'corners' | 'edges' | 'fixed';
}

export async function postProcessSprite(
  rawBase64: string,
  opts: PostProcessOptions,
): Promise<string>;  // 返回 base64（无 data: 前缀）
```

### 4.3 实现要点

依赖：`sharp` + `image-q`（调色板量化）

```bash
npm i sharp image-q
```

流水线：

1. **解码**：`sharp(Buffer.from(rawBase64, 'base64'))`
2. **背景去除**（移植自 pixabots `process_spritesheet.py`）：
   - 采样四角颜色，取主色作为背景
   - 阈值容差（默认 RGB 距离 30）内的像素 alpha 设为 0
   - MinFilter/MaxFilter 形态学清理
3. **裁剪**：`sharp().trim()` 自动裁到内容边界
4. **居中填充**：放回 1024 画布中心
5. **降采样**：`sharp().resize(targetWidth, targetHeight, { kernel: 'nearest' })`
6. **调色板量化**（可选）：`image-q` 的 `applyPaletteSync` + k-means 聚类到 N 色
7. **输出**：`png().toBuffer().toString('base64')`

### 4.4 Animate 模式的特殊后处理

新增 `src/lib/imageGen/spritesheetSlicer.ts`：

```typescript
export async function detectAndSliceFrames(
  rawBase64: string,
  expectedFrameCount: number,
  targetFrameSize: number,
): Promise<string[]>;  // 返回 N 个 base64 帧
```

策略（移植 pixabots 的 `process_spritesheet.py` 逻辑）：

- 假设横向均分布局：宽度 / N = 每帧宽度
- 每帧独立 trim → 居中 → 降采样
- 输出 N 个独立帧 base64

### 4.5 验证标准

- 输入 1024×1024 GPT 原图 → 输出 64×64 PNG，前景清晰、透明背景、无白边
- Animate 输入 1536×1024 含 6 帧 → 输出 6 张独立 64×64 PNG
- 调色板量化开启 16 色后，视觉无明显劣化

---

## 5. Phase 4：pixabots compositor + parts 移植

### 5.1 目标

把 `../pixabots/packages/extended/src/compositor.ts` 的部件叠加能力移植到 SpriteBrew。

### 5.2 新增目录：`public/parts/`

从 pixabots 拷贝 PNG 资源：

```
public/parts/
├── eyes/    (16 张，含 sequence 帧子目录如 eyes/blink/blink-01.png)
├── heads/   (8 张)
├── body/    (7 张)
└── top/     (12 张)
```

保持 pixabots 的目录结构，包括 `<part>/<part>-NN.png` 多帧约定。

### 5.3 新增文件：`src/lib/parts/catalog.ts`

直接从 pixabots `packages/core/src/parts.ts` 拷贝，**不修改顺序**（base36 ID 稳定性依赖此约定）。导出：

- `EYES`, `HEADS`, `BODY`, `TOP` 四个数组
- `Part` 类型定义（含 `frames`, `kind`, `path`）
- `decode(id: string)` / `encode(parts)`

### 5.4 新增文件：`src/lib/parts/compositor.ts`

直接从 pixabots `packages/extended/src/compositor.ts` 移植，保留所有公共 API：

- `compositeFrame(layers: LayerDef[]): Promise<Buffer>`
- `compositeAgentFrame(baseFrame: Buffer, overlays: PartOverlay[]): Promise<Buffer>`
- `LayerDef`, `PartOverlay` 类型

修改点：

1. 把 pixabots 的 `loadAsset()` 路径从 `art/png/` 改为 SpriteBrew 的 `public/parts/`
2. asset-loader 从 fs 读改为从 Next.js `public/` 目录读
3. 多帧 sprite sheet 输入时，逐帧叠加（接受 `frameIndex` 参数，复用 pixabots 已有逻辑）

### 5.5 不移植的部分

- pixabots 的 base36 ID 字符串 CLI（用不到）
- pixabots 的 Python `process_spritesheet.py`（已在 Phase 3 用 TS 重写）

### 5.6 验证标准

- 调 `compositeAgentFrame()` 输入一张 base64 角色 + `[{cat: 'top', name: 'horns'}]` → 输出叠加 horns 的 PNG
- 多帧 sprite sheet 输入时，每帧都叠加

---

## 6. Phase 5：Create New 整合改造

### 6.1 修改文件：`src/app/api/generate/route.ts`

**重写 `runCreate()`**：

```typescript
async function runCreate(body: GenerateBody): Promise<Record<string, unknown>> {
  const adapter = getImageGenAdapter();
  const promptText = buildCreatePrompt(body);  // 包含 style hints

  // 1. 调 AI 生图
  const raw = await adapter.generate({
    prompt: promptText,
    width: body.width!,
    height: body.height!,
    referenceImages: body.referenceImages,
  });

  // 2. 后处理
  let processed = await postProcessSprite(raw.rawBase64Image, {
    targetWidth: body.width!,
    targetHeight: body.height!,
    paletteColors: body.paletteColors,
    removeBackground: body.removeBg ?? true,
  });

  // 3. 部件叠加（可选）
  if (body.outfit && Object.keys(body.outfit).length > 0) {
    processed = await applyOutfit(processed, body.outfit);
  }

  return {
    success: true,
    imageUrl: `data:image/png;base64,${processed}`,
    prediction: { status: 'succeeded', cost: raw.cost },
  };
}
```

`buildCreatePrompt()`：从 `styleRegistry.ts` 读 `promptPrefix`（新字段），拼接为 `"{prefix}, {user prompt}, pixel art, {width}x{height}, transparent background"`。

### 6.2 修改文件：`src/lib/styleRegistry.ts`

**字段调整**：

```typescript
interface GenerationStyle {
  // 保留
  id: string;
  label: string;
  description: string;
  tier: 'fast' | 'plus' | 'pro' | 'animation';
  category: string;
  defaultWidth: number;
  defaultHeight: number;
  minSize: number;
  maxSize: number;

  // 新增（替代 promptStyle）
  promptPrefix: string;        // "16-bit pixel art character, side view, "
  paletteColors?: number;      // 可选量化色数

  // 移除
  // promptStyle、costPerGeneration、tokenCost、supportsRemoveBg → 全部默认 true
  // supportsReferenceImages → 全部默认 true（GPT/Gemini 都支持）
}
```

风格条目精简：保留 6-8 个有代表性的（character / item / environment / tile / portrait / animation_walk / animation_idle / animation_attack），删除 RD 专属细分。

### 6.3 新增组件：`src/components/sprites/OutfitPicker.tsx`

UI 结构：

```
[Eyes ▾]   [Heads ▾]   [Body ▾]   [Top ▾]
[None ]    [None  ]    [None ]    [None]
```

- 每个下拉显示部件缩略图 + 名称
- 选中后实时预览（前端 canvas 合成，无需调后端）
- 状态存到 `spriteStore`：`outfit: { eyes?: string; heads?: string; body?: string; top?: string }`

### 6.4 修改组件：`src/components/sprites/GenerationForm.tsx`

- 在 Style 选择下方插入 `<OutfitPicker />`（可折叠 "Optional: Outfit"）
- 提交时把 `outfit` 字段加入 POST body

### 6.5 验证标准

- Create New 输入 prompt + 选 outfit → 返回叠加好的 PNG
- 不选 outfit → 行为与 Phase 1 版本一致
- 切换 GPT / Gemini provider，两边都能跑通

---

## 7. Phase 6：Animate My Character 改造

### 7.1 修改文件：`src/app/api/generate/route.ts`

**重写 `runAnimate()`**：

```typescript
async function runAnimate(body: GenerateBody): Promise<Record<string, unknown>> {
  const { inputImage, action, framesDuration, motionPrompt } = body;
  const frameCount = framesDuration && [4, 6, 8].includes(framesDuration) ? framesDuration : 6;
  const frameSize = body.width ?? 64;
  const adapter = getImageGenAdapter();

  // 1. 构建 prompt
  const actionPrompt = ACTION_PROMPT_PREFIX[action!] ?? '';
  const userMotion = motionPrompt?.trim() ?? '';
  const prompt = [
    `Generate a ${frameCount}-frame ${actionPrompt} animation sprite sheet of this character`,
    `horizontal layout, each frame ${frameSize}x${frameSize} pixels`,
    `transparent background, pixel art style`,
    `character must remain visually identical across all frames`,
    userMotion,
  ].filter(Boolean).join(', ');

  // 2. 调 AI（单次出大图）
  const canvasW = frameCount * 256;
  const canvasH = 256;
  const raw = await adapter.editWithReference({
    referenceImage: inputImage!.replace(/^data:image\/[a-z]+;base64,/, ''),
    prompt,
    canvasSize: { w: canvasW, h: canvasH },
  });

  // 3. 自动切帧 + 后处理
  const frames = await detectAndSliceFrames(raw.rawBase64Image, frameCount, frameSize);

  // 4. 重组成规整 sprite sheet
  const composed = await composeFramesHorizontally(frames, frameSize);

  return {
    success: true,
    imageUrl: `data:image/png;base64,${composed}`,
    prediction: { status: 'succeeded', cost: raw.cost },
  };
}
```

### 7.2 修改文件：`src/components/sprites/AnimateForm.tsx`

- 帧数选项收窄到 4/6/8（移除 10/12/16，提示 "Phase 2 will add more"）
- UI 文案更新（移除 "powered by Retro Diffusion"）

### 7.3 验证标准

- 上传一张 64×64 角色 PNG → 选 walking + 6 帧 → 返回 384×64 sprite sheet
- 切帧准确率 100%（用合成测试图验证）
- 角色一致性可接受（人工验收）

---

## 8. Phase 7：双模式导出

### 8.1 修改文件：`src/lib/exportEngine.ts`

**新增导出格式 `'layered'`**：

```typescript
export interface LayeredExportInput {
  baseSheet: string;
  outfit?: Record<string, string>;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  animationName: string;
  fps: number;
}

export async function exportLayered(input: LayeredExportInput): Promise<Blob> {
  // 输出 zip:
  //   base.png
  //   eyes.png, heads.png, body.png, top.png
  //   layout.json
  //   README.md
}
```

### 8.2 修改 UI：`src/app/export/page.tsx`

新增导出选项卡 **"Layered (Runtime composable)"**，与现有 6 种格式并列。

### 8.3 修改：`src/lib/exportEngine.ts` Godot 导出器

新增可选参数 `layered: boolean`：

- `false`（默认）：现有行为，单图 SpriteFrames `.tres`
- `true`：输出多个 SpriteFrames + 一个 `character.tscn` 场景文件

### 8.4 验证标准

- Layered zip 解压后，PixiJS 用 `PIXI.Container` 加载 base + 1 个 outfit 能正确显示
- Godot 导入 layered `.tscn`，运行时 frame index 同步播放

---

## 9. Phase 8：AgentHydration 接入

### 9.1 SpriteBrew 端：新增"AgentHydration 模板"

新增文件：`src/lib/templates/agentHydration.ts`

```typescript
export const AGENT_HYDRATION_STATES = [
  'idle', 'active', 'thinking', 'coding', 'testing', 'error', 'done',
] as const;

export const AGENT_HYDRATION_TEMPLATE = {
  size: 64,
  framesPerState: 6,
  fps: 8,
  paletteColors: 16,
  promptPrefix: 'cute pixel art chibi character, frontal view, ',
  exportFormat: 'aseprite-json',
};
```

### 9.2 SpriteBrew 端：新增 UI 入口

新增页面：`src/app/agent-hydration/page.tsx`

- 输入：角色描述 + agent type（claude / codex / gemini / default）
- 自动批量调 7 次 generate（每个状态 1 次），并发限制 2
- 进度条 SSE 显示
- 输出：zip 含 7 个 sprite sheet + 7 个 Aseprite JSON + 1 个 `manifest.json`

### 9.3 AgentHydration 端：接入修改

> **本节修改的是 `/Users/xujingqi/Projects/AgentHydration` 项目，不是 SpriteBrew。**

**新增目录：**
```
AgentHydration/src/lib/characters/sprites/
├── claude-code/
│   ├── manifest.json
│   ├── idle.png
│   ├── idle.json
│   └── ... (其余 6 状态)
├── codex-cli/
├── gemini-cli/
└── default/
```

**修改：`src/lib/characters/index.ts`**

```typescript
import { Spritesheet, Assets } from 'pixi.js';

export async function loadAgentSprite(agentType: AgentType, state: AgentState) {
  const manifest = await fetch(`/sprites/${agentType}/manifest.json`).then(r => r.json());
  const stateMeta = manifest.states[state];
  const sheet = await Assets.load(`/sprites/${agentType}/${stateMeta.sheet}`);
  const ase = await fetch(`/sprites/${agentType}/${stateMeta.json}`).then(r => r.json());
  return new Spritesheet(sheet, ase).parse();
}
```

**修改：`src/components/design/AgentSprite.tsx`** — 用 PixiJS `AnimatedSprite` 替换 ASCII / Lottie 渲染。

### 9.4 验证标准

- 在 SpriteBrew `/agent-hydration` 页面输入 "blue cat" + claude-code → 生成 zip
- 解压到 `AgentHydration/src/lib/characters/sprites/claude-code/` → 启动 AgentHydration → 状态切换正常播放

---

## 10. 文件变更总清单

### 已完成（Phase 1）

参见上文 §2.1。

### 待新增（Phase 2-8，约 15 个）

```
src/lib/imageGen/
├── types.ts
├── gptImageAdapter.ts
├── geminiAdapter.ts
├── postProcess.ts
├── spritesheetSlicer.ts
└── index.ts

src/lib/parts/
├── catalog.ts          (从 pixabots/packages/core/src/parts.ts 移植)
└── compositor.ts       (从 pixabots/packages/extended/src/compositor.ts 移植)

src/lib/templates/
└── agentHydration.ts

src/components/sprites/
└── OutfitPicker.tsx

src/app/agent-hydration/
└── page.tsx

public/parts/
├── eyes/   (从 pixabots/art/png/eyes/ 拷贝)
├── heads/
├── body/
└── top/

.env.local              (本地配置，不提交)
```

### 待修改（Phase 5-7，约 8 个）

- `src/app/api/generate/route.ts` — 整合 imageGenAdapter、后处理、部件、Animate 改造
- `src/lib/styleRegistry.ts` — 字段重设
- `src/lib/exportEngine.ts` — 新增 layered 导出
- `src/components/sprites/GenerationForm.tsx` — 集成 OutfitPicker
- `src/components/sprites/AnimateForm.tsx` — 帧数收窄、文案
- `src/lib/types.ts` — 新增 `Outfit`, `LayeredExportInput`
- `src/stores/spriteStore.ts` — 新增 outfit 字段
- `src/app/export/page.tsx` — 新增 Layered 选项卡

### 待新增依赖

```bash
npm i sharp image-q
```

---

## 11. 测试与验证

### 11.1 关键路径验证（每个 phase 完成后跑一遍）

| 路径 | 验收标准 |
|---|---|
| Create New + GPT Image 2 | 64×64 角色 PNG，背景透明 |
| Create New + Gemini | 同上，切 env 即生效 |
| Create New + outfit | 角色叠加 horns + cape，无错位 |
| Animate + 6 帧 walking | 384×64 sprite sheet，6 帧角色一致 |
| Layered 导出 | zip 解压含 base + outfit + layout.json |
| Godot `.tres` 导入 | game-simulate 加载播放正常 |
| AgentHydration 批量 | 7 状态 zip 落地后桌宠正常播放 |

### 11.2 不做的测试（v1）

- 自动化单元测试
- 跨浏览器兼容（仅 Chrome 验证）
- 性能基准

---

## 12. 风险与对策

| # | 风险 | 概率 | 对策 |
|---|---|---|---|
| 1 | GPT/Gemini 输出帧间一致性差 | 中 | Phase 6 验证阶段，prompt 不行就降级到 4 帧；保留 RD adapter 作为第三选项 |
| 2 | sharp 在 Next.js 16 build 失败 | 低 | 已知 sharp 与 Next.js 兼容；如失败改用 `@napi-rs/canvas` |
| 3 | pixabots parts PNG 与 AI 生成角色比例不符 | 中 | compositor 已有 `scale` 和 `offsetX/Y` 参数；UI 提供 part 微调控件 |
| 4 | Gemini `transparent background` 仅靠 prompt 不可靠 | 中 | 后处理强制移除背景兜底 |
| 5 | AgentHydration PixiJS 集成与现有 Lottie 冲突 | 低 | 以 feature flag 切换，默认仍走 Lottie，sprite 模式可选启用 |
| 6 | parts 资源 AGPL 兼容性 | 低 | pixabots 是 fork，许可证应已兼容；如不兼容则不拷贝 PNG，仅移植代码 |

---

## 13. 实施顺序建议（剩余）

```
Day 1（已完成 0.5 天）：
  ☑ Phase 1（去云依赖） — commit 1196647

Day 1-2：
  ☐ Phase 2 上半（imageGenAdapter types + GPT adapter）
  ☐ Phase 2 下半（Gemini adapter + index）
  ☐ Phase 3（postProcess + spritesheetSlicer）
  ☐ 手测：Create New 走通 GPT 路径

Day 3：
  ☐ Phase 4（pixabots 移植）
  ☐ Phase 5（Create New 集成 outfit）
  ☐ 手测：outfit picker 工作

Day 4：
  ☐ Phase 6（Animate 改造）
  ☐ Phase 7（双模式导出）
  ☐ 手测：Animate 6 帧 + Layered 导出

Day 5：
  ☐ Phase 8（AgentHydration 接入）
  ☐ 端到端测试：从 SpriteBrew 生成 → AgentHydration 播放
  ☐ 文档收尾，CLAUDE.md 同步更新
```

---

## 14. Resume 指引（给下一个 Agent）

如果这是新启动的会话，按以下步骤继续：

1. **读本文档全文** —— 你的工作起点是 §3 (Phase 2)。
2. **检查 git log** —— 确认 commit `1196647` 已存在，工作目录干净：
   ```bash
   git log --oneline -3   # 应看到 "feat(local): Phase 1 ..."
   git status             # 应为 clean
   ```
3. **核对环境** —— `.env.local` 是否已配置 `OPENAI_API_KEY` 或 `GEMINI_API_KEY`。
4. **从 Phase 2 §3.2 开始** —— 新建 `src/lib/imageGen/types.ts`，按本文档代码骨架实现。
5. **每个 phase 完成后**：
   - 跑 `npx tsc --noEmit` + `NODE_OPTIONS= npm run build` 确认无回归
   - 提交 commit（消息格式参考 Phase 1: `feat(local): Phase N — <summary>`）
   - 在本文档 §进度速览 表里把状态从 ⏳ 改为 ✅，记录 commit hash
6. **遇到决策点**（如部件 PNG 是否拷贝、prompt 调优、Animate 帧数）—— 看 §0.1 / §12 风险表，已有方向；如仍不确定，问用户。

**关键参考路径：**
- pixabots 仓库：`/Users/xujingqi/Projects/pixabots`
- AgentHydration 仓库：`/Users/xujingqi/Projects/AgentHydration`
- game-simulate-project 仓库：`/Users/xujingqi/Projects/game-simulate-project`

---

## 15. 后续 phase 2 候选

- Animate 模式 12/16 帧
- Token 余额持久化（如果多用户场景出现）
- 部件 AI 生成（用户描述 → AI 生成新部件 PNG，加入 catalog）
- 角色风格预设库（保存常用 prompt + outfit 组合）
- WebGL 实时分层预览（替换 canvas 静态预览）

---

*整合 pixabots 工作流，覆盖 AgentHydration + game-simulate 双消费方场景。Phase 1 完成于 2026-04-30。*
