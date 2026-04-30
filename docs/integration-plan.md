# SpriteBrew 整合改造实施计划

> **项目：** SpriteBrew（fork 自 GAlbanese09/spritebrew）
> **日期：** 2026-04-30
> **目标：** 在 `adaptation-plan.md` 基础上，进一步整合 pixabots 的 compositor + parts 体系，支持 GPT Image 2 / Gemini 双后端切换，并适配 AgentHydration（PixiJS）和 game-simulate（Godot 4）两个消费方
> **关联文档：** `docs/adaptation-plan.md`（基础去云依赖改造）
> **协议：** AGPL-3.0

---

## 0. 与 adaptation-plan.md 的关系

`adaptation-plan.md` 覆盖了"去 Clerk/KV/Stripe + Edge→Node runtime 切换 + 替换 RD 后端"的**基础改造**。本计划在此基础上扩展三块**它没覆盖的内容**：

| 维度 | adaptation-plan.md | 本计划新增 |
|------|---|---|
| AI 后端 | 单后端（RD 替换为某一个 API） | **双后端适配层**（GPT Image 2 / Gemini，env 切换） |
| 后处理 | 未涉及 | **降采样 + 背景移除 + 调色板量化**（GPT/Gemini 输出 1024+，必须后处理） |
| 部件系统 | 未涉及 | **从 pixabots 移植 compositor + parts**（运行时换装） |
| 导出形态 | 沿用现有 6 种 | **新增分层导出**（base + parts + manifest，支持运行时分层渲染） |
| 消费方 | 未涉及 | **AgentHydration 接入**（替换 ASCII/Lottie，PixiJS v8 直接消费 Aseprite JSON 或分层包） |

执行顺序建议：**先做 adaptation-plan.md Phase 1-4（去云依赖），再做本计划 Phase 2-8**。

---

## 1. 总览与范围

### 1.1 v1 目标功能清单

- ✅ **Create New**（文本生成像素角色）
- ✅ **Animate My Character**（上传角色 + 动作 → 动画 sprite sheet）
- ✅ **Outfit / Parts**（从 pixabots 移植，可选叠加部件）
- ✅ **GPT Image 2 / Gemini 双后端**（env 切换）
- ✅ **双导出**（baked PNG + 分层 zip）
- ✅ **AgentHydration 适配**（character 模板预设，一键产出 7 状态 sprite sheet）
- ✅ **game-simulate 适配**（Godot SpriteFrames `.tres`，沿用现有导出器）
- ✅ **本地单用户部署**（无 Clerk/KV/Stripe）

### 1.2 v1 不做（phase 2 再考虑）

- ❌ Token 余额持久化（v1 在本地无需限额）
- ❌ 多用户隔离（v1 单用户）
- ❌ 在线部署（v1 仅本地，AGPL 触发条件不达成）
- ❌ Animate 模式的 12/16 帧档位（先跑通 4/6/8）

### 1.3 工作量估算

| Phase | 内容 | 估时 |
|---|---|---|
| Phase 1 | 沿用 adaptation-plan.md（去 Clerk/KV/Stripe + runtime） | 0.5 天 |
| Phase 2 | imageGenAdapter 双后端 | 1 天 |
| Phase 3 | 后处理流水线 | 0.5 天 |
| Phase 4 | pixabots compositor + parts 移植 | 1 天 |
| Phase 5 | Create New 整合（含 outfit picker UI） | 0.5 天 |
| Phase 6 | Animate My Character 改造 | 0.5 天 |
| Phase 7 | 双模式导出 | 0.5 天 |
| Phase 8 | AgentHydration 接入 | 0.5 天 |
| **合计** | | **5 天** |

---

## 2. 环境变量

`.env.local`（不提交，已在 `.gitignore`）：

```env
# ====== AI 图片生成后端（二选一，env 切换）======
IMAGE_GEN_API_PROVIDER=gpt-image    # 可选：gpt-image | gemini

# GPT Image 2（OpenAI gpt-image-1）
OPENAI_API_KEY=your_openai_key_here

# Gemini Nano Banana（gemini-2.5-flash-image）
GEMINI_API_KEY=your_gemini_key_here

# ====== 不再需要 ======
# RETRO_DIFFUSION_API_KEY=
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
# CLERK_SECRET_KEY=
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
```

**安全规则**：禁止把真实 key 写进任何 `.md` / `.ts` / git 跟踪的文件，只放在 `.env.local`。

---

## 3. Phase 1：基础去云依赖改造

> **沿用 `adaptation-plan.md` 的 Step 1-4 + Step 7-8。**
> 这里只补充**与本计划交叉的注意点**。

### 3.1 必做项

- 去 Clerk 认证（替换为固定 userId `'local-user'`）
- KV 不配置即自动降级（无需改代码）
- 删除 Stripe 相关目录
- 所有 `/api/**/route.ts` 把 `runtime = 'edge'` 改为 `runtime = 'nodejs'`

### 3.2 与本计划交叉的注意点

- `imageGenAdapter` 用 `sharp` 做后处理，**必须 nodejs runtime**（edge 不支持 native binding）
- `referenceImages` 字段在 adapter 层会被复用（不再是 RD pro 专属），需保留 base64 编码逻辑
- Sidebar 导航除了去掉登录/注册/Buy Tokens，**新增 "Outfit" 入口**（指向 outfit picker，可作为独立页面或集成在 GenerationForm 里）

---

## 4. Phase 2：imageGenAdapter 双后端适配层

### 4.1 目标

抽象统一接口，让 `/api/generate/route.ts` 不感知具体后端。env 切 provider 即可换 API。

### 4.2 新增文件：`src/lib/imageGen/types.ts`

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
  /** API 原始返回的大图，base64（无 data: 前缀） */
  rawBase64Image: string;
  /** API 调用画布尺寸 */
  rawWidth: number;
  rawHeight: number;
  /** 计费信息（如果 API 返回） */
  cost?: number;
}

export interface ImageGenAdapter {
  generate(req: GenerateRequest): Promise<GenResult>;
  editWithReference(req: EditRequest): Promise<GenResult>;
}
```

### 4.3 新增文件：`src/lib/imageGen/gptImageAdapter.ts`

封装 OpenAI Images API：

- 端点：`https://api.openai.com/v1/images/generations`（generate）、`/v1/images/edits`（editWithReference）
- 模型：`gpt-image-1`
- 关键参数：`size: '1024x1024'`（generate）/ `'auto'`（edit）、`quality: 'medium'`、`background: 'transparent'`、`response_format: 'b64_json'`
- 参考图：`generate` 不直接支持 ref，要走 `edit` 端点上传
- 错误重试：429/5xx 指数退避（max 3 次）

### 4.4 新增文件：`src/lib/imageGen/geminiAdapter.ts`

封装 Gemini Image API：

- 端点：`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
- 关键参数：`contents` 含 prompt 和（可选）inline image data
- 输出：从 `candidates[0].content.parts[].inlineData.data` 提取 base64
- 透明背景：通过 prompt 文本要求 `"on transparent background, no background color, alpha channel"`

### 4.5 新增文件：`src/lib/imageGen/index.ts`

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

### 4.6 验证标准

- 切换 env 不重启代码生效（开发时 Next.js 自动重载）
- 两后端各跑 1 次 generate + 1 次 editWithReference，输出可解析为 PNG

---

## 5. Phase 3：后处理流水线

### 5.1 目标

把 GPT/Gemini 返回的 1024px 高清图转换为目标尺寸的干净像素画。

### 5.2 新增文件：`src/lib/imageGen/postProcess.ts`

```typescript
export interface PostProcessOptions {
  targetWidth: number;     // 目标输出像素，如 64
  targetHeight: number;
  paletteColors?: number;  // 可选，调色板量化色数（默认不量化）
  removeBackground?: boolean;  // 默认 true
  bgSampleStrategy?: 'corners' | 'edges' | 'fixed';  // 背景采样策略
}

export async function postProcessSprite(
  rawBase64: string,
  opts: PostProcessOptions,
): Promise<string>;  // 返回 base64（无 data: 前缀）
```

### 5.3 实现要点

依赖：`sharp`（已在 Cloudflare Pages 项目可能没装，需 `npm i sharp`）+ `image-q`（调色板量化）。

流水线：

1. **解码**：`sharp(Buffer.from(rawBase64, 'base64'))`
2. **背景去除**（移植自 pixabots `process_spritesheet.py`）：
   - 采样四角颜色，取主色作为背景
   - 阈值容差（默认 RGB 距离 30）内的像素 alpha 设为 0
   - MinFilter/MaxFilter 形态学清理（消除边缘噪点）
3. **裁剪**：`sharp().trim()` 自动裁到内容边界
4. **居中填充**：放回 1024 画布中心，避免裁剪后比例失真
5. **降采样**：`sharp().resize(targetWidth, targetHeight, { kernel: 'nearest' })`
6. **调色板量化**（可选）：`image-q` 的 `applyPaletteSync` + k-means 聚类到 N 色
7. **输出**：`png().toBuffer().toString('base64')`

### 5.4 Animate 模式的特殊后处理

Animate 输出的是**单张大图含 N 帧**，后处理流水线插一步**自动切帧**：

```typescript
// src/lib/imageGen/spritesheetSlicer.ts

export async function detectAndSliceFrames(
  rawBase64: string,
  expectedFrameCount: number,
  targetFrameSize: number,
): Promise<string[]>;  // 返回 N 个 base64 帧
```

策略（移植 pixabots 的 `process_spritesheet.py` 逻辑）：

- 假设横向均分布局：宽度 / N = 每帧宽度
- 每帧独立 trim → 居中 → 降采样
- 输出 N 个独立帧 base64（前端可自由组装为新的整齐 sprite sheet）

### 5.5 验证标准

- 输入 1024×1024 GPT 原图 → 输出 64×64 PNG，前景清晰、透明背景、无白边
- Animate 输入 1536×1024 含 6 帧 → 输出 6 张独立 64×64 PNG
- 调色板量化开启 16 色后，视觉无明显劣化

---

## 6. Phase 4：pixabots compositor + parts 移植

### 6.1 目标

把 pixabots `packages/extended/src/compositor.ts` 的部件叠加能力移植到 SpriteBrew，让用户在生成角色后可以叠加 eyes / heads / body / top 部件。

### 6.2 新增目录：`public/parts/`

从 pixabots 拷贝 PNG 资源：

```
public/parts/
├── eyes/    (16 张，含 sequence 帧子目录如 eyes/blink/blink-01.png)
├── heads/   (8 张)
├── body/    (7 张)
└── top/     (12 张)
```

**注意**：保持 pixabots 的目录结构，包括 `<part>/<part>-NN.png` 多帧约定。

### 6.3 新增文件：`src/lib/parts/catalog.ts`

直接从 pixabots `packages/core/src/parts.ts` 拷贝过来，**不修改顺序**（base36 ID 稳定性依赖此约定）。导出：

- `EYES`, `HEADS`, `BODY`, `TOP` 四个数组
- `Part` 类型定义（含 `frames`, `kind`, `path`）
- `decode(id: string): { eyes, heads, body, top }`
- `encode(parts): string`

### 6.4 新增文件：`src/lib/parts/compositor.ts`

直接从 pixabots `packages/extended/src/compositor.ts` 移植，**保留所有公共 API**：

- `compositeFrame(layers: LayerDef[]): Promise<Buffer>`
- `compositeAgentFrame(baseFrame: Buffer, overlays: PartOverlay[]): Promise<Buffer>`
- `LayerDef`, `PartOverlay` 类型

修改点：

1. 把 pixabots 的 `loadAsset()` 路径从 `art/png/` 改为 SpriteBrew 的 `public/parts/`
2. asset-loader 从 fs 读改为从 Next.js `public/` 目录读（开发时 fs 直读，生产时 fetch URL）
3. 边缘 case：参考图为多帧 sprite sheet 时，逐帧叠加（接受 `frameIndex` 参数，复用 pixabots 已有逻辑）

### 6.5 不移植的部分

- pixabots 的 base36 ID 字符串编码 UI（CLI `avatar` 命令）—— SpriteBrew UI 直接选下拉框即可，不需要短码
- pixabots 的 Python `process_spritesheet.py` —— **TS 重写已在 Phase 3 完成**

### 6.6 验证标准

- 调 `compositeAgentFrame()` 输入一张 base64 角色 + `[{cat: 'top', name: 'horns'}]` → 输出叠加 horns 的 PNG
- 多帧 sprite sheet 输入时，每帧都叠加（不是只叠在第一帧）

---

## 7. Phase 5：Create New 整合改造

### 7.1 修改文件：`src/app/api/generate/route.ts`

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

**`buildCreatePrompt()` 实现**：

- 从 `styleRegistry.ts` 读 `promptPrefix`（新字段，替代 RD 的 `promptStyle`）
- 拼接为 `"{prefix}, {user prompt}, pixel art, {width}x{height}, transparent background"`

### 7.2 修改文件：`src/lib/styleRegistry.ts`

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
  // promptStyle (废弃)
  // costPerGeneration / tokenCost (本地无限额，删除)
  // supportsRemoveBg → 全部默认 true
  // supportsReferenceImages → 全部默认 true（GPT/Gemini 都支持）
}
```

风格条目精简：保留 6-8 个有代表性的（character / item / environment / tile / portrait / animation_walk / animation_idle / animation_attack），删除 RD 专属细分。

### 7.3 新增组件：`src/components/sprites/OutfitPicker.tsx`

UI 结构：

```
[Eyes ▾]   [Heads ▾]   [Body ▾]   [Top ▾]
[None ]    [None  ]    [None ]    [None]
```

- 每个下拉显示部件缩略图 + 名称
- 选中后实时预览（前端 canvas 合成预览，无需调后端）
- 状态存到 `spriteStore`：`outfit: { eyes?: string; heads?: string; body?: string; top?: string }`

### 7.4 修改组件：`src/components/sprites/GenerationForm.tsx`

- 在 Style 选择下方插入 `<OutfitPicker />`（可折叠 "Optional: Outfit"）
- 提交时把 `outfit` 字段加入 POST body

### 7.5 验证标准

- Create New 输入 prompt + 选 outfit → 返回叠加好的 PNG
- 不选 outfit → 行为与现版本一致
- 切换 GPT / Gemini provider，两边都能跑通

---

## 8. Phase 6：Animate My Character 改造

### 8.1 修改文件：`src/app/api/generate/route.ts`

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
  const canvasW = frameCount * 256;  // 每帧画布留 256px 给 AI 发挥
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

### 8.2 修改文件：`src/components/sprites/AnimateForm.tsx`

- 帧数选项收窄到 4/6/8（移除 10/12/16，提示 "Phase 2 will add more"）
- UI 文案更新（移除 "powered by Retro Diffusion"）

### 8.3 验证标准

- 上传一张 64×64 角色 PNG → 选 walking + 6 帧 → 返回 384×64 sprite sheet（6 帧 × 64px）
- 切帧准确率 100%（用合成测试图验证：6 帧每帧不同纯色，能正确分离）
- 角色一致性可接受（人工验收，不要求像 RD 那么完美）

---

## 9. Phase 7：双模式导出

### 9.1 修改文件：`src/lib/exportEngine.ts`

**新增导出格式 `'layered'`**：

```typescript
export interface LayeredExportInput {
  baseSheet: string;          // base64 PNG
  outfit?: Record<string, string>;  // { eyes: 'glasses', top: 'cape', ... }
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  animationName: string;
  fps: number;
}

export async function exportLayered(input: LayeredExportInput): Promise<Blob> {
  // 输出 zip:
  //   base.png
  //   eyes.png, heads.png, body.png, top.png  (按 outfit 选中项)
  //   layout.json  { frames: [{ x, y, w, h }, ...], layerOffsets: { eyes: [{x,y}, ...], ... } }
  //   README.md  (说明如何在 PixiJS / Godot 运行时分层)
}
```

### 9.2 修改 UI：`src/app/export/page.tsx`

新增导出选项卡 **"Layered (Runtime composable)"**，与现有 6 种格式并列。说明文案：

> 输出分层素材包，base 角色 + 每个 outfit 部件独立 PNG + layout.json。
> 适用场景：游戏运行时换装、桌宠动态外观切换。
> 单层使用请选 "TexturePacker JSON Hash" 或 "Aseprite JSON"。

### 9.3 修改：`src/lib/exportEngine.ts` Godot 导出器

新增可选参数 `layered: boolean`：

- `false`（默认）：现有行为，单图 SpriteFrames `.tres`
- `true`：输出多个 SpriteFrames（base + 每个 part），加一个 `character.tscn` 场景文件，预设父子节点结构（`Node2D` 父节点 + N 个 `AnimatedSprite2D` 子节点共享 frame index）

### 9.4 验证标准

- Layered zip 解压后，PixiJS 用 `PIXI.Container` 加载 base + 1 个 outfit 能正确显示
- Godot 导入 layered `.tscn`，运行时 frame index 同步播放

---

## 10. Phase 8：AgentHydration 接入

### 10.1 SpriteBrew 端：新增"AgentHydration 模板"

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
  exportFormat: 'aseprite-json',  // PixiJS v8 native
};

export function buildBatchPrompts(characterDesc: string): Array<{state: string; prompt: string}> {
  // 为 7 个状态各生成一个 prompt
  return AGENT_HYDRATION_STATES.map(state => ({
    state,
    prompt: `${characterDesc}, ${getStatePromptHint(state)}`,
  }));
}
```

### 10.2 SpriteBrew 端：新增 UI 入口

新增页面：`src/app/agent-hydration/page.tsx`

- 输入：角色描述（如 "blue cat with wizard hat"）+ agent type（claude / codex / gemini / default）
- 自动批量调 7 次 generate（每个状态 1 次），并发限制 2
- 进度条 SSE 显示
- 输出：zip 包含 7 个 sprite sheet + 7 个 Aseprite JSON + 1 个 `manifest.json`

`manifest.json` 格式：

```json
{
  "agentType": "claude-code",
  "states": {
    "idle":     { "sheet": "idle.png",     "json": "idle.json",     "fps": 8, "frames": 6 },
    "active":   { "sheet": "active.png",   "json": "active.json",   "fps": 8, "frames": 6 },
    "thinking": { "sheet": "thinking.png", "json": "thinking.json", "fps": 8, "frames": 6 },
    "coding":   { "sheet": "coding.png",   "json": "coding.json",   "fps": 8, "frames": 6 },
    "testing":  { "sheet": "testing.png",  "json": "testing.json",  "fps": 8, "frames": 6 },
    "error":    { "sheet": "error.png",    "json": "error.json",    "fps": 8, "frames": 6 },
    "done":     { "sheet": "done.png",     "json": "done.json",     "fps": 8, "frames": 6 }
  }
}
```

### 10.3 AgentHydration 端：接入修改

> **本节修改的是 `/Users/xujingqi/Projects/AgentHydration` 项目，不是 SpriteBrew。**

#### 新增目录

```
AgentHydration/src/lib/characters/sprites/
├── claude-code/
│   ├── manifest.json
│   ├── idle.png
│   ├── idle.json
│   ├── ... (其余 6 状态)
├── codex-cli/
├── gemini-cli/
└── default/
```

#### 修改：`src/lib/characters/index.ts`

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

#### 修改：`src/components/design/AgentSprite.tsx`

替换 ASCII / Lottie 渲染为 PixiJS `AnimatedSprite`：

```typescript
const sheet = createMemo(() => loadAgentSprite(props.agentType, props.state));
// 渲染 <PixiAnimatedSprite textures={sheet().animations[state]} />
```

### 10.4 验证标准

- 在 SpriteBrew `/agent-hydration` 页面输入 "blue cat" + claude-code → 生成 zip
- 解压到 `AgentHydration/src/lib/characters/sprites/claude-code/` → 启动 AgentHydration → 4 个状态切换正常播放，无明显卡帧

---

## 11. 文件变更总清单

### 新增文件（约 15 个）

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

### 修改文件（约 12 个）

参见 `adaptation-plan.md` 第 7 节 + 本计划各 Phase 涉及文件。重点：

- `src/app/api/generate/route.ts` — 整合所有 phase（去 auth、imageGenAdapter、后处理、部件、Animate 改造）
- `src/lib/styleRegistry.ts` — 字段重设
- `src/lib/exportEngine.ts` — 新增 layered 导出
- `src/components/sprites/GenerationForm.tsx` — 集成 OutfitPicker
- `src/components/sprites/AnimateForm.tsx` — 帧数收窄、文案
- `src/lib/types.ts` — 新增 `Outfit`, `LayeredExportInput` 等类型
- `src/stores/spriteStore.ts` — 新增 outfit 字段

### 删除文件

参见 `adaptation-plan.md` 第 7 节（Stripe / 登录页等）。

### 新增依赖

```bash
npm i sharp image-q
npm i -D @types/sharp
```

---

## 12. 测试与验证

### 12.1 关键路径验证（每个 phase 完成后跑一遍）

| 路径 | 验收标准 |
|---|---|
| Create New + GPT Image 2 | 64×64 角色 PNG，背景透明 |
| Create New + Gemini | 同上，切 env 即生效 |
| Create New + outfit | 角色叠加 horns + cape，无错位 |
| Animate + 6 帧 walking | 384×64 sprite sheet，6 帧角色一致 |
| Layered 导出 | zip 解压含 base + outfit + layout.json |
| Godot `.tres` 导入 | game-simulate 加载播放正常 |
| AgentHydration 批量 | 7 状态 zip 落地后桌宠正常播放 |

### 12.2 不做的测试（v1）

- 自动化单元测试（v1 手动验证即可）
- 跨浏览器兼容（仅 Chrome 验证）
- 性能基准（v1 单用户够用）

---

## 13. 风险与对策

| # | 风险 | 概率 | 对策 |
|---|---|---|---|
| 1 | GPT/Gemini 输出帧间一致性差 | 中 | Phase 6 验证阶段，prompt 不行就降级到 4 帧；保留 RD adapter 作为第三选项 |
| 2 | sharp 在 Next.js 16 build 失败 | 低 | 已知 sharp 与 Next.js 兼容；如失败改用 `@napi-rs/canvas` |
| 3 | pixabots parts PNG 与 AI 生成角色比例不符 | 中 | compositor 已有 `scale` 和 `offsetX/Y` 参数；UI 提供 part 微调控件 |
| 4 | Gemini `transparent background` 仅靠 prompt 不可靠 | 中 | 后处理强制移除背景兜底 |
| 5 | AgentHydration PixiJS 集成与现有 Lottie 冲突 | 低 | 以 feature flag 切换，默认仍走 Lottie，sprite 模式可选启用 |
| 6 | parts 资源 AGPL 兼容性 | 低 | pixabots 是 fork，许可证应已兼容；如不兼容则不拷贝 PNG，仅移植代码 |

---

## 14. 实施顺序建议

```
Day 1：
  ☐ Phase 1（去云依赖，沿用 adaptation-plan.md）
  ☐ Phase 2 上半（imageGenAdapter types + GPT adapter）

Day 2：
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

## 15. 后续 phase 2 候选

- Animate 模式 12/16 帧
- Token 余额持久化（如果多用户场景出现）
- 部件 AI 生成（用户描述 → AI 生成新部件 PNG，加入 catalog）
- 角色风格预设库（保存常用 prompt + outfit 组合）
- WebGL 实时分层预览（替换 canvas 静态预览）

---

*整合 adaptation-plan.md 与 pixabots 工作流，覆盖 AgentHydration + game-simulate 双消费方场景。*
