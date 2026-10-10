# Cloudflare Survey

Cloudflare Survey 是一个使用 Cloudflare Workers、Static Assets 和 R2 构建的个人调查应用。1.0 将支持从管理员登录、上传 CSV 问卷，到客户提交答卷、管理员查看和导出 CSV 的完整闭环，且不引入数据库。

功能边界和数据约定见 `SPEC.md`；分阶段实现计划和验收标准见 `TASKS.md`。

## 当前状态

1.0 已部署到 Cloudflare，访问地址为 [https://cloudflare-survey.998181.workers.dev/](https://cloudflare-survey.998181.workers.dev/)。2026-10-10 的验证结果如下：

- `pnpm test`：127 项测试全部通过。
- `pnpm check`：使用项目本地 Wrangler 4.149.0 完成 deploy dry-run，Static Assets 和 `SURVEY_BUCKET` binding 配置检查通过。
- production 只读 smoke test：静态首页和 `/api/health` 返回 `200`；`/admin.html` 正确跳转到 `/admin` 并返回 `200`；未认证的 `/api/admin/session` 和 `/api/admin/questionnaires` 返回 `401`；公开问卷列表 API 返回 `200`，确认 `SURVEY_BUCKET` binding 可用。
- 验证没有读取或修改 production R2 object、真实客户数据或真实 secret，也没有在 production 创建合成问卷或答卷。

Cloudflare 记录的代码部署时间为 2026-10-10 11:39:03（Asia/Singapore），deployment identifier 为 `7ad52386-57e9-4959-bc82-fc3f101651b3`。随后在 11:48:47 更新 secret，当前 version identifier 为 `54f4e38e-d220-4cad-b816-8a6a026330a2`；文档不记录 secret 值。

## Production 部署

Worker 名称和 production R2 bucket 均为 `cloudflare-survey`，R2 binding 名称为 `SURVEY_BUCKET`。使用项目本地 Wrangler v4 部署：

```sh
pnpm exec wrangler deploy
```

部署完成后可用以下只读请求检查服务；这些请求不会创建或修改 R2 object：

```sh
curl --fail https://cloudflare-survey.998181.workers.dev/
curl --fail https://cloudflare-survey.998181.workers.dev/api/health
curl --head https://cloudflare-survey.998181.workers.dev/admin.html
curl https://cloudflare-survey.998181.workers.dev/api/admin/session
curl https://cloudflare-survey.998181.workers.dev/api/admin/questionnaires
```

最后两个未认证请求预期返回 `401`，所以不应使用 `--fail`。只有在再次获得明确授权后，才可在 production 创建合成问卷或答卷来验证完整写入流程。

## 本地开发

前置要求：Node.js 22 和 pnpm 12。

安装开发依赖：

```sh
pnpm install
```

启动本地开发服务器：

```sh
pnpm dev
```

Wrangler 会使用本地 HTTPS 并在终端显示访问地址。静态首页位于 `/`，Worker health endpoint 位于 `/api/health`。首次访问时，浏览器可能要求确认 Wrangler 自动生成的本地证书。

如需手工检查管理员界面，可以只为当前本地进程传入合成的测试变量：

```sh
pnpm dev --var ADMIN_PASSWORD:local-test-password --var SESSION_SECRET:local-test-session-secret-1234567890
```

命令中的 `dev` 与 `--var` 之间不要添加独立的 `--`。启动后通过 Wrangler 显示的 `https://localhost:端口/admin.html` 地址访问，并使用密码 `local-test-password` 登录；不要继续使用旧的 HTTP 页面。以上值仅供本地测试，不得用于 production。

执行不会部署 production 的配置和构建检查：

```sh
pnpm check
```

运行自动化测试：

```sh
pnpm test
```

当前项目没有单独的 build 步骤；`pnpm check` 是已验证的构建与 Cloudflare 配置检查。

## 项目结构

- `src/`：Worker API、认证、CSV 校验以及 R2 读写逻辑。
- `public/`：客户填写页和管理员页面的 Static Assets。
- `test/`：单元、API 和端到端测试，全部使用合成数据。
- `wrangler.jsonc`：Worker、Static Assets 和 `SURVEY_BUCKET` binding 配置。
- `SPEC.md`：1.0 功能边界、数据格式和安全约束。
- `TASKS.md`：分阶段任务状态与验收标准。

## Runtime Secrets

管理员认证需要以下 Cloudflare runtime secret，文档只记录名称，不包含实际值：

- `ADMIN_PASSWORD`
- `SESSION_SECRET`

本项目不创建、读取或修改本地 `.dev.vars` 或真实 production secret。

## Cloudflare binding

Worker 使用一个 R2 binding：

- `SURVEY_BUCKET`：保存问卷定义、问卷元数据和答卷

本地与部署环境使用相同的 binding 名称。`wrangler.jsonc` 中的 `remote: false` 确保本地开发默认使用 Wrangler 的本地 R2，而不是远程 bucket。

## 本地功能检查

1. 访问 `/admin.html`，使用本地测试密码登录。
2. 上传 CSV 或通过表单创建问卷。
3. 访问 `/`，输入 Email、选择问卷并提交答卷。
4. 返回 `/admin.html`，在问卷列表中选择“查看答卷”。
5. 检查答卷详情并导出 CSV。

自动化测试中的端到端流程使用合成凭据、合成问卷和内存 fake R2，不访问 production 或真实客户数据。

## 1.0 限制

- 只有一个管理员密码，不支持多管理员、角色、邀请或密码找回。
- 不验证 Email 所有权，也不发送邮件。
- 问卷创建后不支持编辑、替换、归档或删除。
- 答卷不支持编辑或删除。
- 不支持草稿、条件题、分支、分页、评分、文件上传或富媒体。
- 不提供分析 dashboard、图表、报告、webhook 或第三方集成。
- 单次 CSV 导出最多处理 1000 份答卷，生成文件最大为 16 MiB；超过限制会返回错误，不会返回不完整文件。
- 1.0 使用 R2 listing 作为索引，不使用 D1 或其他数据库。

## R2 数据安全

- 应用的正常写入使用服务端生成的 UUID 和 conditional write，不覆盖已有问卷或答卷 object。
- 本地开发默认使用本地 R2。不要为了测试将 binding 改为远程模式。
- 未经明确授权，不部署 production，不读取、修改或删除真实 R2 object。
- Email 和答案属于私密数据，不应写入日志或提交到代码仓库。
- 任何 production secret 配置、R2 数据迁移、删除或修复操作都必须单独获得明确授权。

## 1.1 使用说明

1.1 在保持 1.0 数据兼容性的前提下扩展了管理界面与操作能力。面向用户的网站名称统一为“RIPLON 调查”；Worker、R2 bucket、binding、API 路径与 object prefix 等技术资源名称保持不变。

### 手工创建问卷（无需填写题目 ID）

- 管理页的统一编辑表单不再要求输入题目 ID；题目 ID 由服务端自动生成。
- “添加题目”按钮位于每道题目卡片上，点击后在该题之后插入新题目。
- 可以修改标题，并对题目进行增加、删除、排序和修改。

### CSV 上传与自动 ID

- 上传 CSV 仍保留 `question_id` 列，但允许单元格留空；留空的题目由服务端生成 ID。
- 已有且有效的 `question_id` 保持不变；同一文件可混合留空与已有 ID。
- 若存在自动生成的 ID，服务端会将问卷序列化为规范 CSV 后保存。

### 复制问卷

- 问卷列表中的“复制”会载入来源问卷的标题和全部题目，修改后保存为新的独立问卷。
- 副本获得新的 `survey_id`，不继承来源答卷；来源问卷及其 R2 object 保持不变。
- 打开或取消复制不会产生任何写入。

### 原地编辑与删除

- 无答卷的问卷可以原地编辑（“编辑”）或删除（“删除问卷”，需二次确认）。
- 原地编辑在相同的 `survey_id` 下覆盖问卷定义，`created_at` 保持不变。
- 有任何答卷的问卷拒绝编辑与删除；界面将对应按钮置为不可用并说明原因。
- 答卷列表支持删除单份答卷（需二次确认）；全部答卷删除后，问卷恢复可编辑、可删除。

### 主题与主页

- 客户页与管理页右上角提供三态主题图标按钮，点击循环：浅色（☀）→ 跟随系统（◐）→ 深色（☾）；偏好保存在浏览器本地。
- 客户主页与管理员登录页均采用左右分栏布局；登录页提供“返回主页”链接。
- 主页的可用问卷以下拉列表呈现，默认选中第一项。

### 1.1 部署说明

- production 部署仍需单独获得明确授权，流程与 1.0 相同（`pnpm exec wrangler deploy`）。
