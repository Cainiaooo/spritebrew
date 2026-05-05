# Codex Pet 系统调研报告

> 调研日期: 2026-05-03 | 更新: 2026-05-05 (补充 §3.6-3.13 设计原则；§5 重排 + 加 工作量/验收 + 新增 Codex Pet 导出方向)
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
├── agents/openai.yaml                # UI 入口清单（display name + default prompt，不含模型配方）
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

## 2. 技术架构 (Codex Pet 侧)

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

> 关键设计：每行的**帧时长不同**，且最后一帧通常更长，形成自然的节奏感。通过 CSS `steps()` + `background-position` 实现。

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

## 3. 关键技术细节 (Codex Pet 侧)

### 3.1 Prompt 工程 (角色风格锁定)

hatch-pet 的 prompt 设计非常精细，值得深入分析：

**基础风格锁定** (`DIGITAL_PET_STYLE`)：

> Codex digital pet sprite style: pixel-art-adjacent low-resolution mascot sprite, compact chibi proportions, chunky whole-body silhouette, thick dark 1-2 px outline, visible stepped/pixel edges, limited palette, flat cel shading with at most one small highlight and one shadow step, simple readable face, tiny limbs...

**行级 prompt 模板** (`row_prompt()`)，每个 prompt 包含：

1. **Identity Lock（身份锁定）**：明确要求"不要重新设计角色，只改变姿势"
2. **State Requirements（状态约束）**：每个状态有禁止画什么的规定
3. **Transparency Artifact Rules（透明度规则）**：禁止浮动特效、阴影、运动线等
4. **Layout Requirements（布局约束）**：帧数、间距、居中、安全边距

核心理念：**用否定约束来防止 AI 做多余的事**。比如 waving 状态禁止画"波浪线、运动弧线"，running 禁止画"速度线、灰尘云"。

### 3.2 Chroma Key 背景去除

不是用 AI 自动去背景，而是**让 AI 在指定颜色的纯色背景上画**，然后用脚本精确去除：

```python
# prepare_pet_run.py - 自动选择 chroma key
CHROMA_KEY_CANDIDATES = [
    ("magenta", "#FF00FF"), ("cyan", "#00FFFF"), ("yellow", "#FFFF00"),
    ("blue", "#0000FF"), ("orange", "#FF7F00"), ("green", "#00FF00"),
]
# 采样参考图像素，计算每个候选色与所有像素的距离
# 选择 1st percentile 距离最大的那个（最不冲突）
```

```python
# extract_strip_frames.py - 去背景
def remove_chroma_background(image, chroma_key, threshold=96.0):
    for y, x in image:
        if color_distance(rgb, chroma_key) <= threshold:
            pixels[x, y] = (r, g, b, 0)
```

优势：确定性（可重复）、精确性（不误删角色颜色）、可控性（threshold 可调）。

### 3.3 Connected Components 帧提取

当 AI 生成的条带中角色之间没有明确分隔线时，通过连通域分析自动找到每个角色：

```
输入: 一张包含多个角色的横条（可能没有格子线）
算法:
1. 扫描 alpha 通道，找所有非透明像素的连通域
2. 按面积排序，取前 N 个最大连通域（N=目标帧数）
3. 按 centerX 排序，保证从左到右
4. 将剩余小碎片分配给最近的种子连通域
5. 每组裁剪 → fit_to_cell → 保存
```

如果连通域检测失败（比如角色重叠），降级为等宽切槽。

### 3.4 子代理并行生成

base 完成后，9 行动画通过**子代理并行生成**。每个子代理只负责一个 row，返回选中的图片路径和一句话 QA 备注。父代理拥有 manifest 的唯一写权限。

### 3.5 QA 验收体系

三层验证：

| 层 | 工具 | 检查内容 |
|----|------|----------|
| 几何 | `validate_atlas.py` | 尺寸 1536×1872、透明通道、非空格子、未用格子透明 |
| 帧 | `inspect_frames.py` | 帧大小一致性、边距、组件提取 vs 槽提取 |
| 人工 | `contact-sheet` | 角色一致性、风格一致性、动画流畅度 |

`qa-rubric.md` 检查清单：首尾帧无缝循环、方向性行读起来方向正确、没有重复帧、联系表不能是参考图的裁剪拼接。

### 3.6 Identity-first：漂移即一票否决

SKILL.md L205, L307 反复强调一条原则：**即使 `validation.json` 与 `qa/review.json` 全部通过，只要 contact sheet 上能看出角色漂移（species/face/markings/palette/prop/silhouette 任一不一致），整张图集都必须 block**。

> "Deterministic validation is necessary but not sufficient. Block acceptance if any row changes species/body type, face, markings, palette, prop design, prop side unexpectedly, or overall silhouette."

含义：**自动化几何/帧检查是必要不充分条件**，identity 一致性必须用人眼或视觉模型在联系表层做最终把关。这条比 §3.5 的三层 QA 优先级更高——可以把它理解为 QA 之上的一票否决层。

### 3.7 修复最小作用域 (Smallest Failing Scope)

`qa-rubric.md` L52-60 给出修复阶梯：

```
单帧不合格   → 仅重新生成该帧
单行不合格   → 仅重新生成该行（queue_pet_repairs.py 重开 row job）
角色基线漂移 → 才考虑全图重做
```

`queue_pet_repairs.py` 配合 `record_imagegen_result.py` 让单 row 重生只更新 `decoded/<state>.png`，原 `canonical-base.png` 保持不变作为 identity 锚点。这是贯穿整条 pipeline 的核心设计哲学，不只是修复策略——它要求**所有中间产物都按粒度（base / row / frame）独立存储且可单独重写**。

### 3.8 父-子代理写权限边界

§3.4 提到 9 行 row 用子代理并行，SKILL.md L211-225 进一步规定了**父独占写、子只读+回报**的安全边界：

| 角色 | 允许 | 禁止 |
|------|------|------|
| 父 agent | 写 `imagegen-jobs.json`、调 `record_imagegen_result.py`、`derive_running_left_*`、`finalize_*`、`package_*` | — |
| 子 agent | 调 `$imagegen` 生成、做候选筛查、返回 `selected_source` + 一句 QA 备注 | 写 manifest、复制到 `decoded/`、调任何 record/finalize/package 脚本 |

子 agent 的 handoff contract 极简——只交回一个绝对路径 + 一句话备注。父 agent 拿到后再决定是 record 还是 repair。这避免了 manifest race，也把 provenance 决策权集中。

任何并行生成系统在引入子代理前，**必须先想清楚这个边界**，否则 `imagegen-jobs.json` 会出现写冲突。

### 3.9 可见进度清单 (Visible Progress Plan)

SKILL.md L88-108 规定每个 pet run 必须维护一份用户可见的 4 步 checklist：

```
1. Getting <Pet> ready.       (确认名字/描述/源图/工作目录)
2. Imagining <Pet>'s main look. (生成 base，作为 identity 锚点)
3. Picturing <Pet>'s poses.    (先生成 idle + running-right，确认一致性)
4. Hatching <Pet>.             (定稿，写入 ~/.codex/pets/)
```

关键约束：**只有真实文件/图像/决策落地后才能勾选**，不能因为"开始执行"就标完成。如果 pet 名字未确定，用 `your pet` 占位。修复 run 不重启整个清单，从相关步骤开始即可。

这是个值得直接搬到 SpriteBrew AgentHydration 页的 UX 模式——比当前的 `pending → running → done` 状态语义更人性化、信息密度更高。

### 3.10 Layout Guide 是不可见构造引用

SKILL.md L142 明确：每行的 `references/layout-guides/<state>.png`（含格子线、安全边距、中心十字）作为 **layout-only input** 附加给 `$imagegen`，但**生成结果中不得出现 guide 的可见痕迹**——格子线、边框、中心标记、guide 背景色、label 都视为污染。

这意味着不是简单"附加一张参考图就完事"，而是需要在 prompt 端补一段否定约束 + 在 QA 端检测 guide 像素是否泄漏（例如检测纯红边框线、纯白十字等典型 guide 颜色）。

### 3.11 Mirror 派生政策

`derive_running_left_from_running_right.py` 不是无脑水平翻转，需要 `--confirm-appropriate-mirror` + `--decision-note` 两个显式开关：

**禁止镜像的情形**：单侧标记（眼罩/疤痕/补丁）、可读文字/logo、惯用手持物、单边光照线索、方向语义不可逆的姿势。

**允许镜像的情形**：左右严格对称的角色 + 对称 prop + 无文字。

不满足时必须把 `running-left` 当成正常 row 重新生成，并把 `running-right` 作为 gait 参考一并附上。

### 3.12 Source Provenance（生成产物可审计）

`record_imagegen_result.py` 对每张被接受的生成结果记录：

- 源文件绝对路径（必须是 `$CODEX_HOME/generated_images/.../ig_*.png`，禁止从 `tmp/`、手工 fixture、后处理副本入档）
- 文件 SHA256
- 落地路径 `decoded/<state>.png`
- 时间戳、job-id

整个 run 因此可审计：每帧最终像素能追到哪次生成请求。SpriteBrew 当前完全没有这个 trail——重生一次就丢失了上一版的来源，无法做 A/B 对比或事后追溯。

### 3.13 Per-row 帧时长 + Reduced-motion 首帧

`animation-rows.md` 的帧时长不是平均分配（详见 §2.3 表格）：

- **末帧通常更长**（220-320ms），形成自然停顿
- **idle 节奏更复杂**：280→110→110→140→140→320ms，模拟呼吸+眨眼组合
- **第一帧 idle 必须是合格的 reduced-motion 静态展示**——这是 accessibility 设计：用户禁用动画时，整只宠物退化为 idle[0]，所以那帧不能是中间过渡姿态

SpriteBrew 当前导出端使用统一 fps，丢失了节奏感；也没有"reduced-motion 首帧"的概念。

---

## 4. 与 SpriteBrew 的对比分析

### 4.1 全面对比

| 维度 | Codex Pet | SpriteBrew (Phase 1-8 后) |
|------|-----------|---------------------------|
| **核心流程** | AI 生成 → chroma key 去背景 → 智能切帧 → 拼接图集 → 三层 QA | AI 生成 → corner-sample 去背景 → 2D grid 等宽切帧 → 后处理 → 拼接图集 |
| **AI 后端** | OpenAI $imagegen (内置 skill) | GPT Image 2 / Gemini 双后端，支持 relay proxy |
| **背景去除** | Chroma key（prompt 端选色 + 脚本端去除） | Corner-sample（四角采样 + 色距阈值，`postProcess.ts`） |
| **帧提取** | Connected components 智能识别 | 2D grid 布局 + prompt 约束 AI 按网格排列（`spritesheetSlicer.ts`） |
| **图集规格** | 固定 1536×1872 (8×9×192×208) | 用户自定义帧数，自动选 canvas（4→2×2, 6→3×2, 8→4×2） |
| **Prompt 工程** | 极精细：DIGITAL_PET_STYLE + 每行否定约束 + identity lock | styleRegistry (promptPrefix + paletteColors) + AgentHydration (per-state suffix) |
| **角色一致性** | Identity Lock + canonical base 参考 | `editWithReference()` 接口就绪，Animate 模式尚未接入 |
| **QA 验证** | 三层自动化 + 人工联系表 | 无（仅有后处理 pipeline：trim→center→downsample→palette） |
| **并行生成** | 子代理并行 9 行 | Animate 单次串行；AgentHydration 顺序批生成 |
| **动画状态** | 9 种固定状态（idle / running-right / running-left / waving / jumping / failed / waiting / running / review） | Animate 模式 8 个动作（walking / idle / attack / jump / crouch / destroy / subtle_motion / custom_action）+ AgentHydration 7 状态（idle / active / thinking / coding / testing / error / done） |
| **导出格式** | pet.json + spritesheet.webp | Godot .tres / Aseprite JSON / layered zip / Agent Pack zip |

### 4.2 AgentHydration 与 Codex Pet：同源不同路

Phase 8 引入的 AgentHydration 是 SpriteBrew 对 Codex Pet 概念的直接回应，但走了不同的实现路径：

| 维度 | Codex Pet | AgentHydration |
|------|-----------|----------------|
| 状态数 | 9（含 3 个独立的 running 行：right / left / front-facing） | 7 (idle, active, thinking, coding, testing, error, done) |
| 帧数/状态 | 4-8 帧动画 | v1 单帧（静态） |
| 生成方式 | 9 行并行子代理 | 顺序批生成 |
| Agent 类型 | 仅 Codex CLI | claude-code / codex-cli / gemini-cli / default |
| 导出 | pet.json + spritesheet.webp | per-state PNG + Aseprite JSON + manifest.json + zip |

**关键观察**：
- 状态语义高度重叠：idle↔idle, active↔running, error↔failed, thinking↔review
- AgentHydration 新增 coding/testing/done 等编程特化状态
- v1 只有单帧——跨状态角色一致性（Codex Pet 通过 identity lock 解决）已被标记为难点
- 多 Agent 类型支持比 Codex Pet 更通用

---

## 5. 行动建议

按依赖关系排序——前面的项是后面项的前置条件。每条标注：
- **状态**：✅ 已实现 · ⏩ 已有替代 · 📋 待做
- **工作量**：S（≤半天）· M（1-2 天）· L（≥3 天）
- **验收**：一句话可观察的成功标准

### 5.1 🔴 高优先级（先做这些）

#### (1) Animate 模式接入 `editWithReference()` 做 Identity Lock 📋

**为什么先做**：所有后续 prompt 优化和 QA 都依赖"角色一致性可控"。Animate 模式当前已经把 inputImage 传给 `editWithReference()`（route.ts:258），但 prompt 里没有显式 identity lock 段，AI 仍会改设计。

**做法**：
1. 在 `buildAnimatePrompt()` 顶部加入 SKILL.md 风格的 identity lock 段：
   ```
   Do not redesign the character. Preserve the exact same head shape, face,
   markings, palette, prop, outline weight, body proportions, and silhouette
   as the reference image. Only change pose between frames.
   ```
2. AgentHydration 当前完全是 `mode: 'create'` 串行调用，第 2 张起没有 base 锚点 → 改造为：先生成 idle 作为 canonical base，后续 6 个状态都用 idle 作为 reference 调 `editWithReference()`。

- **工作量**：S（动 prompt + 1 处分支逻辑）
- **验收**：同一描述生成的 7 个状态，contact sheet 上角色 silhouette / palette / prop 肉眼一致

#### (2) AgentHydration prompt 加否定约束 + 重写为「是什么/不是什么」结构 📋

**当前 `STATE_PROMPT_SUFFIX` 远比 SKILL.md 弱**——只有正向描述（"X marks for eyes" / "holding a magnifying glass"），没有任何否定约束。AI 会自由发挥加速度线、阴影、表情泡。

**Before**（`agentHydration.ts:29-37` 现状）：
```ts
export const STATE_PROMPT_SUFFIX: Record<AgentHydrationState, string> = {
  idle: 'in idle standing pose, neutral expression',
  active: 'in alert active pose, eyes open wide',
  thinking: 'thinking pose, hand on chin, contemplative',
  coding: 'typing on a small keyboard, focused',
  testing: 'holding a magnifying glass, inspecting',
  error: 'distressed expression, X marks for eyes',
  done: 'celebrating with arms raised, happy',
};
```

**After**（参考 SKILL.md `row_prompt()` 写法）：
```ts
// 共享底座（参考 DIGITAL_PET_STYLE）
const SHARED_NEGATIVE = [
  'no speed lines, no motion arcs, no afterimages, no smears',
  'no detached sparkles, floating symbols, speech bubbles, thought bubbles',
  'no cast shadows, drop shadows, oval floor shadows, glow, halo, aura',
  'no text, labels, frame numbers, UI panels, code snippets',
  'no white background, no checker pattern — fully transparent alpha 0',
].join('; ');

export const STATE_PROMPT_SUFFIX: Record<AgentHydrationState, string> = {
  idle:     `neutral standing pose, soft breathing posture. ${SHARED_NEGATIVE}`,
  active:   `alert pose, body leaning slightly forward, eyes wide open. ${SHARED_NEGATIVE}; no exclamation marks, no action streaks`,
  thinking: `hand near chin, head tilted slightly. Show focus through pose only. ${SHARED_NEGATIVE}; no question marks, no thought bubbles, no floating gears`,
  coding:   `seated typing pose with small attached keyboard prop. ${SHARED_NEGATIVE}; no flying code symbols, no glowing keys, no motion lines on hands`,
  testing:  `holding small magnifying glass attached to paw, leaning forward. ${SHARED_NEGATIVE}; no checkmarks, no red X overlays, no inspection sparkles`,
  error:    `slumped/deflated posture, downcast face. Tears or attached small smoke puff allowed if touching face. ${SHARED_NEGATIVE}; no red X marks, no detached tear drops, no error symbols floating nearby`,
  done:     `arms raised celebration pose, happy expression. ${SHARED_NEGATIVE}; no confetti, no detached stars, no fireworks, no exclamation marks`,
};
```

同时 `AGENT_HYDRATION_TEMPLATE.promptPrefix` 重写为"是什么/不是什么"结构：
```ts
promptPrefix: [
  'pixel-art-adjacent low-resolution mascot sprite, compact chibi proportions',
  'chunky whole-body silhouette, thick dark 1-2px outline, visible stepped pixel edges',
  'limited palette, flat cel shading with at most one highlight and one shadow step',
  'simple readable face, tiny limbs, frontal or three-quarter view',
  // 否定段
  'NOT a polished illustration, NOT painterly rendering, NOT anime key art',
  'NOT 3D rendering, NOT glossy app-icon treatment, NOT realistic fur or material texture',
  'NOT soft gradients, NOT high-detail antialiasing',
].join(', '),
```

- **工作量**：S（纯文本改动）
- **验收**：相同输入下，error/done 状态明显减少 X 标记/星星等浮动符号；输出背景透明无 checker

#### (3) styleRegistry 全量 prompt 改造（同结构推广到 8 种风格） 📋

`styleRegistry.ts` 8 种风格的 promptPrefix 都还是单行短语（"pixel art game character, clean outlines, side view"）。把 (2) 的"正向 + 否定"双段结构推广到所有风格。每种风格的否定项要差异化（环境类禁止"角色出现"，UI icon 类禁止"背景场景"）。

- **工作量**：M（8 风格 × 1 段否定，需要写测试样本验证）
- **验收**：每种风格的 5 个固定 sample prompt，肉眼对比 before/after，否定约束生效

#### (4) 导出前自动化 QA（移植 validate_atlas + inspect_frames） 📋

参考 §3.5 三层验证 + §3.6 identity-first 一票否决。SpriteBrew 当前生成完直接交付，无任何后置检查。

**最小可行版本**（不必全套）：
- 几何：`detectAndSliceFrames()` 切完后，每帧 alpha 非零像素占比 > 5%（防全透明帧）、< 95%（防全填充帧）
- 帧间一致性：所有帧 trim 后的 bounding box 大小标准差 < 帧尺寸的 30%（防角色突然变大变小）
- 透明度：四角 8×8 像素必须全 alpha=0（防背景未去净）
- 失败时在 SSE 流推 `type: 'qa-warning'` 事件，前端展示但不阻断（v1 软告警，v2 再做硬阻断）

- **工作量**：M
- **验收**：故意构造一张"中间帧丢失"的图，QA 能报出该帧异常

### 5.2 🟡 中优先级

#### (5) SpriteBrew → Codex Pet 导出格式（新 export target） 📋

Codex Pet 的 pet 包格式极简——`pet.json` + `spritesheet.webp`，schema 只有 4 字段。AgentHydration 已经覆盖 7 状态，加 4 个动作（waving/jumping/running-right/running-left）就能凑齐 9 行 1536×1872 atlas，**让 SpriteBrew 用户直接产出可装入 `~/.codex/pets/` 的 Codex 兼容宠物**。

**做法**：
1. 在 AgentHydration 状态集中追加 4 个 Codex 必需状态（让用户可选"目标 = Codex Pet"切换）
2. 实现 `composeCodexAtlas()`：把 9 个状态的帧（v1 单帧 → 复制为 6-8 帧动画或要求用户后续动画化）按 8×9×192×208 网格拼接，未用格子保持透明
3. 添加 `pet.json` 写出 + WebP 无损编码（sharp 已支持）
4. 在 `exportEngine.ts` 的 `ENGINE_TARGETS` 加 `codex-pet` 项

- **工作量**：M（atlas 拼接 + 一个新 export target）
- **验收**：导出的 pet.json + spritesheet.webp 拷到 `~/.codex/pets/<name>/` 后，Codex CLI 能识别并显示

#### (6) Visible Progress Plan UX 改造 📋

把 §3.9 的 4 步清单模式搬到 AgentHydration 页面顶部，替换当前的 `pending → running → done` 状态点阵。**关键约束**：只有真实图像落地才勾选；中途失败显示"正在重生 <state>"而不是 generic error。

- **工作量**：S（前端组件改造）
- **验收**：用户能从一眼看出当前在第几步、还剩多少步、哪些是真实完成

#### (7) 单帧/单行修复（最小作用域） 📋

参考 §3.7。AgentHydration 7 个状态生成完后，提供"重生此状态"按钮，只重发该状态的请求并替换对应 imageUrl，**保留 base/canonical-base 不变**。也在 Animate 切帧后提供"重生第 N 帧"。

- **工作量**：S（已有 SSE 流和单图替换逻辑）
- **验收**：误生成的某一状态可单独重生，其它状态不受影响

#### (8) Layout 引导图 + guide 像素泄漏检测 📋

参考 §3.10。当前 `buildAnimatePrompt()` 用文字描述网格。

**做法**：
- sharp 程序化生成 `cols × rows` 的引导 PNG（淡灰格子线 + 中心十字 + 安全边距标注），作为 reference image 附加
- prompt 里加 SKILL.md 那条否定约束："The reference grid is a layout-only construction guide. Do NOT include visible boxes, borders, center marks, labels, or guide colors in the output."
- QA 端检测特征 guide 颜色（如 `#888888` 1px 直线）是否泄漏到输出

- **工作量**：M
- **验收**：12-frame 网格请求下，AI 不再画错位/混合帧，且输出无可见格子线

### 5.3 🟢 低优先级（取决于上面落地后的反馈）

#### (9) 父-子代理边界 + 并行行生成 📋

参考 §3.8 + Codex Pet 9 行并行模式。AgentHydration v2 升级为多帧动画时，7 个状态可以 `Promise.all`。但**必须先确立父-子写权限边界**：哪个对象拥有 progress state 的唯一写权限？哪些能被并行 worker 修改？建议引入 `runManifest`（前端持有）+ 子任务只返回 `{ state, imageBase64, qaNote }`。

- **工作量**：L（涉及并行架构 + manifest 设计）
- **验收**：7 状态总耗时 ≈ 单状态耗时；任意单状态失败不影响其它

#### (10) Connected Components 降级切分 ⏩ 已有替代，可增强

参考 §3.3。当 grid 切分某帧面积异常（接近 0 或远超均值）时自动触发连通域分析重切。

- **工作量**：M
- **验收**：故意输入一张帧间无明显边界的图，能正确切出连通域

#### (11) Source Provenance 落地 📋

参考 §3.12。每次接受的生成结果记 SHA256 + 时间戳 + prompt + adapter + 参数到 localStorage（或 KV）。给 gallery 页加"查看生成参数"按钮。

- **工作量**：S
- **验收**：任一历史 sprite 可追到当时的 prompt + 参数 + 源图 hash

#### (12) Per-row 帧时长导出 📋

参考 §3.13 + `animation-rows.md`。Aseprite/Godot 导出格式都支持 per-frame duration。在 SpriteBrew 内置一个"末帧加长 +50%"的 preset，并暴露 per-state 时长编辑。

- **工作量**：M
- **验收**：导出的 Aseprite JSON 末帧 duration 长于中间帧

#### (13) Chroma Key 端到端控制 ⏩ 已有替代

参考 §3.2。在 prompt 强制 "solid magenta background #FF00FF" + 后处理 chroma key。对 GPT Image 2（已不支持 `background: transparent`）特别有价值。

- **工作量**：S
- **验收**：GPT Image 2 模式下，输出背景一致干净，无 corner-sample 失败的边缘残留

#### (14) Mirror 派生工具 📋

参考 §3.11。Walking 动画导出时，提供"从 right 镜像出 left"按钮，但需要前置一个不对称检测启发式（OCR 检测文字、左右半边色直方图差异）+ 用户显式确认勾选。

- **工作量**：M
- **验收**：对称角色一键镜像；非对称角色给出警告并要求用户确认

#### (15) 社区画廊生态 📋

codex-pet-share / petdex / awesome-codex-pet 形成生成→分享→画廊生态。SpriteBrew 已有 gallery，可参考"标签 + 一键复用 prompt"模式。

- **工作量**：L
- **验收**：用户可一键把别人的 sprite 当作 reference 重新生成

---

## 6. 附录

### 6.1 Codex Pet 关键代码索引

| 文件 | 核心价值 | 行数 |
|------|----------|------|
| `SKILL.md` | 完整规范 + prompt 模板 + 工作流 | ~320 |
| `prepare_pet_run.py` | prompt 生成 + chroma key 自动选色 + 布局引导图 | 674 |
| `extract_strip_frames.py` | connected components 帧提取 + chroma key 去背景 | 324 |
| `compose_atlas.py` | 图集拼接（居中、透明合成） | 151 |
| `validate_atlas.py` | 自动化几何验证 | 140 |
| `finalize_pet_run.py` | 完整打包流水线（验证+QA+视频+安装） | 383 |
| `codex-pet-contract.md` | 精灵图集契约规范 | ~30 |
| `animation-rows.md` | 9 行动画状态 + 帧时长定义 | ~30 |
| `qa-rubric.md` | 人工验收检查清单 | 61 |

所有源码位于 `docs/references/codex-pet-hatch-skill/`，来自 [legeling/awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) 仓库 (MIT License)。

### 6.2 SpriteBrew 对应代码索引

| 文件 | 对应 Codex Pet 模块 | 说明 |
|------|---------------------|------|
| `src/lib/imageGen/index.ts` | $imagegen (skill) | 双后端工厂（GPT Image 2 / Gemini） |
| `src/lib/imageGen/gptImageAdapter.ts` | OpenAI API 调用 | 支持 relay proxy, GPT Image 2 适配 |
| `src/lib/imageGen/geminiAdapter.ts` | — | Gemini Nano Banana 2 适配 |
| `src/lib/imageGen/postProcess.ts` | extract_strip_frames.py (去背景部分) | corner-sample 去背景 + trim + center + downsample + palette |
| `src/lib/imageGen/spritesheetSlicer.ts` | extract_strip_frames.py (切帧部分) + compose_atlas.py | 2D grid 切帧 + 水平拼接 |
| `src/lib/imageGen/retry.ts` | — | 429/5xx 指数退避 |
| `src/lib/styleRegistry.ts` | DIGITAL_PET_STYLE | 8 种风格的 promptPrefix + paletteColors |
| `src/lib/templates/agentHydration.ts` | animation-rows.md | 7 状态 + per-state prompt suffix |
| `src/app/agent-hydration/page.tsx` | — | AgentHydration 批量生成页面 |
| `src/app/api/generate/route.ts` | prepare_pet_run.py | prompt 构建 + canvas 选型 + layout 约束 |
