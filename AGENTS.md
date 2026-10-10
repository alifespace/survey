# 项目规则

- 除非用户明确要求，否则只修改 `learning/survey1` 内的文件，不修改同级目录。
- `AGENTS.md`、`SPEC.md`、`TASKS.md` 和 `README.md` 使用中文。程序界面文案可以使用中文或英文，当前界面默认使用中文；除此之外，代码、代码注释、测试、配置、变量名、文件名、API 路径、数据字段以及其他所有内容均使用纯英文。
- 技术栈仅限 Cloudflare Workers、Static Assets 和 Cloudflare R2。未经明确批准，不引入数据库或大型 framework。
- Cloudflare 开发当前使用项目本地安装的 Wrangler v4。
- 使用 Workers Static Assets，不使用已弃用的 Workers Sites、`wrangler publish` 或其他 legacy 配置。
- 除非用户明确要求，不迁移到仍处于 beta 的 Cloudflare `cf` CLI。
- 软件安装、脚本运行和测试统一使用 pnpm，不使用 npm、Yarn 或 Bun。
- 不读取或修改 Secrets、`.dev.vars` 或真实客户数据。
- 未经明确批准，不部署 production。
- 未经明确批准，不删除或修改 R2 中的现有数据。
- 只实现 `SPEC.md` 定义的范围；计划发生变化时，同步维护 `TASKS.md` 的验收标准。
- 修改完成后，准确说明修改了哪些文件。
