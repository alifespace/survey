# Cloudflare Survey 1.0 任务清单

按顺序完成任务。只有满足全部验收标准后，任务才算完成。

当前状态：Cloudflare Survey 1.0 的实现、部署和只读 production 验证已完成（2026-10-10）。

## 阶段 0：确认设计限制

### 任务 0.1：确定实现常量

状态：已完成（2026-10-10）

确定上传大小、最大题目数量、最大字段长度、管理员 session 有效期和列表分页大小。

验收标准：

- [x] 每项限制都有明确的数值。
- [x] 应用代码依赖这些数值之前，先将其记录到 `SPEC.md`。
- [x] 不引入数据库、大型 framework、production 部署或破坏性 R2 操作。

## 阶段 1：创建最小 Cloudflare 项目

### 任务 1.1：添加 Worker 和 Static Assets 基础结构

状态：已完成（2026-10-10）

验收标准：

- [x] 项目包含一个 Worker 及其 Static Assets 所需的最小配置和源码结构。
- [x] 本地开发只使用项目中已验证并记录的命令。
- [x] 不安装 framework 或数据库依赖。
- [x] 基础静态页面和 Worker health endpoint 可以在本地运行。

### 任务 1.2：定义 R2 binding 和 object key helper

状态：已完成（2026-10-10）

验收标准：

- [x] 本地及部署配置引用同一个 R2 binding，且不嵌入凭据。
- [x] object key 的构造遵循 `SPEC.md`，并拒绝不安全的标识符。
- [x] 自动化测试覆盖有效和无效的 object 标识符。
- [x] 不修改或删除任何现有 R2 object。

## 阶段 2：导入问卷

### 任务 2.1：实现 CSV 解析与校验

状态：已完成（2026-10-10）

验收标准：

- [x] 服务端强制执行 `SPEC.md` 中的全部 CSV 规则。
- [x] 正确解析带引号的逗号、引号和换行。
- [x] 无效表头、题型、`required`、`options` 和重复 ID 都会产生可操作的错误信息。
- [x] 测试覆盖一份有效问卷和每类拒绝情况。

### 任务 2.2：保存并列出问卷

状态：已完成（2026-10-10）

验收标准：

- [x] 有效上传会在生成的 `survey_id` 下创建 `definition.csv` 和 `metadata.json`。
- [x] 无效上传不会写入任何问卷 object。
- [x] 问卷列表支持 R2 pagination。
- [x] 上传流程不能覆盖已有问卷。

## 阶段 3：管理员访问

### 任务 3.1：实现单管理员认证

状态：已完成（2026-10-10）

验收标准：

- [x] 管理员凭据和签名材料来自 runtime secrets，不来自源码文件。
- [x] 登录失败信息不透露具体是哪项凭据校验失败。
- [x] session 使用 secure、HTTP-only、same-site 且有时限的 cookie。
- [x] 管理员 route 拒绝缺失、无效或过期的 session。
- [x] 不读取、提交或记录真实 secret 值或 `.dev.vars` 文件。

### 任务 3.2：构建管理员问卷界面

状态：已完成（2026-10-10）

验收标准：

- [x] 已登录管理员可以上传 CSV 并查看服务端校验结果。
- [x] 已登录管理员可以不上传 CSV，直接填写标题并通过简易表单创建新问卷。
- [x] 简易表单允许按顺序增加、移除和调整题目，并为每题设置 `question_id`、`type`、`label`、`required` 和 `options`。
- [x] 手工创建支持的题型、字段规则和数量限制与 `SPEC.md` 的 CSV 约定完全一致。
- [x] 服务端将手工创建数据序列化为标准 CSV，并复用现有 CSV 校验与 R2 存储流程，不引入另一套持久化结构。
- [x] CSV 上传和手工创建都在任何 R2 写入前显示明确、可操作的校验错误。
- [x] 界面列出已保存的问卷及其关键元数据。
- [x] 明确展示加载、空列表、成功和错误状态。
- [x] 未认证访客不能上传 CSV、手工创建问卷或列出管理员数据。

## 阶段 4：客户填写流程

### 任务 4.1：实现 Email 输入和问卷选择

状态：已完成（2026-10-10）

验收标准：

- [x] 页面列出 R2 中的 active 问卷。
- [x] 必须输入有效 Email 并选择问卷后才能继续。
- [x] 无效或不可用的 `survey_id` 不能打开问卷。
- [x] 界面包含加载、空列表和错误状态。

### 任务 4.2：渲染问卷

状态：已完成（2026-10-10）

验收标准：

- [x] 按 CSV 行顺序渲染全部受支持的题型。
- [x] `label`、`options` 和 `required` 状态与已保存定义一致。
- [x] 客户端校验帮助用户填写，但服务端校验始终是最终依据。
- [x] 渲染用户提供的内容时，不产生 script 或 markup injection。

### 任务 4.3：校验并保存答卷

状态：已完成（2026-10-10）

验收标准：

- [x] Worker 校验 Email、问卷、必填答案、类型和允许的选项。
- [x] 成功请求创建一个符合 `SPEC.md` 的新且不可变的答卷 JSON object。
- [x] 无效请求不写入答卷 object。
- [x] 同一次浏览器交互中的重复点击不会意外创建重复答卷。
- [x] 不主动将 Email 或答案写入日志。

## 阶段 5：查看和导出

### 任务 5.1：列出并查看答卷

状态：已完成（2026-10-10）

验收标准：

- [x] 已登录管理员可以分页列出指定问卷的答卷。
- [x] 列表显示 `submission_id`、Email 和提交时间。
- [x] 单份答卷按照正确的题目 `label` 展示答案。
- [x] object 缺失或格式错误时显示安全错误，不泄露内部信息。
- [x] 查看操作不会修改任何 R2 object。

### 任务 5.2：将答卷导出为 CSV

状态：已完成（2026-10-10）

验收标准：

- [x] 导出字段和顺序与 `SPEC.md` 完全一致。
- [x] CSV 转义和 `multi_choice` 序列化正确。
- [x] 没有答卷时仍返回包含有效表头的 CSV。
- [x] 只有已认证管理员可以导出。
- [x] 导出使用 streaming 或其他方式，在已记录的 1.0 数据量限制内保证输出不损坏。

## 阶段 6：验证与交接

### 任务 6.1：添加端到端本地验证

状态：已完成（2026-10-10）

验收标准：

- [x] 本地测试覆盖登录、上传、客户提交、管理员查看和导出。
- [x] 失败流程包括无效登录、无效 CSV、无效答案和不可用问卷。
- [x] 测试只使用合成数据，绝不访问 production R2 或真实客户数据。

### 任务 6.2：完成运行文档

状态：已完成（2026-10-10）

验收标准：

- [x] `README.md` 包含已验证的 setup、local run、test 和 build 说明。
- [x] 记录所需的 binding 和 secret 名称，但不包含值。
- [x] production 部署仍是必须单独获得明确授权的操作。
- [x] 记录已知的 1.0 限制和安全的 R2 数据处理规则。

## 阶段 7：部署到 Cloudflare

阶段 7 只有在用户明确授权 production 部署后才能执行。部署前不得读取、展示或提交真实 secret 值，也不得读取、修改或删除现有 R2 object。

### 任务 7.1：完成部署前检查

状态：已完成（2026-10-10）

验收标准：

- [x] `pnpm test` 全部通过。
- [x] `pnpm check` 使用项目本地 Wrangler v4 完成 dry-run，且未使用 `wrangler publish`、Workers Sites 或其他 legacy 配置。
- [x] 确认 Cloudflare account、Worker 名称、production R2 bucket 名称和预期访问域名，不依赖猜测选择部署目标。
- [x] 确认 production 继续使用 `SURVEY_BUCKET` binding，且不引入数据库、大型 framework 或 beta `cf` CLI。
- [x] 获得用户对本次 production 部署及其明确目标的单独授权。

### 任务 7.2：配置 Cloudflare production 资源

状态：已完成（2026-10-10）

验收标准：

- [x] production R2 bucket 已存在或在获得明确授权后创建，且没有覆盖、迁移、修改或删除任何现有 object。
- [x] Worker 的 production R2 binding 名称为 `SURVEY_BUCKET`，并指向用户确认的 bucket。
- [x] `ADMIN_PASSWORD` 和 `SESSION_SECRET` 仅通过 Cloudflare secret 机制配置，不写入源码、普通配置、命令输出或项目文档。
- [x] 不读取或修改 `.dev.vars`，不将真实 secret 值提交到版本控制。

### 任务 7.3：部署并验证 production

状态：已完成（2026-10-10）

验收标准：

- [x] 使用项目本地 Wrangler v4 和 Workers Static Assets 完成用户已授权的 production 部署。
- [x] 记录实际部署的 Worker 名称、部署时间、访问 URL 和 Wrangler 返回的 deployment identifier，但不记录 secret 值。
- [x] production 的静态首页、`/api/health`、管理员登录保护和未认证 API 拒绝行为通过无数据写入的 smoke test。
- [x] 只有再次获得明确授权后，才可使用合成数据验证问卷创建、客户提交、管理员查看和 CSV 导出；不得使用真实客户数据。
- [x] 验证过程不修改或删除部署前已经存在的 R2 object，也不擅自清理任何 production 测试 object。
- [x] 将最终部署和验证命令、访问方式及已知限制补充到 `README.md`。
