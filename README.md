# Embed HTML

在 Obsidian 笔记中直接渲染本地 HTML 文件。纯 JavaScript 实现,**无构建、无依赖,clone 即用**。

```markdown
```embed-html
path: 测试页面.html
height: 380
pathType: srcdoc
theme: auto
```
````

## 特性

- **独立语法**:```` ```embed-html ```` 代码块,不改动任何既有语法(`![[..]]` 与 `<iframe>` 保持 Obsidian 原生行为)
- **尺寸控制**:`height` 支持 px / vh / % / `auto`(按内容自适应,`ResizeObserver` 跟踪动态变化)
- **三种加载策略**:`resource`(官方资源协议,默认)/ `local`(绝对路径协议)/ `srcdoc`(内容内联),悬浮控制条可实时切换与重载
- **主题跟随**:`theme: auto` 跟随 Obsidian 明暗主题实时切换(iframe 不重载、内部状态不丢);可固定 `light` / `dark` 或 `none`
- **完全透明容器**:容器与 iframe 始终透明、无边框,嵌入块融入笔记;页面背景由 HTML 自身决定
- **诊断友好**:路径缺失 / 文件不存在显示明确的 ⚠️ 提示;控制条显示加载状态
- **零侵入**:接管 `![[xx.html]]` 等旧语法的"兼容模式"默认关闭

## 参数

| 参数 | 说明 | 可选值 |
|---|---|---|
| `path` | 库内 HTML 文件路径 | 库内任意路径;**可省略参数名直接写在首行** |
| `height` | 块高度 | 数字(px)/ `50vh` / `80%` / `auto`;缺省用插件设置(默认 480px) |
| `pathType` | 加载策略 | `resource` / `local` / `srcdoc`;缺省用插件设置 |
| `theme` | 主题 | `auto`(默认,跟随 Obsidian)/ `light` / `dark` / `none` |

- 参数仅支持英文键名;`//` 开头的行视为注释
- `path` 缺失或文件不存在时显示错误提示,不会静默失败

### 主题机制与透明容器

`srcdoc` 策略下,插件会向文档 `<head>` 注入一段引导脚本:在 `<html>` 上挂 `lhe-dark` / `lhe-light` 类;Obsidian 切换主题时插件通过 postMessage 实时广播,**iframe 不重载**。被嵌入的 HTML 想适配主题,按类名写 CSS 变量即可:

```css
:root          { color-scheme: dark;  --bg: #0b1220; --fg: #e2e8f0; }
html.lhe-light { color-scheme: light; --bg: #eef2f7; --fg: #0f172a; }
body { background: var(--bg); color: var(--fg); }
```

容器与 iframe 始终完全透明(v1.5.0 起,原 `transparent` 参数已移除):嵌入块融入笔记,页面背景由 HTML 自身决定 —— 想透明的 HTML 不写背景即可。

`resource` / `local` 策略是真实文件导航,插件无法改写文档内容 —— 这两种策略下 `theme` 只影响 iframe 本体(`color-scheme`),文档内部需按上述约定自行适配。

## 安装

### 方式一:clone 即用(推荐)

```bash
git clone https://github.com/LeonardoLu/obsidian-embed-html.git \
  "<你的库>/.obsidian/plugins/obsidian-embed-html"
```

仓库内已包含可直接加载的 `main.js`,**无需 `npm install`,无需构建**。重启 Obsidian,或在 设置 → 第三方插件 中启用 **Embed HTML**。

### 方式二:BRAT

安装 BRAT 插件 → `Add beta plugin` → 输入 `LeonardoLu/obsidian-embed-html`。

### 方式三:手动

下载 `main.js`、`manifest.json`、`styles.css` 三个文件,放到 `<你的库>/.obsidian/plugins/obsidian-embed-html/`。

## 命令与设置

命令面板:
- **Embed HTML: 重新渲染全部笔记视图**
- **Embed HTML: 用内嵌视图打开当前 HTML 文件**

设置项:默认加载策略 / 默认主题跟随 / 默认块高度 / 兼容模式(重写旧语法,默认关)/ 显示悬浮控制条。

## 开发

纯 JavaScript,无构建步骤。直接修改 `main.js`,然后在 设置 → 第三方插件 中把插件关掉再打开(或重载 Obsidian)即可生效。

```
obsidian-embed-html/
├── main.js        # 插件本体(Obsidian 直接加载)
├── manifest.json
├── styles.css
├── versions.json
└── README.md
```

## 能力边界(实测结论)

- Obsidian 会净化笔记内联的 `<script>`,并拦截手写的本地文件 iframe(相对路径 / `file://` / `app://`)—— 这是安全边界,不是 bug
- iframe 内部文档不受主页面 CSP 限制:srcdoc / data: URI / `app://` 文件的 JS 均可执行,因此嵌入块的能力上限是**完整 Web 应用**(事件、requestAnimationFrame、键盘输入、ResizeObserver 均可用)
- 本插件正是从这两处各开一个口:代码块语法绕过净化面,`getResourcePath()` 运行时动态构造 URL 绕过 URL 解析面(不写死库 ID,库拷贝到其他设备依然可用)

## License

[MIT](LICENSE) © Leonardo Lu
