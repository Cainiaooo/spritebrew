# Codex Pet 系统调研报告

> 调研日期: 2026-05-03
> 调研对象: OpenAI Codex CLI 官方桌面宠物 (Digital Pet) 系统
> 目的: 评估 Codex Pet 的技术方案，提炼可借鉴至 SpriteBrew 的设计

---

## 1. 概述

Codex CLI (openai/codex, 79k+ stars) 是 OpenAI 的终端 AI 编程助手。它的 TUI 内置了一套 **桌面宠物系统**：用户可以通过 `/hatch` 命令，从文字描述或参考图出发，AI 自动生成一个带 9 种动画状态的像素风精灵宠物，在终端里跟随用户编程。

这不是一个独立的宠物游戏，而是**编程助手的陪伴功能**——宠物会根据 Codex 的工作状态（空闲、运行、出错、审查代码等）切换动画。

### 核心仓库

| 仓库 | 说明 |
|------|------|
| [openai/codex](https://github.com/openai/codex) | Codex CLI 官方仓库，Rust + TypeScript |
| [legeling/awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) | 社区精选宠物画廊，**包含完整 hatch-pet skill 源码** |
| [crafter-station/petdex](https://github.com/crafter-station/petdex) (87⭐) | 另一个公开宠物画廊，支持浏览/下载/验证 |
| [Dimava/codex-clippy](https://github.com/Dimava/codex-clippy) | 经典 Clippy 适配 Codex Pet 格式的示例 |
| [zixuanzhou0-ai/codex-pet-director](https://github.com/zixuanzhou0-ai/codex-pet-director) | 中文向导工具，一键安装，交互式创建宠物 |
| codex-pet-share.pages.dev | 社区分享站，449+ 宠物 |

### 本地源码参考

hatch-pet skill 的完整源码已拉取至 `docs/references/codex-pet-hatch-skill/`：

```
docs/references/codex-pet-hatch-skill/
├── SKILL.md                          # 核心规范文档 (22KB，非常详细)
├── LICENSE.txt
├── agents/openai.yaml                # Agent 配置
├── references/
│   ├── codex-pet-contract.md         # 精灵图集契约规范
│   ├── animation-rows.md             # 9行动画状态定义 + 帧时长
│   └── qa-rubric.md                  # QA 验收标准
└── scripts/
    ├── prepare_pet_run.py            # Step 1: 创建工作目录 + 生成 prompt + 布局引导图
    ├── pet_job_status.py             # 查看 imagegen 任务状态
    ├── record_imagegen_result.py     # 记录 AI 生成的图片结果
    ├── generate_pet_images.py        # 备用：直接调 OpenAI API 生成
    ├── extract_strip_frames.py       # Step 2: 从条带中切出单帧 (chroma key 去背景)
    ├── compose_atlas.py              # Step 3: 拼接精灵图集
    ├── finalize_pet_run.py           # Step 4: 最终打包 (验证 + QA + 视频)
    ├── validate_atlas.py             # 图集验证
    ├── inspect_frames.py             # 帧级 QA 检查
    ├── make_contact_sheet.py         # 生成联系表 (所有帧一览)
    ├── derive_running_left_from_running_right.py  # 水平镜像生成
    ├── queue_pet_repairs.py          # 修复队列管理
    ├── package_custom_pet.py         # 打包为 pet.json + spritesheet.webp
    ├── render_animation_videos.py    # 渲染动画预览视频
    └── render_animation_videos.sh
```

---

## 2. 技术架构

### 2.1 Pet 包格式

极致简洁——**只有两个文件**：

```
~/.codex/pets/<pet-name>/
├── pet.json          # 元数据 (~100 bytes)
└── spritesheet.webp  # 精灵图集 (~100-500 KB)
```

**pet.json** 结构：

```json
{
  "id": "mikoto",
  "displayName": "Mikoto",
  "description": "A chibi electric schoolgirl Codex pet.",
  "spritesheetPath": "spritesheet.webp"
}
```

### 2.2 精灵图集规范 (Atlas Contract)

| 属性 | 值 |
|------|-----|
| 尺寸 | 1536 × 1872 px |
| 网格 | 8 列 × 9 行 |
| 单格 | 192 × 208 px |
| 格式 | PNG 或 WebP (无损) |
| 背景 | 透明 (RGBA) |
| 未使用格子 | 必须完全透明 |
| 不允许 | 标签、边框、网格线、阴影超出格子 |

### 2.3 动画状态定义 (9 行固定映射)

| 行 | 状态 | 帧数 | 帧时长 | 用途 |
|----|------|------|--------|------|
| 0 | idle | 6 | 280,110,110,140,140,320ms | 待机呼吸/眨眼循环 |
| 1 | running-right | 8 | 各120ms,末帧220ms | 向右跑动 |
| 2 | running-left | 8 | 各120ms,末帧220ms | 向左跑动（可镜像） |
| 3 | waving | 4 | 各140ms,末帧280ms | 打招呼 |
| 4 | jumping | 5 | 各140ms,末帧280ms | 跳跃 |
| 5 | failed | 8 | 各140ms,末帧240ms | 报错/失落 |
| 6 | waiting | 6 | 各150ms,末帧260ms | 等待 |
| 7 | running | 6 | 各120ms,末帧220ms | 正面/原地跑 |
| 8 | review | 6 | 各150ms,末帧280ms | 审查/思考 |

> 关键设计：每行的**帧时长不同**，且最后一帧通常更长，形成自然的节奏感。这是通过 CSS `animation` 的 `steps()` 函数配合 `background-position` 实现的。

### 2.4 生成流水线

```
用户输入(文字/图片)
       │
       ▼
┌─────────────────────────────────┐
│ prepare_pet_run.py              │  创建工作目录
│ - 生成 pet_request.json         │  - pet 名称/描述
│ - 生成 imagegen-jobs.json       │  - 任务清单 (1 base + 9 rows)
│ - 生成每行 prompt 文件          │  - 每个 prompt 含风格锁定 + 状态约束
│ - 生成 layout-guides/*.png      │  - 每行的帧布局引导图
│ - 自动选择 chroma key           │  - 分析参考图，选最不冲突的背景色
└─────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ $imagegen (AI 图像生成)         │  OpenAI 内置 skill
│ - 1 张 base 参考图              │  - 确定角色外观
│ - 9 张 row-strip 条带           │  - 每张是 N 帧横排的动画条
│ - 子代理并行生成各行             │  - base 完成后，9 行可并行
└─────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ record_imagegen_result.py       │  导入 AI 生成结果
│ - 复制到 decoded/<state>.png    │  - 记录源文件 SHA256
│ - 生成 canonical-base.png      │  - 作为后续行的参考锚点
└─────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ extract_strip_frames.py         │  帧提取
│ - chroma key 去背景             │  - 自动检测色度键阈值
│ - connected components 切帧     │  - 智能识别每个角色实例
│ - fit_to_cell 居中缩放          │  - 缩放到 192×208 格内
│ - 降级: 等宽切槽 (slot)         │  - 如果组件检测失败
└─────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ compose_atlas.py                │  图集拼接
│ - 逐行读取帧文件                │  - 自动查找 state/ 或 row-N/ 目录
│ - 居中粘贴到对应格子            │  - alpha_composite 保持透明
│ - 输出 PNG + 无损 WebP          │
└─────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ finalize_pet_run.py             │  最终验证 + 打包
│ - validate_atlas.py (几何)      │  - 尺寸、透明度、非空格子
│ - inspect_frames.py (帧级 QA)   │  - 帧大小一致性、边距检查
│ - make_contact_sheet.py         │  - 联系表一览
│ - render_animation_videos.py    │  - ffmpeg 动画预览
│ - package_custom_pet.py         │  - 写入 ~/.codex/pets/
└─────────────────────────────────┘
```

---

## 3. 关键技术细节

### 3.1 Prompt 工程 (角色风格锁定)

hatch-pet 的 prompt 设计非常精细，值得深入分析：

**基础风格锁定** (`DIGITAL_PET_STYLE`)：

> Codex digital pet sprite style: pixel-art-adjacent low-resolution mascot sprite, compact chibi proportions, chunky whole-body silhouette, thick dark 1-2 px outline, visible stepped/pixel edges, limited palette, flat cel shading with at most one small highlight and one shadow step, simple readable face, tiny limbs...

**行级 prompt 模板** (`row_prompt()`)，每个 prompt 包含：

1. **Identity Lock（身份锁定）**：明确要求"不要重新设计角色，只改变姿势"
2. **State Requirements（状态约束）**：每个状态有禁止画什么的规定
3. **Transparency Artifact Rules（透明度规则）**：禁止浮动特效、阴影、运动线等
4. **Layout Requirements（布局约束）**：帧数、间距、居中、安全边距

这个 prompt 工程的核心理念是：**用否定约束来防止 AI 做多余的事**。比如 waving 状态禁止画"波浪线、运动弧线"，running 禁止画"速度线、灰尘云"。

### 3.2 Chroma Key 背景去除

不是用 AI 自动去背景，而是**让 AI 在指定颜色的纯色背景上画**，然后用脚本精确去除：

```python
# prepare_pet_run.py - 自动选择 chroma key
CHROMA_KEY_CANDIDATES = [
    ("magenta", "#FF00FF"),
    ("cyan", "#00FFFF"),
    ("yellow", "#FFFF00"),
    ("blue", "#0000FF"),
    ("orange", "#FF7F00"),
    ("green", "#00FF00"),
]

# 采样参考图像素，计算每个候选色与所有像素的距离
# 选择 1st percentile 距离最大的那个（最不冲突）
```

```python
# extract_strip_frames.py - 去背景
def remove_chroma_background(image, chroma_key, threshold=96.0):
    # 逐像素计算欧氏距离，阈值内的设为透明
    for y, x in image:
        if color_distance(rgb, chroma_key) <= threshold:
            pixels[x, y] = (r, g, b, 0)
```

**为什么不用 AI 自动去背景？**
- 确定性：脚本的结果是可重复的
- 精确性：不会误删角色身上的颜色
- 可控性：threshold 可以调整

### 3.3 Connected Components 帧提取

这是最有趣的算法——当 AI 生成的条带中角色之间没有明确分隔线时，通过连通域分析自动找到每个角色：

```
输入: 一张包含多个角色的横条
  ┌─────┬─────┬─────┬─────┐
  │ 🐱  │ 🐱  │ 🐱  │ 🐱  │  (但可能没有格子线)
  └─────┴─────┴─────┴─────┘

算法:
1. 扫描 alpha 通道，找所有非透明像素的连通域
2. 按面积排序，取前 N 个最大连通域（N=目标帧数）
3. 按 centerX 排序，保证从左到右
4. 将剩余小碎片分配给最近的种子连通域
5. 每组裁剪 → fit_to_cell → 保存
```

如果连通域检测失败（比如角色之间有重叠），降级为等宽切槽。

### 3.4 镜像策略 (running-left)

`running-left` 可以从 `running-right` 水平翻转得到，但**需要人工确认**：

```python
# 只有在以下条件都满足时才能镜像:
# - 角色左右对称
# - 没有单侧标记/文字/道具
# - 翻转后语义不会变（比如右指→左指就不行）
```

如果不对称，就老老实实单独生成。

### 3.5 子代理并行生成

base 完成后，9 行动画通过**子代理并行生成**：

```
parent agent:
  1. prepare_pet_run.py
  2. generate + record base
  3. spawn subagent → idle
  4. spawn subagent → running-right
  5. record idle + running-right results
  6. decide: mirror running-left? or spawn subagent
  7. spawn subagents → remaining rows (parallel)
  8. record all results
  9. finalize_pet_run.py
```

每个子代理只负责一个 row，返回选中的图片路径和一句话 QA 备注。父代理拥有 manifest 的唯一写权限。

### 3.6 QA 验收体系

三层验证：

| 层 | 工具 | 检查内容 |
|----|------|----------|
| 几何 | `validate_atlas.py` | 尺寸 1536×1872、透明通道、非空格子、未用格子透明 |
| 帧 | `inspect_frames.py` | 帧大小一致性、边距、组件提取 vs 槽提取 |
| 人工 | `contact-sheet` | 角色一致性、风格一致性、动画流畅度 |

验收标准 (`qa-rubric.md`) 是非常严格的检查清单，包括：
- 首尾帧能无缝循环
- 方向性行读起来方向正确
- 没有重复帧（同一张图的几何变换）
- 联系表不能是参考图的裁剪拼接

---

## 4. 与 SpriteBrew 的对比分析

### 4.1 相似点

| 维度 | Codex Pet | SpriteBrew |
|------|-----------|------------|
| 核心流程 | AI 生成 → 切帧 → 拼接图集 | AI 生成 → 切帧 → 后处理 → 拼接图集 |
| 图集概念 | 单张 8×9 atlas | 单张 spritesheet（水平拼接） |
| 风格要求 | 像素风 chibi，有明确否定约束 | styleRegistry 定义 8 种风格，promptPrefix + paletteColors |
| 导出格式 | pet.json + spritesheet.webp | Godot .tres / Aseprite JSON / layered zip / Agent Pack zip |
| 动画状态 | 9 种固定状态（编程场景） | 自定义动作类型 + AgentHydration 7 状态（编程场景） |

### 4.2 关键差异

| 维度 | Codex Pet | SpriteBrew (Phase 1-8 后) |
|------|-----------|------------|
| **AI 后端** | OpenAI $imagegen (内置 skill) | GPT Image 2 / Gemini 双后端，支持 relay proxy |
| **背景去除** | Chroma key + 脚本（确定性） | Corner-sample 四角采样去背景 + 色距阈值（postProcess.ts） |
| **帧提取** | Connected components（智能） | 2D grid 布局 + 等宽切分（SliceLayout cols×rows），prompt 约束 AI 按网格排列 |
| **图集规格** | 固定 1536×1872 (8×9×192×208) | 用户自定义帧数，自动选 canvas（4→2×2, 6→3×2, 8→4×2） |
| **Prompt 工程** | 极其精细，每行有否定约束列表 | styleRegistry 定义 promptPrefix + paletteColors；AgentHydration 有 per-state prompt suffix |
| **角色一致性** | Identity Lock + canonical base 参考 | ImageGenAdapter.editWithReference() 支持参考图；Animate 模式用 create 图做 reference |
| **QA 验证** | 三层自动化 + 人工联系表 | 无自动化 QA（仅有后处理 pipeline） |
| **并行生成** | 子代理并行 9 行 | Animate 单次串行；AgentHydration 顺序批生成（v1 单帧/状态） |
| **用途** | 终端桌面宠物（9 状态编程伴侣） | 游戏角色资产生成 + Agent Hydration（7 状态编程伴侣） |

---

## 5. 可借鉴内容

### 5.1 🔴 高优先级（直接可用）

#### (1) Prompt 工程模板 ✅ 部分采纳

Codex Pet 的 prompt 模板是目前见过的**最精细的像素角色生成 prompt**，尤其是：

- **Identity Lock 机制**：先生成一张 base 参考图，后续所有动画行都"锁定"在这张图的外观上。这直接解决了 SpriteBrew 生成动画时角色外观漂移的问题。
- **否定约束列表**：每个状态有明确的"不要画什么"规则。这种"用否定约束防止 AI 过度创作"的思路，可以直接复用到 SpriteBrew 的 prompt 构建中。
- **风格锁定字符串**：`DIGITAL_PET_STYLE` 的写法值得参考——用一段固定文本定义风格基线，用户 notes 附加在后面。

**现状**：SpriteBrew 已有 `styleRegistry`（8 种风格的 `promptPrefix` + `paletteColors`）和 AgentHydration 的 `STATE_PROMPT_SUFFIX`（per-state prompt）。`editWithReference()` 接口也支持参考图注入。

**剩余差距**：
- 缺少 Codex Pet 级别的**否定约束**（如"禁止速度线、阴影、运动线"等）
- Animate 模式尚未利用 `editWithReference()` 实现 identity lock
- styleRegistry 的 promptPrefix 可借鉴 `DIGITAL_PET_STYLE` 的"是什么/不是什么"写法

#### (2) Chroma Key 背景去除管线 ⏩ 已用替代方案

SpriteBrew 当前依赖 Retro Diffusion API 的透明背景输出，如果未来切换到其他 AI 后端（比如自托管模型），就需要自己处理背景去除。

`extract_strip_frames.py` 的 chroma key 方案是确定性的、可重复的、可调参的。`choose_chroma_key()` 的自动选色算法（分析参考图像素，选最不冲突的背景色）尤其巧妙。

**现状**：`postProcess.ts` 已实现 **corner-sample bg removal**——采样四角像素取均值作为背景色，色距阈值内的设为透明。这与 chroma key 的核心思路一致（确定性脚本去背景），但更简洁（无需预先选色）。

**剩余差距**：
- corner-sample 对复杂背景（渐变、图案）不如 chroma key 精确
- 未实现 Codex Pet 的 `choose_chroma_key()` 自动选色（prompt 端控制背景色）
- GPT Image 2 的 `background: 'transparent'` 已不可用，corner-sample 成为唯一去背景手段

#### (3) Connected Components 智能帧提取 ⏩ 已用替代方案

SpriteBrew 的 SlicerConfig 是用户手动配置格子大小和偏移，然后等宽切分。Codex Pet 的 `extract_component_frames()` 可以在没有格子线的情况下自动找到每个角色。

这个算法的核心思路：
1. 连通域分析找所有角色
2. 按面积取前 N 个种子
3. 按 centerX 排序
4. 碎片分配给最近种子
5. 裁剪 → 缩放 → 居中

**现状**：`spritesheetSlicer.ts` 已改为 **2D grid 布局**（SliceLayout cols×rows），prompt 中明确告知 AI 帧的排列方式（如"3×2 grid, reading order"），然后等宽切分。这相当于把"智能检测"的问题转嫁给了 prompt 工程——AI 被要求按网格排列，切分只需等宽。

**剩余差距**：
- 如果 AI 不遵守网格排列，等宽切分会失败
- connected components 作为降级方案仍有价值（AI 偏离布局时自动修正）

### 5.2 🟡 中优先级（需要适配）

#### (4) 自动化 QA 验证

`validate_atlas.py` + `inspect_frames.py` + `qa-rubric.md` 构成了一套完整的自动化 QA 体系。SpriteBrew 目前没有任何生成后的自动验证。

**建议**：为 SpriteBrew 增加"生成后自动检查"：
- 图集尺寸和非空检查 (from `validate_atlas.py`)
- 帧大小一致性检查 (from `inspect_frames.py`)
- 联系表预览 (from `make_contact_sheet.py`)
- 这些检查可以在 `/export` 页面导出前自动运行

#### (5) 布局引导图 (Layout Guides) ⏩ 已部分实现

`prepare_pet_run.py` 会生成每行动画的布局引导图——显示帧数、格子大小、安全边距、中心十字线。这个引导图作为"不可见参考"传给 AI，帮助 AI 正确放置角色。

**现状**：`route.ts` 的 `buildAnimatePrompt()` 已在 prompt 中**文字描述**布局（如"arrange 6 frames in a 3×2 grid"），但未生成实际的引导图。

**剩余差距**：
- 纯文字描述 vs 视觉引导图——后者对 AI 的约束更强
- 可考虑生成简单的 grid guide PNG 作为参考图附加

#### (6) 子代理并行生成

Codex Pet 在 base 完成后并行生成 9 行动画，大幅缩短总生成时间。SpriteBrew 目前是单次串行。

**现状**：Animate 模式单次串行；AgentHydration 是顺序批生成（v1 单帧/状态，7 次顺序调用）。

**建议**：中期考虑引入并行生成。在 Next.js 中可以用 `Promise.all` 同时发起多个 API 请求。需要注意 token 消耗和 API 限流。

### 5.3 🟢 低优先级（长期参考）

#### (7) Pet 包格式 (极简分发)

两个文件就定义了一个完整的动画宠物。这种极简的分发格式值得思考——SpriteBrew 导出的 Godot .tres 文件目前也类似（一个 .tres + 一张 spritesheet.png）。

#### (8) 社区画廊生态

codex-pet-share、petdex、awesome-codex-pet 三个社区站形成了一个小型生态。SpriteBrew 有 gallery 功能，可以参考这种"生成 → 分享 → 画廊"的模式。

#### (9) 修复管线 (Repair Pipeline)

`queue_pet_repairs.py` 实现了"只重新生成失败行"的能力，不需要从头来。SpriteBrew 如果生成结果不理想，目前只能重新生成全部。

---

## 6. 具体改进建议

### Phase 1: Prompt 工程（立即可做）

1. **Identity Lock for Animate Mode** ⏩ 接口就绪：在 Animate My Character 流程中，用户上传的角色图作为 `canonical base`，每个动画帧的 prompt 中注入 identity lock 段落。`editWithReference()` 已可用，需要接入 Animate 流程。

2. **否定约束注入**：根据动画类型，在 prompt 中自动附加"不要画什么"规则。例如 walk 动画禁止速度线和灰尘，attack 动画禁止 UI 元素等。AgentHydration 的 `STATE_PROMPT_SUFFIX` 是一个起点，但缺少否定约束。

3. **风格基线定义**：参考 `DIGITAL_PET_STYLE` 的写法，为 SpriteBrew 的每种 prompt_style 定义一段明确的"是什么/不是什么"风格描述。

### Phase 2: 后处理管线（短期）

4. **Chroma Key 去背景选项** ⏩ 已有替代：`postProcess.ts` 已实现 corner-sample 去背景。可选增强：加入 Codex Pet 的 `choose_chroma_key()` 在 prompt 端控制背景色，提高去背景精确度。

5. **智能切分模式** ⏩ 已有替代：`spritesheetSlicer.ts` 已改为 2D grid + prompt 约束。可选增强：加入 connected components 作为降级方案。

6. **导出前自动验证**：在 export 流程中增加几何验证（尺寸、非空、透明度）和联系表预览。

### Phase 3: 生成优化（中期）

7. **布局引导图** ⏩ 已部分实现：prompt 中已有文字描述布局。可选增强：生成视觉 grid guide PNG。

8. **并行帧生成**：支持同时生成多个动画帧，缩短等待时间。

9. **单行修复**：支持只重新生成不满意的特定帧或动画行。

---

## 7. 重要发现：AgentHydration 与 Codex Pet 的高度相似性

Phase 8 引入的 **AgentHydration** 功能与 Codex Pet 在概念上高度相似，但实现路径不同：

| 维度 | Codex Pet | AgentHydration |
|------|-----------|----------------|
| 状态数 | 9 (idle, running×3, waving, jumping, failed, waiting, review) | 7 (idle, active, thinking, coding, testing, error, done) |
| 帧数/状态 | 4-8 帧动画 | v1 单帧（静态） |
| 生成方式 | 9 行并行子代理 | 顺序批生成 |
| 角色 | 终端编程宠物 | IDE/工具编程助手形象 |
| Agent 类型 | 仅 Codex | claude-code / codex-cli / gemini-cli / default |
| 导出 | pet.json + spritesheet.webp | per-state PNG + Aseprite JSON + manifest.json + zip |

**关键观察**：
- AgentHydration 的状态设计**覆盖了 Codex Pet 的大部分语义**（idle ↔ idle, active ↔ running, error ↔ failed, thinking ↔ review），但增加了 coding/testing/done 等**编程特化**状态
- v1 只有单帧，动画是明确 deferred 的——说明跨状态的角色一致性（即 Codex Pet 的 identity lock 问题）已经被认识到是难点
- AgentHydration 支持**多种 Agent 类型**（claude-code, codex-cli, gemini-cli），这比 Codex Pet 只服务 Codex CLI 更通用
- 两者的 prompt 模式类似：base character description + per-state suffix

**SpriteBrew 可从 Codex Pet 借鉴来改进 AgentHydration**：
1. 引入否定约束到 `STATE_PROMPT_SUFFIX`（如 coding 状态禁止画"波浪线"）
2. v2 动画化时，参考 Codex Pet 的 identity lock 机制确保跨状态角色一致
3. 参考子代理并行生成模式，加速 7 状态批生成

---

## 8. 附录：关键代码索引

| 文件 | 核心价值 | 行数 |
|------|----------|------|
| `SKILL.md` | 完整规范 + prompt 模板 + 工作流 | ~600 |
| `prepare_pet_run.py` | prompt 生成 + chroma key 自动选色 + 布局引导图 | 674 |
| `extract_strip_frames.py` | connected components 帧提取 + chroma key 去背景 | 324 |
| `compose_atlas.py` | 图集拼接（居中、透明合成） | 151 |
| `validate_atlas.py` | 自动化几何验证 | 140 |
| `finalize_pet_run.py` | 完整打包流水线（验证+QA+视频+安装） | 383 |
| `codex-pet-contract.md` | 精灵图集契约规范 | ~30 |
| `animation-rows.md` | 9 行动画状态 + 帧时长定义 | ~30 |
| `qa-rubric.md` | 人工验收检查清单 | 61 |

所有源码位于 `docs/references/codex-pet-hatch-skill/`，来自 [legeling/awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) 仓库 (MIT License)。
