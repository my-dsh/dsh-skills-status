# @my-dsh/dsh-skills-status

[English](README.md) | 中文

一个 DeepSeek Harness 插件，在消息输入框左侧工具栏放置「技能加载」按钮，位置紧邻 MCP 连接按钮的右侧。它列出当前工作区可加载的全部技能，逐个开关，并把开关状态**按工作区保存到 SQLite**——重新打开工作区时，恢复上次保存的加载状态。

## 界面

按钮显示已加载/总数（`技能 29/29`）。点击展开面板：

- 标题行只有「技能」、读数与关闭按钮。
- 搜索框在读数旁，输入即时过滤（名字与描述都参与匹配）。
- 列表按上游仓库分段。每个技能一行：左边一枚**字形块**（名字前三个连字符段的首字母，如 `cloudflare-one-migrations` → `com`，全目录内不重复），右边是开关。
- **名字下面直接是那句描述**——它是唯一能帮你判断「这条要不要开」的信息，所以不再藏在 `title` 悬停里。
- 关掉的行：字形块只剩描边，整行不做强调；不另写「已关闭」状态词，状态只由字形块与开关表达。
- 组头左侧是三态全选方框（全开 / 部分 / 全关），右侧是该组计数。
- 底栏：「全部加载 / 全部关闭 / 刷新」与当前工作区名；按钮在无意义时（例如已经全开时的「全部加载」）不出现。

## 行为

| 方面 | 说明 |
|---|---|
| 存储 | 单个 SQLite 数据库 `$DSH_HOME/skills-status/skills-status.db`（可用 `databasePath` 覆盖），表 `skill_state(workspace, skill, enabled, description, source, upstream, upstream_url, updated_at)` |
| 工作区键 | 包含该会话目录的最深一层已注册工作区；不属于任何工作区时用其真实路径 |
| 默认值 | 没有记录行的技能视为**已加载**（即原有行为），因此未关闭任何技能时表为空 |
| 显示范围 | 默认隐藏来源为「自定义目录」（`custom`）的技能——该根指向 DSH 安装目录内自带的技能，因此面板只列你实际安装的技能；被隐藏的技能保留其开关记录，不会被静默重新启用 |
| 分组 | 按**上游仓库**分段（如 `cloudflare/skills`、`mattpocock/skills`），组头显示「已加载/总数」。**分组不可折叠**：列表本身会滚动，而「全关即折叠 + 手动折叠」需要记住每个折叠是谁关的，是个用户看不见的状态机 |
| 分组批量开关 | 组头左侧的三态方框一键切换整组：全开时点击全关，否则点击全开；只影响该组 |
| 行内描述 | 每行第二段文字是技能描述（单行截断，完整文本在 `title` 里）。描述为空时回退显示该技能的发现来源 |
| 作用范围 | 按工作区而非会话：同一工作区的所有会话共用开关 |
| 生效时机 | 切换立即生效，下一步模型请求即看到新的技能目录，无需重启 |
| 重新打开 | 每次构建技能目录都读取数据库，因此重开工作区即恢复上次的设置 |

## 上游分组怎么来的

技能的「来源」只说明它被扫描到的位置（用户 `.agents`、项目 `.agents` 等），不说明作者。上游信息来自两处，按顺序回退：

1. **安装锁文件** `~/.agents/.skill-lock.json`（以及项目根下的 `.agents/.skill-lock.json`）：记录 `source`（`<owner>/<repo>`）、`sourceUrl` 等，是经 skills CLI 安装的技能的唯一权威来源。
2. **技能自身的 frontmatter**：没有锁记录的技能（例如直接克隆或由其他工具安装），读取其 `SKILL.md` 里 `metadata.repository`（优先）或 `metadata.homepage`。

两处都没有时归入 `local` 分组，并排在最后。

**分组是技能的属性，不是开关的属性。** 被关闭的技能由遮蔽层挡在目录之外，它那一行要按「关掉时记下的内容」重建。这份记录除了描述，还带上 `upstream` / `upstream_url`；遮蔽层保留了真实的指令文件路径，所以技能隐藏期间 frontmatter 回退照样成立。更早版本写下的行（没记分组）会在下一次 Agent 同步时补上——那是真实条目唯一还可见的时刻。没有这一条，像 `huashu-design` 这种直接克隆安装、锁文件里没有记录、上游只能从 `SKILL.md` 读出来的技能，就会开着时在 `alchaincyf/huashu-design`、一关就掉进 `local`。

## 关闭技能的原理

插件不注销、也不改动任何原有条目。技能注册表（`ctx.skills`）会把全局层与当前 Agent 的 scope 链合并，**最近一层的同名条目直接胜出**。对每个被关闭的技能，插件在该 Agent 自己的 scope 内（`agent.ctx`）注册一个同名运行时技能，其调用策略为：

```js
invocation: { modelInvocable: false, userInvocable: false }
```

所有消费方都按该策略过滤——面向模型的 `<available_skills>` 目录、`skill` 工具、`/` 指令菜单、`/名称` 手势——于是该技能从这四处同时消失，而注册表仍保留原定义以便重新开启。重新开启即销毁这层遮蔽。

遮蔽在 `agent/created` 时安装，并在 `skills/change` 时重新对齐，因此「先关闭、后才发现」的技能同样会被遮蔽。

## 安装

需要一个 web surface profile（`dsh web` 的默认 profile 名是 `web`）。`git` 和 `pnpm`
都要在 `PATH` 上。

```sh
# 从 GitHub 直装
dsh plugin --profile web add github:my-dsh/dsh-skills-status

# 或从本地克隆安装
dsh plugin --profile web add /path/to/dsh-skills-status
```

装完重启 DSH，按钮即出现在输入框左侧工具栏。

也可在插件管理器中以 bundle 方式安装该目录。bundle patch 只插入一个 Host 行（`skills-status`），且不声明任何包依赖：只引用 Node 内置模块；客户端部分是纯 JavaScript 模块，注册到 `conversation.input.left` 的 `order: 1`，正好排在 MCP 按钮（`order: 0`）之后。

## 配置

```yaml
- id: skills-status
  name: '@my-dsh/dsh-skills-status'
  config:
    databasePath: /var/lib/dsh/skills-status.db   # 默认：$DSH_HOME/skills-status/skills-status.db
    hiddenSources: [custom]                       # 默认隐藏「自定义目录」；传 [] 可全部显示
```

## Host 路由

两条路由都走带鉴权的共享 `/api` 通道，未鉴权无法访问：

| 路由 | 方法 | 参数 |
|---|---|---|
| `/api/skills-status.list` | GET | `?sessionId=<id>` |
| `/api/skills-status.set` | POST | `{ "sessionId": "...", "skill": "...", "enabled": true }` |

## 文件

| 文件 | 作用 |
|---|---|
| [`index.js`](index.js) | Host 半部：SQLite 存储、工作区解析、按 Agent 遮蔽、两条路由 |
| [`client.js`](client.js) | 客户端半部：输入框工具栏按钮与面板 |
| [`cordis.patch.yml`](cordis.patch.yml) | 插入 Host 行的 bundle patch |
| [`locale/en.json`](locale/en.json)、[`locale/zh.json`](locale/zh.json) | 插件管理器中的标题与描述 |
| [`icon.svg`](icon.svg) | 插件图标 |
| [`test/upstream-stability.test.mjs`](test/upstream-stability.test.mjs) | 回归测试：关掉开关不得改变分组（`node --test test/*.test.mjs`） |

## 已知限制

- 面板显示的是「打开面板的那个会话」的技能目录。若同一工作区的会话使用不同 Agent 预设，不同会话看到的技能集合可能不同，但开关本身仍是共享的。
- 从磁盘删除的技能会留下一条过期记录，直到它再次被发现；面板只是不再列出它。
- `node:sqlite` 在 Node 22 上会打印实验性特性警告，Harness 自身的 SQLite 后端同样如此。
