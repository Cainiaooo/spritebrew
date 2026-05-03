# Codex Pet 系统调研报告

> 调研日期: 2026-05-03 | 更新: 2026-05-03 (同步 Phase 1-8)
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
| **动画状态** | 9 种固定状态（编程伴侣） | 自定义动作 + AgentHydration 7 状态（编程伴侣） |
| **导出格式** | pet.json + spritesheet.webp | Godot .tres / Aseprite JSON / layered zip / Agent Pack zip |

### 4.2 AgentHydration 与 Codex Pet：同源不同路

Phase 8 引入的 AgentHydration 是 SpriteBrew 对 Codex Pet 概念的直接回应，但走了不同的实现路径：

| 维度 | Codex Pet | AgentHydration |
|------|-----------|----------------|
| 状态数 | 9 (idle, running×3, waving, jumping, failed, waiting, review) | 7 (idle, active, thinking, coding, testing, error, done) |
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

按优先级排列，标注当前状态。✅ 已实现 · ⏩ 已有替代 · 📋 待做

### 5.1 🔴 高优先级

#### (1) Prompt 否定约束 + Identity Lock ⏩ 接口就绪，逻辑未接

Codex Pet 最值得借鉴的 prompt 技术：
- **Identity Lock**：base 参考图 + "不要重新设计角色，只改变姿势" → 解决角色漂移
- **否定约束**：每状态"禁止画什么" → 防止 AI 过度创作
- **风格基线**：`DIGITAL_PET_STYLE` 的"是什么/不是什么"写法

**当前状态**：
- ✅ `editWithReference()` 接口支持参考图注入
- ✅ `styleRegistry` 有 promptPrefix + paletteColors
- ✅ AgentHydration 有 per-state `STATE_PROMPT_SUFFIX`
- 📋 缺少否定约束（禁止速度线、阴影、运动线等）
- 📋 Animate 模式未接入 `editWithReference()` 做 identity lock
- 📋 promptPrefix 未采用"是什么/不是什么"结构

**做法**：
1. 为 styleRegistry 每种风格重写 promptPrefix，加入否定约束段（参考 `DIGITAL_PET_STYLE` + `row_prompt()` 的写法）
2. Animate 模式接入 `editWithReference()`，将 create 图作为 canonical base
3. AgentHydration 的 `STATE_PROMPT_SUFFIX` 加入否定约束（如 coding 禁止画"波浪线、运动弧线"）

#### (2) 导出前自动化 QA 📋

Codex Pet 三层验证（几何→帧→人工）确保了交付质量。SpriteBrew 目前无生成后验证。

**做法**：
- 参考 `validate_atlas.py`：图集尺寸、非空检查、透明度验证
- 参考 `inspect_frames.py`：帧大小一致性、边距检查
- 参考 `make_contact_sheet.py`：生成联系表预览
- 集成到 export 流程，导出前自动运行

### 5.2 🟡 中优先级

#### (3) Connected Components 降级切分 ⏩ 已有替代，可增强

当前 `spritesheetSlicer.ts` 用 2D grid 等宽切分，依赖 prompt 约束 AI 按网格排列。如果 AI 不遵守，切分会失败。

**做法**：将 `extract_component_frames()` 的连通域分析移植为 TypeScript 降级方案——当等宽切分结果中某帧面积异常（接近 0 或远超均值）时自动触发。

#### (4) 布局引导图 ⏩ 已有文字描述，可升级

当前 `buildAnimatePrompt()` 用文字描述布局（如 "arrange 6 frames in a 3×2 grid"）。Codex Pet 生成视觉引导图（格子线 + 安全边距 + 中心十字），约束更强。

**做法**：用 sharp 生成简单的 grid guide PNG，作为 reference image 附加到请求中。

#### (5) 并行帧生成 📋

Codex Pet 9 行并行，SpriteBrew 全部串行。

**做法**：Next.js 中用 `Promise.all` 并发多个 adapter.generate() 调用。注意 API 限流和 token 消耗。AgentHydration v2 动画化时可优先实现。

### 5.3 🟢 低优先级

#### (6) 单帧/单行修复 📋

`queue_pet_repairs.py` 支持"只重新生成失败行"。SpriteBrew 生成不理想时只能全部重来。

**做法**：在 Animate 和 AgentHydration 页面增加"重新生成此帧/此状态"按钮。

#### (7) 社区画廊生态 📋

codex-pet-share、petdex、awesome-codex-pet 形成"生成→分享→画廊"生态。SpriteBrew 有 gallery 功能，可参考这种模式。

#### (8) Chroma Key 端到端控制 ⏩ 已有替代

当前 corner-sample 去背景是后处理方案。Codex Pet 的 `choose_chroma_key()` 在 prompt 端控制背景色，精度更高。

**可选增强**：在 prompt 中指定纯色背景（如 "solid magenta background #FF00FF"），后处理端用对应 chroma key 去除。对 GPT Image 2（已不支持 `background: transparent`）特别有价值。

---

## 6. 附录

### 6.1 Codex Pet 关键代码索引

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
