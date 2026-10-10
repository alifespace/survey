# Cloudflare Survey 1.0 规格说明

## 1. 产品目标

在 Cloudflare 上构建一个供个人使用的小型调查服务。管理员通过上传 CSV 或简易表单创建问卷；客户输入 Email，选择并填写问卷；管理员查看或导出已提交的答卷。

1.0 技术栈仅限：

- Cloudflare Workers：处理请求和服务端逻辑
- Cloudflare Static Assets：提供浏览器界面
- Cloudflare R2：保存问卷文件、元数据和答卷

R2 是 1.0 唯一的持久化层。

## 2. 用户角色

### 管理员

- 通过单一管理员登录入口登录。
- 上传并校验问卷 CSV 文件，或通过简易表单创建问卷。
- 查看可用问卷及其答卷。
- 打开单份答卷。
- 将一份问卷的全部答卷导出为 CSV。

### 客户

- 输入 Email。
- 选择一份可用问卷。
- 填写渲染出的题目。
- 提交一次，并看到成功或失败结果。

## 3. 主要页面

程序界面文案可以使用中文或英文。1.0 当前实现默认使用中文，但不提供语言切换、自动翻译或双语内容同步功能。代码标识符、API 路径、配置项和数据字段继续使用英文。

### 客户入口页

- Email 输入框
- 可用问卷列表
- 继续操作
- 明确的校验状态和加载状态

### 问卷填写页

- 问卷标题
- 按 CSV 顺序渲染的题目
- 必填项校验
- 带重复点击保护的提交操作
- 成功状态和可恢复的错误状态

### 管理员登录页

- 管理员凭据输入
- 不泄露细节的统一登录失败提示
- 登录成功后建立安全且有时限的管理员 session

管理员密码从 runtime secret `ADMIN_PASSWORD` 读取，session 签名材料从 runtime secret `SESSION_SECRET` 读取；二者不得写入源码、普通配置或日志。`ADMIN_PASSWORD` 至少包含 12 个 Unicode code point，`SESSION_SECRET` 经 UTF-8 编码后至少为 32 bytes。

管理员通过 `POST /api/admin/session` 登录，通过 `GET /api/admin/session` 检查登录状态，通过 `DELETE /api/admin/session` 退出。登录失败统一返回通用错误，不说明具体失败原因。

成功登录后建立最长 8 小时的 HMAC-SHA-256 签名 session。session cookie 使用 `Secure`、`HttpOnly`、`SameSite=Strict`，path 为 `/api/admin`。所有 `/api/admin` 及其子 route 都必须先验证 session；缺失、签名无效或过期的 session 返回同一种未认证响应。

### 管理员问卷页

- 上传问卷 CSV
- 不上传 CSV，直接通过简易表单创建新问卷
- 接受问卷前显示校验错误
- 列出可用问卷的标识符、标题、上传时间，以及无需数据库索引即可获取时的答卷数量
- 打开指定问卷的答卷列表

直接创建问卷时，管理员填写问卷标题，并按顺序增加、移除或调整题目。每道题可设置 `question_id`、`type`、`label`、`required` 和 `options`，支持的题型及全部限制与 CSV 问卷完全一致。

手工创建表单提交结构化数据；服务端必须重新校验并序列化为符合本规格的标准 CSV，再复用既有 CSV 校验和 R2 存储流程。R2 中仍只保存 `definition.csv` 和 `metadata.json`，不得为手工创建问卷引入第二套数据结构。

手工创建的标题必须包含 1 至 251 个 Unicode code point，且不得包含路径分隔符、NUL 或其他控制字符。服务端使用 `${title}.csv` 作为内部 `source_filename`，`metadata.json` 中的 `title` 仍保存管理员输入的标题。

### 管理员答卷页

- 列出指定问卷的 `submission_id`、客户 Email 和提交时间
- 打开单份答卷
- 将所选问卷的全部答卷导出为 CSV

## 4. 问卷 CSV 约定

每个上传文件代表一份问卷。文件必须是带表头的 UTF-8 CSV。问卷标题取自去掉 `.csv` 扩展名后的上传文件名。上传时由服务生成稳定的内部 `survey_id`；文件名不得直接用作 R2 object key。

上传文件名必须以 `.csv` 结尾，最多包含 255 个 Unicode code point，且不得包含路径分隔符、NUL 或其他控制字符。去掉扩展名后的标题不得为空。

必需字段及固定顺序：

```csv
question_id,type,label,required,options
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `question_id` | 必填。在一份问卷中唯一。只能包含 ASCII 字母、数字、`_` 和 `-`。 |
| `type` | 必填。只能是 `text`、`textarea`、`email`、`number`、`single_choice` 或 `multi_choice`。 |
| `label` | 必填。供用户阅读的题目文本。包含逗号、引号或换行时，使用标准 CSV 引号转义。 |
| `required` | 必填。只能是小写的 `true` 或 `false`。 |
| `options` | 选择题必填，其他题型必须为空。选项使用 `|` 分隔；每个选项首尾的空白会被忽略。 |

其他校验规则：

- 至少包含一道题。
- 忽略空白行。
- 1.0 拒绝未知字段或重复字段。
- 拒绝重复的 `question_id` 和空选项。
- 任意一行无效时，整份问卷都不接受。

1.0 限制：

- CSV 文件最大为 256 KiB，以 UTF-8 编码后的 byte 数计算。
- 每份问卷最多包含 200 道题。
- `question_id` 最多包含 64 个字符。
- `label` 最多包含 1000 个 Unicode code point。
- `options` 字段最多包含 4000 个 Unicode code point。
- 每道选择题最多包含 50 个选项，每个选项最多包含 200 个 Unicode code point。
- Worker 必须强制执行全部限制；后续实现上传界面时，界面也必须执行相同限制。

示例：

```csv
question_id,type,label,required,options
name,text,What is your name?,true,
rating,single_choice,How satisfied are you?,true,Very satisfied|Satisfied|Neutral|Dissatisfied
comments,textarea,Anything else?,false,
```

## 5. R2 数据结构

所有 object 都放在带版本号的 prefix 下。标识符必须由 Worker 生成，并在拼入 object key 前完成校验。

```text
v1/
  surveys/
    {survey_id}/
      definition.csv
      metadata.json
  submissions/
    {survey_id}/
      {submitted_at}_{submission_id}.json
```

内部标识符与时间戳规则：

- `survey_id` 和 `submission_id` 由 Worker 使用 `crypto.randomUUID()` 生成。
- `survey_id` 和 `submission_id` 必须是小写、带连字符的标准 UUID v4，例如 `123e4567-e89b-42d3-a456-426614174000`。
- 标识符不得包含 `/`、`\\`、`..`、空白或其他不属于标准 UUID v4 的字符。
- `submitted_at` 必须是 UTC、带三位毫秒且以 `Z` 结尾的规范 ISO-8601 时间戳，例如 `2026-10-10T00:00:00.000Z`。
- object key 只能由服务端 helper 根据已校验的值构造；不得接受浏览器直接提交的完整 key。

### `definition.csv`

保存通过校验的原始问卷 CSV。问卷收到答卷后，1.0 将其定义视为不可变数据。

创建问卷时，`definition.csv` 和 `metadata.json` 都使用仅在目标 key 不存在时才成功的 conditional write。上传流程不得覆盖已有 object。

### `metadata.json`

只包含渲染和列出问卷所需的元数据：

```json
{
  "schema_version": 1,
  "survey_id": "123e4567-e89b-42d3-a456-426614174000",
  "title": "Questionnaire title",
  "source_filename": "questionnaire.csv",
  "created_at": "ISO-8601 UTC timestamp",
  "status": "active"
}
```

### 答卷 JSON

每次成功提交都创建一个新 object；正常提交流程不得覆盖已有答卷 object。

```json
{
  "schema_version": 1,
  "submission_id": "987e6543-e21b-42d3-b456-426614174999",
  "survey_id": "123e4567-e89b-42d3-a456-426614174000",
  "survey_schema_version": 1,
  "email": "respondent@example.com",
  "submitted_at": "2026-10-10T00:00:00.000Z",
  "answers": {
    "question_id": "answer or array of answers"
  }
}
```

单值答案使用 string。`multi_choice` 答案使用 string array。服务端对照已保存的问卷定义校验答案，校验通过后才写入 object。

答卷校验规则：

- 客户 Email 去除首尾空白后必须包含非空的本地部分和域名，只能包含一个 `@`，域名必须包含 `.`，不得包含空白或控制字符，且最多包含 254 个 Unicode code point。1.0 只校验语法，不验证 Email 所有权。
- 答案只能包含当前问卷定义中的 `question_id`；提交未知 `question_id` 不能绕过服务端校验。
- `required` 题必须提供非空答案；未填写的非必填单值题规范化为空 string，未填写的非必填 `multi_choice` 规范化为空 array。
- `text` 和 `textarea` 答案最多包含 4000 个 Unicode code point。
- `email` 题使用与客户 Email 相同的语法和 254 字符限制。
- `number` 题使用 string 保存，去除首尾空白后必须是有限的十进制数，最多包含 100 个字符。
- `single_choice` 必须是问卷定义中的一个选项；`multi_choice` 必须是由问卷定义选项组成的无重复 string array。
- 提交后由 Worker 生成 `submission_id` 和 `submitted_at`；浏览器不得指定这两个字段或完整 R2 object key。

1.0 使用 R2 object listing 作为问卷和答卷索引，不维护独立数据库、可变计数器或二级索引。因此，数量可以按需计算；当列表可能超过单页 R2 listing 容量时必须分页。

问卷列表和答卷列表的默认分页大小均为 50 条，单页最多为 100 条。客户端只能使用服务端返回的 opaque `cursor` 请求下一页。

问卷列表扫描 `v1/surveys/` prefix，只读取以 `/metadata.json` 结尾的 object。分页依据 R2 返回的 `truncated` 状态，并将 opaque `cursor` 原样传给下一次 listing；不得根据返回数量推测是否还有下一页。

## 6. 导出格式

为指定问卷导出一份带 UTF-8 BOM 的 UTF-8 CSV，以便 Excel 等常见表格软件正确识别中文编码：

- 每份答卷占一行
- 固定的前三列为 `submission_id`、`email`、`submitted_at`
- 后续按问卷顺序为每个 `question_id` 建立一列
- `multi_choice` 答案使用 `|` 连接
- 未填写的非必填答案导出为空单元格
- 对逗号、引号和换行使用标准 CSV 转义

1.0 单次导出最多处理 1000 份答卷，生成的 CSV 最大为 16 MiB。Worker 在返回下载响应前必须完整读取并校验范围内的答卷；超过任一限制时返回明确错误，不返回不完整的 CSV。

## 7. 安全与数据处理边界

- 仅管理员可访问的 route 和导出功能必须要求有效的管理员 session。
- 客户提交数据时，浏览器不得直接指定 R2 object key。
- Email 和答案属于私密数据，不得主动写入日志。
- CSV 上传内容和所有客户输入都必须在服务端校验。
- 不检查或修改 Secrets 和本地 secret 文件。
- production 部署及任何破坏性 R2 操作始终需要用户明确批准。

## 8. 1.0 明确不做

- D1 或其他数据库
- 大型前端或后端 framework
- 多管理员、邀请、角色或密码找回
- 客户账号、magic link、Email 验证或邮件发送
- 匿名答卷
- 编辑、版本化、替换、归档或删除问卷
- 编辑或删除已提交的答卷
- 保存草稿、稍后继续或离线填写
- 条件题、分支逻辑、分页逻辑、评分、测验或富媒体
- 文件上传题
- 问卷主题定制、完整可视化问卷编辑器、拖拽布局、模板或预览；1.0 只提供管理员手工录入题目的简易创建表单
- 图表、分析 dashboard、自动报告或定时导出
- 第三方集成、webhook 或 public API
- 问卷自带文本之外的本地化功能
- production 部署自动化

## 9. 1.0 闭环完成定义

满足以下完整流程即视为 1.0 完成：管理员可以登录，通过上传有效 CSV 或简易表单创建问卷；客户可以输入 Email，为该问卷提交有效答案；新答卷 object 成功保存到 R2；管理员可以查看并导出这些答卷；整个流程不使用其他持久化服务。
