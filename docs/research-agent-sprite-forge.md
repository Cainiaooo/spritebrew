# agent-sprite-forge 调研对比分析

> 调研时间：2026-05-12
> 对比对象：[agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) vs SpriteBrew

---

## 1. 项目定位对比

| 维度 | agent-sprite-forge | SpriteBrew |
|------|-------------------|------------|
| 产品形态 | Codex Skills（AI agent 技能包） | Web App + Agent CLI |
| 用户界面 | 无 UI，纯 agent 对话驱动 | Next.js Web UI + CLI |
| 目标用户 | 使用 OpenAI Codex 的开发者 | 游戏开发者、像素画师 |
| 核心价值 | 端到端游戏资产流水线（精灵+地图+引擎场景） | 精灵生成+动画+切片+预览+导出 |
| 许可证 | MIT | AGPL-3.0 |
| 依赖 | Python (Pillow + numpy) | Node.js (Next.js 全栈) |
| AI 后端 | Codex 内置 image_gen | OpenAI gpt-image / Gemini |

**关键差异**：agent-sprite-forge 不是一个应用，而是一套"教 AI agent 如何生成游戏资产"的技能定义。它没有 UI、没有服务器、没有用户系统，完全依赖 Codex agent 的对话上下文来驱动。SpriteBrew 是一个完整的 Web 产品。

---

## 2. 架构对比

### agent-sprite-forge 架构

```
用户自然语言 → Codex Agent（读取 SKILL.md 规则）
                    ↓
            Agent 自主规划资产方案
                    ↓
            Agent 手写 prompt → 内置 image_gen 生成原始图
                    ↓
            Python 脚本做确定性后处理
            （去洋红背景、帧切割、对齐、QC、GIF导出）
                    ↓
            输出 bundle（PNG/GIF/metadata JSON）
```

### SpriteBrew 架构

```
用户 Web UI / CLI → Next.js API Route (SSE)
                        ↓
                runCreate / runAnimate 管线
                        ↓
                imageGen 适配层（GPT Image / Gemini）
                        ↓
                Base64 图片返回 → 前端展示/Gallery
                        ↓
                用户手动切片/预览/导出
```

**核心区别**：
- agent-sprite-forge 的"智能"在 SKILL.md 规则里，由 Codex agent 解释执行
- SpriteBrew 的"智能"在代码里（prompt 模板、styleRegistry、validation）

---

## 3. 能力范围对比

| 能力 | agent-sprite-forge | SpriteBrew |
|------|-------------------|------------|
| 文本→精灵 | ✅ 支持多种 asset_type | ✅ generate action |
| 动画生成 | ✅ 多动作 bundle | ✅ animate action |
| 参考图驱动 | ✅ 完整的 reference 规则 | ✅ 支持上传参考图 |
| 地图生成 | ✅ 6种模式，极其详细 | ❌ 不支持 |
| 引擎场景导出 | ✅ Godot/Unity/Phaser/Tiled/LDtk | ✅ 6种格式（TexturePacker/Aseprite/GameMaker/RPG Maker/Godot/Raw） |
| 碰撞/区域元数据 | ✅ 完整的 collision/zones 体系 | ❌ 不支持 |
| 后处理管线 | ✅ 洋红去背、帧切割、对齐、QC | ✅ 切片、预览、像素编辑 |
| 交互式预览 | ❌ 无 | ✅ PixiJS 实时预览 |
| 像素编辑器 | ❌ 无 | ✅ 内置 |
| 用户系统 | ❌ 无 | ✅ Clerk 认证 |
| Gallery/历史 | ❌ 无（文件系统） | ✅ 每用户 Gallery |
| 可玩原型 | ✅ 可直接生成可玩游戏 | ❌ 仅资产 |

---

## 4. 值得借鉴的设计

### 4.1 SKILL.md 规则体系（最大亮点）

agent-sprite-forge 的核心创新是用**结构化的 Markdown 文档**来定义 AI agent 的行为规则，而不是硬编码在代码里。这套规则体系包括：

- **参数推断规则**：agent 从自然语言自动推断 asset_type、action、view、sheet 等参数
- **Guardrail（护栏）**：明确禁止的行为（如禁止单行 strip 用于角色动画）
- **工作流步骤**：6步标准流程，每步有明确的输入输出
- **QC 检查清单**：自动验证生成质量

**借鉴价值**：我们的 `skills/spritebrew-cli/SKILL.md` 可以参考这种结构化规则定义方式，让 Claude 更好地理解何时该用什么参数、什么是合理的默认值。

### 4.2 Bundle 概念

agent-sprite-forge 定义了多种 bundle 类型：
- `unit_bundle`：idle + combat
- `spell_bundle`：cast + projectile + impact
- `hero_action_bundle`：idle + run + attack + jump（每个动作独立生成再组装）
- `line_bundle`：进化线（1-3 形态）

**借鉴价值**：SpriteBrew 目前的 `animate` 只支持单一动作。可以引入 bundle 概念，让用户一次请求生成一整套角色动画（idle + walk + attack），提升效率。

### 4.3 分层地图管线

这是 agent-sprite-forge 最复杂也最有价值的部分：

1. **Ground-only base**：先生成纯地面/地形
2. **Dressed reference**：在 base 上叠加道具参考
3. **Prop pack**：批量生成小道具（3×3 网格）
4. **Prop extraction**：从洋红背景提取透明道具
5. **Layered preview**：合成最终预览

**借鉴价值**：如果 SpriteBrew 未来要做地图生成，这套分层管线是很好的参考。关键洞察是"不要一次生成完整地图，而是分层生成再组合"。

### 4.4 洋红背景 + 确定性后处理

agent-sprite-forge 强制所有生成使用 `#FF00FF` 纯色背景，然后用 Python 脚本做确定性的：
- 色键去背（chroma-key removal）
- 连通域分析（component detection）
- 帧切割和对齐
- 边缘触碰检测（QC）
- GIF 导出

**借鉴价值**：SpriteBrew 目前依赖 AI 直接生成透明背景。可以考虑引入"强制纯色背景 + 后处理去背"的方案作为备选，在 AI 生成透明背景不稳定时使用。

### 4.5 Layout Guide（布局参考图）

在生成前先用脚本创建一个几何参考图（网格线、安全区域标记），让 AI 生成时参考布局但不复制参考图本身。

**借鉴价值**：对于需要精确帧布局的 sprite sheet 生成，可以在 prompt 中加入布局约束描述，或生成参考图辅助。

### 4.6 道具分类规则

在生成道具前先分类：
- `compact_prop`：小型方形道具 → 可用 3×3 批量生成
- `wide_or_long_object`：宽长物体 → 必须单独生成
- `tall_or_large_object`：高大物体 → 必须单独生成
- `collision_bearing_object`：需要碰撞的物体 → 必须精确对齐

**借鉴价值**：如果做批量资产生成，先分类再选择生成策略是很好的模式。

### 4.7 引擎场景完整交付

agent-sprite-forge 不只生成图片，还能输出：
- Godot `.tscn` 场景文件
- TileMapLayer 节点
- StaticBody2D 碰撞体
- Area2D 触发区域
- 道具放置 JSON
- 调试用 player/camera

**借鉴价值**：SpriteBrew 的导出目前是"图片格式转换"。可以考虑更深度的引擎集成，比如直接输出 Godot SpriteFrames 资源文件或 Unity 的 Animation Controller。

---

## 5. 我们的优势

| 优势 | 说明 |
|------|------|
| 完整的 Web 产品 | 有 UI、有用户系统、有 Gallery，普通用户可直接使用 |
| 交互式预览 | PixiJS 实时动画预览，键盘控制角色移动 |
| 像素编辑器 | 可以手动修复 AI 生成的瑕疵 |
| 多引擎导出 | 6种格式一键导出 |
| 自动切片 | 轮廓检测 + 网格切片，支持非规则布局 |
| Auto-Prep 管线 | 自动裁剪、去背、缩放到标准尺寸 |
| SSE 流式传输 | 长时间生成不超时 |
| 双入口（Web + CLI） | 同一套生成逻辑，两种使用方式 |

---

## 6. 可落地的改进建议

### 短期（低成本高收益）

1. **丰富 SKILL.md 规则**：参考 agent-sprite-forge 的结构，为 `skills/spritebrew-cli/SKILL.md` 添加更详细的参数推断规则、guardrail 和 QC 检查清单
2. **Bundle 生成模式**：在 CLI 中支持 `--bundle spell`（自动生成 cast + projectile + impact 三张）
3. **生成后 QC 检查**：检测帧是否触碰边缘、帧间比例是否一致

### 中期（需要一定开发量）

4. **洋红背景备选管线**：当透明背景生成不稳定时，切换到纯色背景 + 后处理去背
5. **Layout Guide 生成**：在生成 sprite sheet 前，先生成布局参考图辅助 AI
6. **更深度的引擎导出**：输出 Godot SpriteFrames `.tres` 文件（含动画定义）、Unity AnimationClip

### 长期（战略方向）

7. **地图生成能力**：参考 agent-sprite-forge 的分层管线，实现 Web 端的地图生成
8. **可玩原型生成**：从资产生成扩展到场景组装，输出可运行的游戏原型
9. **多 Agent 协作**：sprite agent + map agent + scene agent 协同工作

---

## 7. 总结

agent-sprite-forge 是一个**纯 agent 驱动**的项目，它的价值不在代码量（Python 脚本总共不到 60KB），而在于那套精心设计的**规则体系**（SKILL.md + references）。这套规则让 Codex agent 能够：

1. 从自然语言自主推断完整的资产方案
2. 遵循严格的质量护栏避免常见错误
3. 按步骤执行可重复的工作流
4. 输出引擎可用的完整资产包

SpriteBrew 作为一个 Web 产品，在用户体验、交互性、可访问性上远超 agent-sprite-forge。但在 **AI agent 的规则设计**和**端到端游戏资产管线**方面，agent-sprite-forge 有很多值得学习的地方。

最核心的借鉴是：**把"AI 应该怎么做"的知识从代码中抽离出来，变成结构化的规则文档**，这样无论是 Claude、Codex 还是其他 agent，都能通过阅读规则来正确使用我们的工具。
