# SpriteBrew 使用与测试指南（本地版）

> 适用于：Phase 1–8 + 网格布局优化全部合入后的本地单用户构建。
> 最后更新：2026-04-30

---

## 1. 环境准备

### 1.1 依赖

```bash
npm install
```

会安装：`sharp`、`image-q`、`jszip`、`zustand`、`pixi.js` 等。如果首次安装 sharp 失败，多半是平台原生包问题；macOS arm64 / x64 都已验证。

### 1.2 `.env.local`

在仓库根目录创建 `.env.local`（已在 `.gitignore`，不会被提交）：

```env
# 二选一：决定调哪家后端
IMAGE_GEN_API_PROVIDER=gpt-image      # 或 gemini

# GPT Image 2（OpenAI gpt-image-1）
OPENAI_API_KEY=sk-...

# Gemini Nano Banana（gemini-2.5-flash-image）
GEMINI_API_KEY=...
```

**只配你要用的那家**就行，另一家可以留空。两家都配的话以 `IMAGE_GEN_API_PROVIDER` 为准。

> 老的 `RETRO_DIFFUSION_API_KEY` / Clerk / Stripe 全部不需要 —— Phase 1 已经清理掉了。

### 1.3 启动

```bash
npm run dev
# 默认 http://localhost:3000
```

第一次启动会经过 Next.js 16 Turbopack 的全量编译，~5 秒。后续 HMR 秒级。

切换 provider 不需要重启 server —— `IMAGE_GEN_API_PROVIDER` 是按请求读取的，改完 `.env.local` 直接刷新页面就行。

---

## 2. 主要功能与对应路径

| 路径 | 功能 | 后端调用 |
|---|---|---|
| `/` | 本地落地页 | — |
| `/generate` | Create New + Animate My Character（双 tab）| `/api/generate` |
| `/upload` | 上传 sprite sheet 并切片 | 纯前端 |
| `/preview` | PixiJS 实时预览 | 纯前端 |
| `/export` | 6 种导出格式（含新加的 Layered）| 纯前端 |
| `/gallery` | 本地生成历史 | localStorage |
| `/agent-hydration` | AgentHydration 7 状态批量包 | `/api/generate` ×7 |

---

## 3. Create New 流程

打开 `/generate`，默认 tab 是 **Create New**。

### 3.1 输入

- **Prompt**：自然语言描述，例如 `pixel art knight with sword`。
- **Style**：8 个内置 style，分布在 6 个 category。每个 style 自带 `promptPrefix`（自动拼到用户 prompt 前）和 `paletteColors`（后处理调色板色数）。
- **Reference images**（可选）：上传 1–4 张 PNG（base64，无 data: 前缀），会被送进 `images.edits` 端点作为风格参考。
- **Size**：style 默认值，可在 `minSize–maxSize` 范围内自定义。最终输出像素由后处理器降采样到这个尺寸。
- **Remove background**：默认开。后处理器会用四角采样 + RGB 距离阈值去除背景。
- **Outfit (Optional)** ← 新功能：可选 4 类（eyes / heads / body / top）pixabots 部件叠加，AI 生成完后服务端用 sharp 合成。

### 3.2 流水线

```
用户 prompt + style.promptPrefix + ${w}x${h} 提示
        ↓
gptImage / gemini → 1024² / 1536×1024 / 1024×1536（按 aspect ratio 自动选）
        ↓
postProcessSprite：
  1. 四角采样去背景
  2. trim 到内容 bbox
  3. extend 到正方形 (max(w,h)×max(w,h))
  4. nearest-neighbor 降采样到 ${w}×${h}
  5. （如果 style.paletteColors 设置了）image-q 调色板量化
        ↓
若有 outfit → applyOutfitBase64（sharp 叠加 PNG）
        ↓
返回 data:image/png;base64,...
```

### 3.3 测试要点

- **背景透明**：生成后用浏览器 DevTools 看像素 alpha，应该是 0。如果出现淡淡的边缘色，说明 corner-sample 阈值（默认 30）偏低 —— 调 `postProcess.ts` 里的 `bgTolerance` 参数（route 里没暴露这个开关，需要改源码）。
- **风格一致性**：`promptPrefix` 是单一来源，想调风格语气就改 `src/lib/styleRegistry.ts` 对应条目的 `promptPrefix`。
- **Outfit 叠加位置**：pixabots 的部件原生是 32×32，叠加时 sharp 会用 nearest 缩放到目标 frame size。如果叠加后部件位置不对（比如 horns 飞到肚子上），是因为 AI 角色和 pixabots 部件的"头部锚点"不一致 —— 这是已知风险（plan §12 #3）。先验证 horns / antenna / wings 这几个简单的。

---

## 4. Animate My Character 流程

`/generate` → 切到 **Animate My Character** tab。

### 4.1 输入

- **角色 PNG**：任意尺寸，pipeline 会 auto-prep 到选的分辨率。
- **Resolution**：32 / 64 / 128 / 256（4 档）。
- **Action**：8 个预设（walking / idle / attack / jump / crouch / destroy / subtle_motion / custom_action）。
- **Frame count**：4 / 6 / 8（v1 范围）。
- **Motion description**（可选）：极短的补充提示。custom_action 必填。

### 4.2 网格布局（重点优化）

| Frames | 网格 | 画布 | 单格源像素 |
|---|---|---|---|
| 4 | 2×2 | 1024×1024 | 512×512 |
| 6 | 3×2 | 1536×1024 | 512×512 |
| 8 | 4×2 | 1536×1024 | 384×512 |

旧版单排 1536px（每格 ~170px）→ 新网格（每格 ~512px），同等 API 成本下源像素提升 ~9 倍。降采样到 64×64 时画质明显更干净。

### 4.3 流水线

```
inputImage (base64, RGB) + action prompt + 网格布局描述
        ↓
adapter.editWithReference({ canvasSize: layout.canvasW × canvasH })
        ↓
detectAndSliceFrames(rawB64, { cols, rows }, frameCount, frameSize)
  按 reading order（左→右，上→下）逐格 extract → postProcess → 输出 N 个 base64 帧
        ↓
composeFramesHorizontally → 横向 sprite strip (frameCount × frameSize, frameSize)
        ↓
若有 outfit → applyOutfitToSheet（每帧逐一叠加，支持 blink / sequence sub-animation）
        ↓
返回 data:image/png;base64,...
```

### 4.4 测试要点

- **网格读取顺序**：模型输出的应该是 `[frame0, frame1, frame2 / frame3, frame4, frame5]` 这种 3×2。**最重要的验证**：6 帧 walking 输出后，逐帧看是不是连续的步态周期（左脚→右脚→左脚...）。如果顺序乱了，说明模型没按 reading order 排版 → 在 prompt 里再加一句强调。
- **跨帧一致性**：角色颜色、比例、装备应该完全一致。如果第 3 帧角色突然变胖了或换了帽子，说明 prompt 里"identical across all frames"的约束没起作用 → 考虑 reference image 里多放几张同角色的关键帧。
- **8 帧上限**：384×512 是非正方形单格，post-process 会 pad 成 512×512 正方形再降采样，所以最终输出仍然是正方形 frame。但 8 帧下模型一致性会比 4/6 帧更难维持，建议先验证 4 frames。
- **背景去除**：网格之间的"格子边界"如果有可见线条，说明模型把网格当成了画面元素 —— 看 raw 输出图像（postProcess 之前）确认。

---

## 5. Outfit Picker（新功能）

GenerationForm 下方折叠面板"Outfit (optional)"。点开后 4 个下拉：

- **Eyes**（16 个）：含静态、blink（2 帧）、sequence（多帧）三类
- **Heads / Hat**（8 个）：全部静态
- **Body**（7 个）：全部静态
- **Top**（12 个）：全部静态

部件 PNG 在 `public/parts/{category}/` 下，从 pixabots `art/png/` 整套拷过来的。

**叠加规则**（`src/lib/parts/compositor.ts`）：
- 服务端 sharp 合成。
- 顺序 bottom→top：`top` → `body` → `heads` → `eyes`（眼睛永远在最上层）。
- 部件原生 32×32，被 nearest 缩放到目标 frame size。
- 多帧部件（blink / sequence）按 frame index 解析子帧；目前 blink 写死成"每 8 帧闭一次"，sequence 走模 N。

清空 outfit：点击折叠面板里的 "Clear all"。

---

## 6. Layered Export（新增导出格式）

`/export` → 选 **Layered (Runtime)** 卡片。

输出是一个 zip，含：

```
{name}_layered.zip
├── base.png          ← 当前 frameDataUrls 拼成的网格 sheet
├── parts/
│   ├── eyes.png      ← 选中部件第一帧，缩放到 frameSize × frameSize
│   ├── heads.png
│   ├── body.png
│   └── top.png       ← 仅包含被选中的 category
├── layout.json       ← 帧布局 + 动画 tag + 部件元数据
└── README.md         ← 运行时合成说明
```

**重要 caveat**（v1 限制）：`base.png` 是**已合成 outfit 的 sheet**，不是 outfit-stripped base。要拿到真正的"裸 base + 可换装"，目前需要：先用空 outfit 生成一次 → 在 export 页面手动选 outfit → Layered 导出。这样导出包里的 `base.png` 是没有 outfit 的，`parts/*.png` 是你想叠的。

要彻底解决这个限制需要把"pre-outfit base buffer"沿 slice/edit pipeline 一路传到 export，是个不小的改动 —— 留到下个 phase。

---

## 7. AgentHydration 包生成器（新增页面）

`/agent-hydration`：单页面流程。

### 7.1 输入

- **Character description**（文本，必填）：例如 `blue robot cat with antenna`。
- **Agent type**：`claude-code` / `codex-cli` / `gemini-cli` / `default`。

### 7.2 流程

按下"Generate 7-state pack"后，顺序触发 7 次 `mode: 'create'`，每次 prompt = `${模板.promptPrefix}, ${用户描述}, ${state suffix}`。

7 个 state 对应的 suffix（在 `src/lib/templates/agentHydration.ts`）：

| state | suffix |
|---|---|
| idle | in idle standing pose, neutral expression |
| active | in alert active pose, eyes open wide |
| thinking | thinking pose, hand on chin, contemplative |
| coding | typing on a small keyboard, focused |
| testing | holding a magnifying glass, inspecting |
| error | distressed expression, X marks for eyes |
| done | celebrating with arms raised, happy |

每完成一个 state，UI 立刻更新对应卡片的预览。失败的 state 会显示红色 error icon，但不影响其他 state 继续跑。

### 7.3 输出 zip

```
agent-hydration_{agentType}.zip
├── idle.png + idle.json
├── active.png + active.json
├── ...
├── done.png + done.json
├── manifest.json    ← agentType / description / template / states 索引
└── README.md
```

每个 `*.json` 是 Aseprite 格式，含 `frames[]` + `meta.frameTags`。AgentHydration 项目侧的 PixiJS 集成（plan §9.3）尚未做 —— 这次只交付 SpriteBrew 端的导出。

### 7.4 测试要点

- v1 是**单帧每 state**（`framesPerState: 1`）。如果你想要 7 个 state 都是 6 帧动画，得改模板 + 改 page 用 mode='animate'，目前 deferred。
- 7 次串行调 GPT Image / Gemini，单次 ~10s，全跑完约 1 分钟。中途关页面会丢进度。

---

## 8. Provider 切换（GPT vs Gemini）

```bash
# 切到 Gemini
echo 'IMAGE_GEN_API_PROVIDER=gemini' > .env.local
echo 'GEMINI_API_KEY=AIza...' >> .env.local

# 切回 GPT Image
echo 'IMAGE_GEN_API_PROVIDER=gpt-image' > .env.local
echo 'OPENAI_API_KEY=sk-...' >> .env.local
```

**两家差异**（实测时关注）：

| 项 | gpt-image-1 | gemini-2.5-flash-image |
|---|---|---|
| 画布尺寸 | 仅 1024² / 1536×1024 / 1024×1536 | 自适应（通常 1024²，可能因 prompt 不同变化）|
| 透明背景 | API 参数 `background: 'transparent'` 直接控 | 只能在 prompt 里要求，需要 postProcess 兜底 |
| Reference image | 走 `/v1/images/edits`（multipart）| 走同一个 `:generateContent`，inline_data 数组 |
| 一致性 | 较稳，尤其多帧动画 | 稍弱，但提示工程余地更大 |
| 成本 | 1024² medium ≈ $0.042/张 | $0.039/张（撰写时）|

切换之后建议：
1. 先在 Create New 跑一张静态 sprite 看背景透明度。
2. 再在 Animate 跑一个 4 帧 walking，对比帧间一致性。
3. 切 6 帧 walking 看网格读取顺序。

---

## 9. 测试清单（建议覆盖顺序）

按以下顺序测，每步出问题先解决再继续：

1. **build 通过**：`npx tsc --noEmit && npm run build`（应该全绿）。
2. **provider 启动**：dev 模式打开 `/generate`，选默认 style，prompt = `pixel art knight with sword`，生成 → 看是否返回图片。
3. **postProcess 透明度**：把上一张 PNG 拖进图片预览器（透明背景应该是 checkerboard）。
4. **Reference image**：上传一张参考 PNG，再生成，看是否风格被参考影响。
5. **Outfit picker**：打开 outfit，选 `top: horns`，生成 → 角色头上应该有 horns。
6. **Animate 4 帧**：上传一张 64×64 角色 PNG，selectAction = walking，frames = 4 → 输出应是 256×64 sprite strip，4 帧步态连续。
7. **Animate 6 帧**：同上，frames = 6 → 384×64 strip，**重点验证 reading order**（看 frame 3 是不是步态第 4 帧，不是第 1 帧）。
8. **Animate 8 帧**：同上，frames = 8 → 512×64。一致性可能下降，记录现象。
9. **Layered export**：`/export` → Layered → 下载 zip → 解压看 base.png + parts/ + layout.json。
10. **Godot `.tres`**：同上但选 Godot SpriteFrames，导入到 Godot 4 工程看是否能用。
11. **AgentHydration 包**：`/agent-hydration` → 输入 `blue cat` + `claude-code` → 跑完 7 个 → 下载 zip → 解压看结构。
12. **Provider 切换**：改 `.env.local` 切到 Gemini，重复步骤 2、5、7。

---

## 10. 已知问题 / 排错

### 10.1 SSE 连接断在 ~30s
本地 Next.js dev server 没有 Cloudflare 那 120s 限制，但 GPT Image 单次生成有时 >30s。如果浏览器超时，看 dev server 日志确认实际请求是否完成 → 如完成但前端没收到，是 fetch 超时；可以把浏览器 timeout 调长。

### 10.2 sharp 报 `vips_image_set_progress` 错
某些早期 sharp 版本 + macOS 14 有冲突。当前锁定 `sharp@^0.34.5` 已验证 OK。报错就：

```bash
rm -rf node_modules/sharp && npm install
```

### 10.3 Gemini 返回空 image data
`gemini-2.5-flash-image` 偶尔会只返回 text 而不返回 inline_data，特别是 prompt 含敏感词时。报错信息会是 `Gemini returned no inline image data.`。换个描述再试，或切到 gpt-image。

### 10.4 透明背景没去干净
`postProcess.ts` 默认 `bgTolerance: 30`。如果生成的角色边缘有彩色光晕，调高到 50–60；如果角色本身的颜色被误清掉，调低到 20。这个值目前没暴露到 UI，要改源码。

### 10.5 Outfit 部件位置错位
v1 直接用 nearest 把 32×32 部件缩放到 frameSize，居中叠加在 frame 左上角（offset 0,0）。AI 角色头部如果不在 frame 顶部中央，horns / hat 会"飞起来"。

短期 workaround：选低风险部件先（horns / antenna / heart 这种位置不敏感的）。
长期方案：在 compositor 里加每个 part 的"建议 anchor offset"配置，按 part 类型调整 y 位置。

### 10.6 Animate 输出 frame 顺序错乱
说明模型没按 reading order 排网格。优先级处理：

1. 先确认 raw API 返回的图（看 `route.ts` 里临时 `console.log(raw.rawBase64Image.slice(0,50))` 加调试）是不是网格，不是的话 prompt 没生效。
2. 是网格但顺序错（比如顺时针）→ 在 `buildAnimatePrompt` 加更具体的 "first cell is top-left, second cell is to its right, ..." 描述。
3. 是网格但帧之间内容乱跳 → 一致性问题，与排序无关，看 §10.7。

### 10.7 跨帧一致性差（角色变形）
现象：6 帧 walking，每帧角色长得像不同人。原因是模型对单图内的 6 个 cell 没法保持一致。

按效果递增地试：
1. 在 motion description 里加 "exact same character"。
2. 把上传的角色 PNG 用 ReferenceImagesPanel 加一遍（如果是 mode='create' 而不是 animate 的话）。
3. 降到 4 帧 —— 4 帧一致性远好于 8 帧。
4. 先生成 1 帧 idle，把它作为"标准帧"，再用它作为 animate 的 input。

---

## 11. 修改源码后的常用回归

```bash
npx tsc --noEmit         # 类型
NODE_OPTIONS= npm run build   # full build
npm run lint             # ESLint
```

`NODE_OPTIONS=` 那个空赋值是 workaround：本地 zsh 默认 `NODE_OPTIONS=--max-old-space-size=...` 在 Next.js 16 turbopack 下会报 deprecation warning，传空字符串绕开。

---

## 12. 文件速查

| 想改这个 | 改这个文件 |
|---|---|
| 添加新 generation style | `src/lib/styleRegistry.ts` 的 `GENERATION_STYLES` 数组 |
| 改 Create New prompt 模板 | `src/app/api/generate/route.ts` 的 `buildCreatePrompt` |
| 改 Animate prompt 模板 | `src/app/api/generate/route.ts` 的 `buildAnimatePrompt` |
| 改网格布局（cols × rows） | `src/app/api/generate/route.ts` 的 `pickAnimationLayout` |
| 改背景去除阈值 | `src/lib/imageGen/postProcess.ts` 的 `bgTolerance` |
| 加新部件 | `public/parts/{cat}/{name}.png` + 在 `src/lib/parts/catalog.ts` 数组**末尾**追加（绝不重排）|
| 改 AgentHydration state suffix | `src/lib/templates/agentHydration.ts` 的 `STATE_PROMPT_SUFFIX` |
| 切 provider 默认值 | `.env.local` 的 `IMAGE_GEN_API_PROVIDER`（不需要改代码）|

---

*本文档配合 `docs/integration-plan.md` 使用 —— 那份是设计与历史，本份是测试与运维。*
