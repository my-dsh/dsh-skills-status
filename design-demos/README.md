# 设计过程留档 · 技能加载面板

这个目录是面板重设计的工作记录，不是插件运行需要的文件。

| 文件 | 是什么 |
|---|---|
| `thumbs.html` / `thumbs.png` | 六个候选的缩略图总览（A–F 各一格） |
| `dir-1.html` / `dir-1.png` | 方向 A：每行一张脸（Susan Kare，描述优先） |
| `dir-2.html` / `dir-2.png` | 方向 B：读数带（Rams / Braun，26 段刻度） |
| `dir-3.html` / `dir-3.png` | 方向 C：作用域筛选（VS Code 扩展视图，删掉折叠树） |
| `panel-1/2/3.png` | 三版面板的亮暗并排裁切（用来横比骨架） |
| `live-light.png` / `live-dark.png` | **落地后**从真实宿主页面截的技能面板（亮/暗） |
| `trigger.png` | 触发器在输入框工具栏里的实际样子（和 MCP 按钮同一行） |
| `index.html` / `compare.png` | 三方向并排对比页（拿去给用户选的那张） |
| `build_demos.py` | 三份 demo 的生成脚本：同一份真实数据、同一套令牌，只换骨架 |
| `.skills-fixture.json` | 真实内容：本机 26 个技能、6 个上游、10 个已加载（从 `~/.agents` 与 `.skill-lock.json` 读出来的） |

`dir-*.html` 里的面板是**静态复刻**，用同一套 DSH 主题令牌和同一份真实内容，
用来在选定方向前横向比较骨架；真正的实现会落在仓库根目录的 `client.js`。

每份 demo 除了亮暗两个默认态，下面还并排给出同一版的另外三态：筛选中、无匹配、切换失败。
这三态在现在的插件里本来就有（`client.js` 的 note 与空结果分支），只设计默认态等于只做了一半。

## 体检：不用 playwright，用 chrome-devtools-mcp

`design_lint.py` 只用 playwright 做三件事——打开页面、执行它内嵌的 `COLLECT_JS`、
截图。前两件 Chrome DevTools 完全能做，所以这里有一套替代链路，跑的是
**design_lint 自己的判定函数**，阈值和词汇表完全一致：

| 文件 | 是什么 |
|---|---|
| `probe.mjs` | 用 Chrome 跑 design_lint 的 `COLLECT_JS`，把事实存成 JSON |
| `lint.py` | 把事实喂给 `design_lint.judge()` / `families()`，跑全部检查 |
| `shot.mjs` | 用 CDP 截图（亮/暗、整页/元素裁切） |
| `fingerprint.mjs` | 从截图算色板与版式骨架向量（替代 Pillow 那两项） |
| `measure.mjs` | 1440 / 375 两个宽度的溢出体检（skill 的响应式要求） |
| `live.mjs` | 在**真实宿主页面**里开面板、量尺寸、截图（`--open` / `--shot`） |
| `verify.mjs` | 在真实页面上点一遍：单行开关、组头三态、筛选、空态、Esc，13 条断言 |
| `.collect.js` | 从 design_lint.py 导出的采集器源码（由 build 时生成） |

用法：

```sh
# 起一个静态服务（file:// 在 WSL 里读不到工作区外的路径）
python3 -m http.server 8765 --bind 127.0.0.1

# 截图
node design-demos/shot.mjs http://127.0.0.1:8765/design-demos/dir-2.html \
  design-demos/dir-2.png --width 900 --height 900

# 采集事实（--expand 把列表内滚展开，--selector 只量面板子树）
node design-demos/probe.mjs http://127.0.0.1:8765/design-demos/dir-2.html \
  design-demos/.facts/dir-2-light.json --selector ".surface:not(.dark) .panel" --expand

# 落地后在真实宿主页面上量（--attach 连已经开着的页面，不新开）
node design-demos/live.mjs --open
node design-demos/probe.mjs live design-demos/.facts/live-light.json \
  --attach 3080 --selector ".dshsk-panel" --expand

# 真实页面上的功能断言
node design-demos/verify.mjs

# 判定
python3 design-demos/lint.py design-demos/.facts/dir-2-light.json
python3 design-demos/lint.py --families design-demos/.facts/dir-2-light.json

# 骨架撞没撞（--brand：颜色和字体被 DSH 令牌锁死，只比骨架）
node design-demos/fingerprint.mjs design-demos/.facts/only-{1,2,3}.png \
  --out design-demos/.facts/fp-single.json
python3 design-demos/lint.py --compare --brand design-demos/.facts/fp-single.json

# 和外观账本比（第三个参数是本项目名，用来跳过自己那一行）
python3 design-demos/lint.py --ledger-check design-demos/.facts/fp-single.json \
  ~/.huashu-design/ledger.jsonl dsh-skills-status

# 交付后记一笔（Pillow 不可用，所以指纹来自 fingerprint.mjs）
node design-demos/fingerprint.mjs design-demos/live-light.png --out design-demos/.facts/fp-live.json
python3 design-demos/lint.py --ledger-add design-demos/.facts/live-light.json \
  design-demos/.facts/fp-live.json dsh-skills-status "一句话说明这版长什么样"

# 响应式
node design-demos/measure.mjs http://127.0.0.1:8765/design-demos/dir-1.html --widths 1440,375

```

比骨架要用**单个面板的裁切**（`only-*.png`）。拿整页截图去比会把三份 demo 页共用的
说明文字和署名一起算进骨架，三版相关度都虚高到 0.76 以上，读起来像"三版同一个骨架"——
那是页面外壳的相关，不是面板的相关。

### 两个采样陷阱，以及处理方式

1. **半透明毛玻璃面**。`--dsw-specific-menu` 亮色是 `rgba(248,249,250,.58)`，
   这是 DSH 有意的设计。`COLLECT_JS` 用 `elementsFromPoint` 取背景色，会直接
   穿透到面板下面，把深色面板压在白页上读成白底白字（实测记录 1.02:1，实际 13.5:1）。
   `probe.mjs` 在采集期间把根节点的背景替换成**逐层压平后的实际表面色**，采完还原——
   设计本身不动，只是让采样器看到用户看到的东西。
2. **列表内滚裁切**。面板内部的滚动容器会把折行以外的行裁掉，`elementsFromPoint`
   看不到它们，同样读成白底白字。`--expand` 在采集期间把面板高度设为 auto、
   滚动容器 overflow 设为 visible，让每一行都真的画出来。


### 实测数字（亮色）

| 令牌 | 压平后表面 | 对比度 | 结论 |
|---|---|---|---|
| `label-primary` #0f1115 | rgb(251,252,252) | **18.39:1** | 可用 |
| `label-secondary` #61666b | rgb(251,252,252) | **5.64:1** | 可用 |
| `label-tertiary` #81858c | rgb(251,252,252) | **3.61:1** | **不达 4.5:1，不能用于任何文字** |

暗色（`--dsw-specific-menu` = rgba(67,69,74,.45) 压在 #151517 上 → rgb(42,43,46)）：
primary 13.55、secondary 9.40、tertiary 6.63。三版全部只用 primary / secondary。

### 骨架对比

`design_lint.similar(..., brand=True)`（颜色与字体被 DSH 令牌锁死，只比版式骨架）：

| 版本对 | 版式相关 | 结论 |
|---|---|---|
| A vs B | −0.04 | 不撞 |
| A vs C | 0.05 | 不撞 |
| B vs C | 0.38 | 不撞（阈值 0.55） |

三版不是换皮。
