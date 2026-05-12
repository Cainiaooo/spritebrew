# 引入 agent-sprite-forge 优点 — 任务规划

> 基于 [调研文档](./research-agent-sprite-forge.md) 的改进建议，按优先级拆解为可执行任务。

---

## Phase 1：强化 Agent 规则体系（1-2 天）

目标：让 Claude/Codex 等 agent 通过阅读规则就能更好地使用 SpriteBrew CLI。

### Task 1.1 — 重构 SKILL.md 参数推断规则

**文件**：`skills/spritebrew-cli/SKILL.md`

参考 agent-sprite-forge 的做法，增加以下内容：

- **参数推断表**：从自然语言映射到 CLI 参数
  ```
  "做一个火焰法师的施法动画" → --style character --prompt "fire mage casting spell"
  "给这个角色加走路动画" → animate --action walking --frames-duration 6
  ```
- **默认值规则**：什么情况用什么 style/size/frames
- **Agent-First 映射提示**：类似 agent-sprite-forge 的 `modes.md`

**验收标准**：agent 读完 SKILL.md 后，能从模糊的自然语言请求中正确推断所有参数。

### Task 1.2 — 添加 Guardrail（护栏规则）

**文件**：`skills/spritebrew-cli/SKILL.md`

新增 `## Guardrails` 章节：

- 禁止在 animate 时传入非方形图片（已有，但需在规则中强调）
- 禁止不查 styles_list 就猜测 style 名称
- 生成后必须检查 `qaWarnings`
- 动画帧数只能是 4/6/8
- referenceImages 不能带 `data:` 前缀

### Task 1.3 — 添加 QC 检查清单

**文件**：`skills/spritebrew-cli/SKILL.md`

新增 `## QC Checklist` 章节：

- 生成后检查 `qaWarnings` 是否为空
- 检查输出图片是否全透明或全不透明
- 动画 strip 的帧数是否与请求一致
- 图片尺寸是否与请求一致

---

## Phase 2：Bundle 生成模式（2-3 天）

目标：支持一次请求生成一组相关资产。

### Task 2.1 — 定义 Bundle 类型

**文件**：`src/lib/generation/bundles.ts`（新建）

定义 bundle 预设：

| Bundle | 包含 |
|--------|------|
| `unit` | idle sprite + walk animation |
| `spell` | cast animation + projectile sprite + impact sprite |
| `combat` | idle sprite + attack animation + hurt animation |
| `character_full` | idle + walk + attack + hurt |

每个 bundle 是一组有序的 generate/animate 调用。

### Task 2.2 — CLI 支持 bundle 参数

**文件**：`src/ageniti/actions/bundle.ts`（新建），`src/ageniti/app.ts`

新增 `bundle` action：

```bash
npm run cli -- bundle \
  --type spell \
  --prompt "ice wizard" \
  --width 64
```

输出：多个 artifact，每个对应 bundle 中的一个资产。

### Task 2.3 — SKILL.md 增加 Bundle 工作流

**文件**：`skills/spritebrew-cli/SKILL.md`

新增 `### Workflow E — bundle generation` 章节，说明何时用 bundle、如何选择 bundle 类型。

---

## Phase 3：生成质量提升（2-3 天）

目标：借鉴 agent-sprite-forge 的后处理思路，提升生成质量。

### Task 3.1 — 洋红背景备选管线

**文件**：`src/lib/generation/runCreate.ts`，`src/lib/generation/postprocess.ts`（新建）

当 `OPENAI_IMAGE_QUALITY=low` 或检测到透明背景不稳定时：
1. prompt 中强制要求 `#FF00FF` 纯色背景
2. 生成后用 chroma-key 算法去除洋红背景
3. 输出透明 PNG

实现：移植 agent-sprite-forge 的 `remove_bg_magenta` 逻辑（flood-fill + 颜色距离阈值），用 Node.js 的 sharp 或 canvas 实现。

### Task 3.2 — 帧边缘检测 QC

**文件**：`src/lib/generation/qc.ts`（新建）

对 animate 输出的 strip 做检测：
- 每帧边缘 1px 是否有非透明像素（edge touch）
- 帧间主体面积比例是否一致（±15%）
- 输出 `qaWarnings` 数组

### Task 3.3 — Layout Guide 提示增强

**文件**：`src/lib/generation/prompts.ts`（或相关 prompt 构建逻辑）

在生成 sprite sheet 的 prompt 中加入布局约束描述：
- 明确帧数和网格布局
- 要求主体居中、不超出安全区域
- 要求帧间比例一致

不需要生成参考图（那是 Codex 内置 image_gen 的能力），但可以在文字 prompt 中加入等效约束。

---

## Phase 4：深度引擎导出（3-5 天）

目标：从"图片格式转换"升级为"引擎原生资源导出"。

### Task 4.1 — Godot SpriteFrames .tres 增强

**文件**：`src/lib/exportEngine.ts`

当前已有 Godot .tres 导出。增强为：
- 包含动画名称和帧时长定义
- 支持多动画（idle/walk/attack）在同一 .tres 中
- 输出可直接拖入 Godot AnimatedSprite2D 使用

### Task 4.2 — Unity Animation 导出

**文件**：`src/lib/exportEngine.ts`

新增 Unity 导出格式：
- `.anim` AnimationClip（帧序列定义）
- 配套的 sprite atlas metadata
- 可直接导入 Unity Animator

### Task 4.3 — 碰撞/区域元数据导出（可选）

**文件**：`src/lib/exportEngine.ts`

对于有明确轮廓的精灵，自动生成：
- 简单碰撞框（AABB）
- 可选的凸包碰撞形状
- 以 JSON 格式输出，引擎侧可读取

---

## Phase 5：地图生成探索（长期，1-2 周）

目标：验证 Web 端地图生成的可行性。

### Task 5.1 — 地图生成 POC

新增 `src/lib/generation/runMapCreate.ts`：
1. 接受地图描述（风格、尺寸、类型）
2. 生成 ground-only base
3. 生成 dressed reference（叠加道具参考）
4. 返回两张图供用户确认

### Task 5.2 — Prop Pack 生成与提取

新增 `src/lib/generation/runPropPack.ts`：
1. 基于 dressed reference 生成 3×3 prop pack（洋红背景）
2. 提取为独立透明 PNG
3. 返回 prop 列表

### Task 5.3 — 分层预览合成

新增 `src/lib/generation/composePreview.ts`：
1. 接受 base + props + placement JSON
2. 合成分层预览图
3. 在 Web UI 中展示

---

## 优先级排序

```
Phase 1 (规则体系)  ████████████  最高优先级，零代码成本
Phase 2 (Bundle)    ████████      高优先级，直接提升用户价值
Phase 3 (质量)      ██████        中优先级，技术深度
Phase 4 (引擎导出)  █████         中优先级，差异化竞争力
Phase 5 (地图)      ███           低优先级，长期探索
```

---

## 依赖关系

```
Phase 1 ──→ Phase 2（Bundle 需要规则指导）
Phase 1 ──→ Phase 3.3（Layout Guide 提示需要规则框架）
Phase 3.1 ──→ Phase 5.2（Prop Pack 依赖洋红去背能力）
Phase 4.1 ──→ Phase 2（Bundle 导出需要增强的引擎导出）
```

---

## 不做的事

- ❌ 不做纯 Codex Skills 形态（我们是 Web 产品，保持 UI 优势）
- ❌ 不做完整的游戏原型生成（超出 sprite 工具定位）
- ❌ 不做 Tiled/LDtk 编辑器集成（地图编辑不是我们的核心）
- ❌ 不移植 Python 脚本（用 Node.js/sharp 重新实现需要的功能）
