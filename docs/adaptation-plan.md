# SpriteBrew 独立部署适配计划

> **项目：** SpriteBrew（fork 自 GAlbanese09/spritebrew）
> **日期：** 2026-04-30
> **目标：** 去除云服务依赖（Clerk/Stripe/Cloudflare KV），替换 Retro Diffusion API 为自有图片生成 API，实现独立部署
> **协议：** AGPL-3.0（修改源码并网络部署需开源修改部分）

---

## 1. 当前依赖清单

| 依赖 | 用途 | 去除难度 |
|------|------|---------|
| **Clerk** | 用户认证、登录/注册 UI、userId 隔离 | 低（无 key 时自动降级） |
| **Cloudflare KV** | Token 余额、交易记录、账户锁定、每日限额 | 低（代码已有 fail-open 降级） |
| **Stripe** | Token 购买、退款处理 | 低（删除即可） |
| **Retro Diffusion API** | AI 像素角色生成 | 中（需重写 `callRD()`） |
| **Cloudflare Pages** | 部署托管 | 低（改为 `npm run build && start`） |

---

## 2. 实施步骤

### Step 1：环境变量配置

创建 `.env.local`（**已在 .gitignore 中，不会被提交**）：

```env
# ====== 必填：图片生成 API ======
# 替换 Retro Diffusion，填入你的 API key
IMAGE_GEN_API_KEY=your_api_key_here
IMAGE_GEN_API_BASE_URL=https://your-api-endpoint.com
IMAGE_GEN_API_PROVIDER=gpt-image  # 可选值: gpt-image | stable-diffusion | replicate | custom

# ====== 可选：持久化存储 ======
# 如需 Token 余额等持久化功能，替换 Cloudflare KV
# STORAGE_TYPE=sqlite  # sqlite | json-file | redis
# SQLITE_PATH=./data/spritebrew.db

# ====== 不再需要的变量（留空或不配置） ======
# RETRO_DIFFUSION_API_KEY=
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
# CLERK_SECRET_KEY=
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

> ⚠️ **安全规则**：
> - `.env*` 文件已被 `.gitignore` 排除，不会被 git 追踪
> - 文档中禁止出现真实 API key、token、密码等敏感信息
> - 使用 `your_api_key_here` 等占位符

### Step 2：去除 Clerk 认证

**改动文件：**

| 文件 | 改动 |
|------|------|
| `src/app/api/generate/route.ts` | 移除 `getAuthedUserId()` 检查，使用固定 userId |
| `src/components/sprites/GenerationForm.tsx` | 移除 `useAuth()` 依赖 |
| `src/components/sprites/AnimateForm.tsx` | 移除 `useAuth()` 依赖 |
| `src/components/sprites/GenerationResult.tsx` | 移除 `useAuth()` 依赖 |
| `src/components/layout/Sidebar.tsx` | 移除 SignIn/SignOut 按钮 |
| `src/app/generate/page.tsx` | 移除 `Show`/`SignInButton` 条件渲染 |
| `src/app/gallery/page.tsx` | 移除 `useAuth()` |
| `src/app/buy-tokens/page.tsx` | 整页删除 |
| `src/app/sign-in/page.tsx` | 整页删除 |
| `src/app/sign-up/page.tsx` | 整页删除 |

**注意：** `ClerkClientProvider.tsx` 在 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 为空时自动降级，不配环境变量即可跳过。

### Step 3：去除 Cloudflare KV

KV 相关代码已有 fail-open 降级（`getKV()` 返回 `null` 时自动放行），**不配环境变量即可跳过**。

涉及文件：
- `src/lib/tokenBalance.ts` — KV 不可用 → `debitTokens` 返回成功
- `src/lib/accountLock.ts` — KV 不可用 → 账户状态返回 `'active'`
- `src/lib/serverRateLimit.ts` — KV 不可用 → 返回默认限额

如需持久化 Token 余额，可后续替换为 SQLite（better-sqlite3）或 JSON 文件存储。

### Step 4：去除 Stripe

直接删除以下文件和目录：
- `src/app/api/stripe/`（整个目录）
- `src/app/buy-tokens/`（整个目录）
- `src/lib/stripe.ts`

### Step 5：替换 AI 生成后端

**核心改动：重写 `callRD()` 函数**

文件位置：`src/app/api/generate/route.ts` 第 309-338 行

当前逻辑：
```
POST https://api.retrodiffusion.ai/v1/inferences
Header: X-RD-Token: <key>
Body: { prompt, prompt_style, width, height, num_images, ... }
Response: { base64_images: string[] }
```

替换为自有 API 时，需适配：

| 适配项 | 说明 |
|--------|------|
| 认证方式 | 改为目标 API 的认证 Header（`Authorization: Bearer <key>` 等） |
| 请求参数 | 将 `prompt_style` 映射为目标 API 的风格参数（或用 system prompt 替代） |
| 响应解析 | 将目标 API 的图片响应统一转为 `base64` 字符串 |
| 错误处理 | 适配目标 API 的错误码格式 |

**常见 API 适配参考：**

**GPT Image（OpenAI）：**
```typescript
// 请求
POST https://api.openai.com/v1/images/generations
Header: Authorization: Bearer ${IMAGE_GEN_API_KEY}
Body: { model: "gpt-image-1", prompt: "...", size: "1024x1024", n: 1, response_format: "b64_json" }
// 响应
{ data: [{ b64_json: "..." }] }
// 映射: data[0].b64_json → base64_images[0]
```

**Stable Diffusion WebUI（本地）：**
```typescript
// 请求
POST http://localhost:7860/sdapi/v1/txt2img
Body: { prompt: "...", width: 512, height: 512, steps: 20 }
// 响应
{ images: ["base64..."] }
// 映射: images[0] → base64_images[0]
```

### Step 6：更新风格注册表

文件：`src/lib/styleRegistry.ts`

当前所有 `promptStyle` 值映射到 Retro Diffusion 专用风格（如 `rd_pro__default`、`animation__any_animation`）。

替换后端后，需根据目标 API 重新定义风格映射：

```typescript
// 改前（RD 专用）
promptStyle: 'rd_pro__default'

// 改后（示例：通过 prompt prefix 控制风格）
promptPrefix: 'pixel art character, 16-bit style, '
// 或通过 model 参数切换
model: 'pixel-art-model'
```

### Step 7：Edge Runtime → Node.js Runtime

当前所有 API route 声明了 `export const runtime = 'edge'`。独立部署时如果需要 Node.js API（如文件系统、数据库驱动），需改为 Node.js runtime。

涉及文件（搜索 `export const runtime`）：
- `src/app/api/generate/route.ts`
- `src/app/api/generation-limit/route.ts`
- `src/app/api/token-balance/route.ts`
- `src/app/api/stripe/checkout/route.ts`（将删除）
- `src/app/api/stripe/webhook/route.ts`（将删除）
- `src/app/api/waitlist/route.ts`

```typescript
// 改前
export const runtime = 'edge'

// 改后
export const runtime = 'nodejs'
```

### Step 8：本地运行验证

```bash
npm install
npm run build
npm run start
# 访问 http://localhost:3000
```

---

## 3. 改动量估算

| 步骤 | 改动类型 | 代码量 |
|------|---------|--------|
| Step 2: 去 Clerk | 修改 + 删除 | ~50 行修改 + 3 个文件删除 |
| Step 3: 去 KV | 无需改动 | 0 行（自动降级） |
| Step 4: 去 Stripe | 删除 | 3 个文件/目录删除 |
| Step 5: 替换 AI 后端 | 重写 | 30-100 行 |
| Step 6: 更新风格注册表 | 修改 | ~50 行 |
| Step 7: Runtime 切换 | 修改 | 4-6 处 |
| **合计** | | **~130-200 行 + 文件删除** |

**预估工作量：1-2 天**

---

## 4. 可保留的完整功能

去除云依赖后，以下功能**完整可用**：

- ✅ Create New（文本生成角色）
- ✅ Animate My Character（上传角色生成动画）
- ✅ Upload & Slice（上传切割 sprite sheet）
- ✅ PixiJS 8 实时动画预览
- ✅ 全部 6 种导出格式
  - TexturePacker JSON Hash（Unity/Godot/Phaser/PixiJS）
  - Aseprite JSON
  - GameMaker 水平条
  - RPG Maker MV/MZ 3×4 网格
  - Godot SpriteFrames .tres
  - Raw Frames ZIP
- ✅ PixelEditor（像素编辑器）
- ✅ Gallery（生成历史，localStorage 存储）
- ✅ Export 页面

---

## 5. 不可用但无需的功能

| 功能 | 原因 |
|------|------|
| 登录/注册 | Clerk 已移除 |
| Buy Tokens | Stripe 已移除 |
| Token 余额/限额 | KV 已移除（生成不受限） |
| Waitlist | KV 已移除 |

---

## 6. 风险与缓解

| # | 风险 | 缓解措施 |
|---|------|---------|
| 1 | **AGPL-3.0 合规**：修改源码并网络部署需开源修改部分 | 仅在本地使用不触发；如需网络部署，fork 仓库已是公开的 |
| 2 | **上游更新冲突**：上游 SpriteBrew 更新后合并可能冲突 | 锁定 fork 版本，按需选择性合并上游 |
| 3 | **生成风格不一致**：不同 AI 后端的像素风格输出差异大 | 先用少量 prompt 测试，调整 prompt 模板直到效果满意 |
| 4 | **Animate 模式兼容性**：RD 的 Animate API 是专有的，其他 API 可能不支持 | 可用 Create New + prompt 描述动作替代，或分帧生成后手动组装 |

---

## 7. 文件变更清单（实施用 Checklist）

### 需修改的文件
- [ ] `src/app/api/generate/route.ts` — 去 auth + 重写 callRD() + 改 runtime
- [ ] `src/components/sprites/GenerationForm.tsx` — 去 useAuth
- [ ] `src/components/sprites/AnimateForm.tsx` — 去 useAuth
- [ ] `src/components/sprites/GenerationResult.tsx` — 去 useAuth
- [ ] `src/components/layout/Sidebar.tsx` — 去登录/注册/Buy Tokens 导航
- [ ] `src/app/generate/page.tsx` — 去登录提示
- [ ] `src/app/gallery/page.tsx` — 去 useAuth
- [ ] `src/lib/styleRegistry.ts` — 重写风格映射
- [ ] `src/app/api/generation-limit/route.ts` — 改 runtime
- [ ] `src/app/api/token-balance/route.ts` — 改 runtime
- [ ] `src/app/api/waitlist/route.ts` — 改 runtime 或删除

### 需删除的文件
- [ ] `src/app/buy-tokens/`（整个目录）
- [ ] `src/app/sign-in/`（整个目录）
- [ ] `src/app/sign-up/`（整个目录）
- [ ] `src/app/api/stripe/`（整个目录）
- [ ] `src/lib/stripe.ts`

### 需新增的文件
- [ ] `.env.local`（本地环境变量，不提交）
- [ ] 可选：`src/lib/imageGenAdapter.ts`（抽象 AI 后端适配层，便于切换不同 API）

---

## 8. 可选增强：AI 后端适配层

建议新增 `src/lib/imageGenAdapter.ts`，将 AI 调用抽象为统一接口：

```typescript
interface ImageGenRequest {
  prompt: string;
  width: number;
  height: number;
  style?: string;
  referenceImages?: string[];
}

interface ImageGenResult {
  base64Image: string;
  cost?: number;
}

interface ImageGenAdapter {
  generate(request: ImageGenRequest): Promise<ImageGenResult>;
}
```

这样切换 API 只需新增一个 Adapter 实现，不需要每次改 `route.ts`。

---

*— 夏夏 (xiaxia) from HermesAgent, 2026-04-30*
