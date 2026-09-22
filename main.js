'use strict';

var obsidian = require('obsidian');

var VIEW_TYPE = 'embed-html-view';
var STRATS = ['resource', 'local', 'srcdoc'];
var STRAT_LABEL = { resource: '资源URL', local: '本地协议', srcdoc: '内联' };
var EXTERNAL_SRC = /^(https?:|data:|blob:|app:|file:)/i;
/* 代码块内可识别的选项键(仅英文,键名一律小写比较) */
var SPEC_KEYS = { path: 'path', height: 'height', pathtype: 'pathType', theme: 'theme', transparent: 'transparent' };
var DEFAULT_HEIGHT = '480px';

function errBox(text) {
  var div = document.createElement('div');
  div.className = 'lhe-error';
  div.textContent = '⚠️ ' + text;
  return div;
}

/* "360" / "360px" / "50vh" / "80%" / "auto" → 合法 CSS 高度;非法时返回 fallback(未提供则 null) */
function normalizeHeight(raw, fallback) {
  var s = raw == null ? '' : String(raw).trim();
  if (/^\d+$/.test(s)) return s + 'px';
  if (/^\d+(px|vh|%)$/.test(s)) return s;
  if (s === 'auto') return 'auto';
  return fallback !== undefined ? fallback : null;
}

function normalizeTheme(raw, fallback) {
  var s = raw == null ? '' : String(raw).trim().toLowerCase();
  if (s === 'light' || s === 'dark' || s === 'none' || s === 'auto') return s;
  return fallback;
}

function isTruthy(v) {
  return /^(true|1|yes|on)$/i.test(String(v == null ? '' : v).trim());
}

/* Obsidian 当前主题(body 上的 theme-dark / theme-light 类) */
function currentTheme() {
  return document.body && document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

/* height:auto 时把 iframe 撑到内容高度(需同源可访问;ResizeObserver 跟踪后续变化) */
function sizeFrameToContent(frame, doc) {
  if (frame._ro) { frame._ro.disconnect(); frame._ro = null; }
  var measure = function () {
    try {
      frame.style.height = '0px'; // 先归零,才能量出内容收缩后的真实高度
      var h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (h > 0) frame.style.height = h + 'px';
    } catch (e) { /* 文档不可访问 */ }
  };
  measure();
  if (typeof ResizeObserver === 'function') {
    frame._ro = new ResizeObserver(function () { measure(); });
    try { frame._ro.observe(doc.body); } catch (e) { /* 忽略 */ }
  }
}

/* 往 srcdoc 文本注入主题引导脚本与透明样式(仅 srcdoc 策略可注入) */
function injectInto(html, theme, transparent) {
  var extra = '';
  if (theme === 'light' || theme === 'dark') {
    extra += '<script>(function(){var d=document.documentElement;function ap(t){d.classList.remove("lhe-dark","lhe-light");'
      + 'd.classList.add(t==="dark"?"lhe-dark":"lhe-light")}'
      + 'window.addEventListener("message",function(e){var a=e&&e.data;if(a&&a.__lhe)ap(a.theme)});ap("' + theme + '")})()</script>';
  }
  if (transparent) {
    extra += '<style>html,body{background:transparent!important}</style>';
  }
  if (!extra) return html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + extra; });
  return extra + html;
}

/* ---------- 打开 .html 文件的独立视图 ---------- */

class HtmlView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'HTML 页面'; }
  getIcon() { return 'file-code'; }

  setState(state, result) {
    this.file = state && state.file ? this.plugin.app.vault.getAbstractFileByPath(state.file) : null;
    return super.setState(state, result);
  }

  getState() {
    var state = super.getState();
    state.file = this.file ? this.file.path : null;
    return state;
  }

  async onOpen() {
    var content = this.contentEl;
    content.empty();
    content.addClass('lhe-view');
    if (!(this.file instanceof obsidian.TFile)) {
      content.createDiv({ text: '未找到 HTML 文件' });
      return;
    }
    var frame = document.createElement('iframe');
    frame.className = 'lhe-frame lhe-full';
    content.appendChild(frame);
    this.plugin.attachWith(frame, this.file, this.plugin.settings.strategy, null);
  }

  async onClose() { this.contentEl.empty(); }
}

/* ---------- 设置面板 ---------- */

class LheSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    var container = this.containerEl;
    container.empty();

    new obsidian.Setting(container)
      .setName('默认加载策略')
      .setDesc('resource = Obsidian 资源协议(app://库ID/…);local = 本地绝对路径协议(app://local/…);srcdoc = 把文件内容内联进 iframe(不依赖协议)。代码块里可用 pathType 覆盖')
      .addDropdown(function (drop) {
        drop.addOption('resource', '资源URL(app://库ID)')
          .addOption('local', '本地协议(app://local/)')
          .addOption('srcdoc', '内联 srcdoc')
          .setValue(this.plugin.settings.strategy)
          .onChange(function (value) {
            this.plugin.settings.strategy = value;
            this.plugin.saveData(this.plugin.settings);
          }.bind(this));
      }.bind(this));

    new obsidian.Setting(container)
      .setName('默认主题跟随')
      .setDesc('auto = 跟随 Obsidian 明暗主题并实时切换;light / dark = 固定;none = 不注入主题。代码块里可用 theme 覆盖(仅 srcdoc 策略能注入到文档内部)')
      .addDropdown(function (drop) {
        drop.addOption('auto', '跟随 Obsidian(auto)')
          .addOption('light', '固定 light')
          .addOption('dark', '固定 dark')
          .addOption('none', '不注入(none)')
          .setValue(this.plugin.settings.theme)
          .onChange(function (value) {
            this.plugin.settings.theme = value;
            this.plugin.saveData(this.plugin.settings);
            this.plugin.rerenderAll();
          }.bind(this));
      }.bind(this));

    new obsidian.Setting(container)
      .setName('默认块高度')
      .setDesc('embed-html 块未写 height 时使用:纯数字按 px,支持 50vh / 80%,或 auto(按内容自适应,需同源可访问,建议搭配 srcdoc 策略)')
      .addText(function (text) {
        text.setPlaceholder('480')
          .setValue(this.plugin.settings.defaultHeight)
          .onChange(function (value) {
            this.plugin.settings.defaultHeight = value.trim() || '480';
            this.plugin.saveData(this.plugin.settings);
          }.bind(this));
      }.bind(this));

    new obsidian.Setting(container)
      .setName('兼容模式:重写旧语法(默认关闭)')
      .setDesc('开启后插件会接管 ![[xx.html]] 原生嵌入与笔记内指向库内文件的 <iframe src>;关闭则两者保持 Obsidian 原生行为,渲染请使用 embed-html 代码块')
      .addToggle(function (toggle) {
        toggle.setValue(this.plugin.settings.legacyRewrite)
          .onChange(function (value) {
            this.plugin.settings.legacyRewrite = value;
            this.plugin.saveData(this.plugin.settings);
          }.bind(this));
      }.bind(this));

    new obsidian.Setting(container)
      .setName('显示悬浮控制条')
      .setDesc('在渲染块右上角显示加载状态与策略切换按钮(鼠标悬浮时出现)')
      .addToggle(function (toggle) {
        toggle.setValue(this.plugin.settings.showBar)
          .onChange(function (value) {
            this.plugin.settings.showBar = value;
            this.plugin.saveData(this.plugin.settings);
          }.bind(this));
      }.bind(this));
  }
}

/* ---------- 主插件 ---------- */

module.exports = class LocalHtmlEmbedPlugin extends obsidian.Plugin {
  async onload() {
    var saved = await this.loadData();
    this.settings = Object.assign(
      { strategy: 'resource', legacyRewrite: false, showBar: true, defaultHeight: '480', theme: 'auto' },
      saved || {}
    );
    this._frames = [];

    this.registerView(VIEW_TYPE, function (leaf) { return new HtmlView(leaf, this); }.bind(this));
    this.addSettingTab(new LheSettingTab(this.app, this));

    /* 独立语法:```embed-html 代码块 */
    this.registerMarkdownCodeBlockProcessor('embed-html', function (source, el, ctx) {
      this.renderCodeBlock(source, el, ctx);
    }.bind(this));

    /* 兼容模式(默认关闭):接管旧语法 */
    this.registerMarkdownPostProcessor(function (el, ctx) {
      if (this.settings.legacyRewrite) this.processLegacy(el, ctx);
    }.bind(this));

    /* Obsidian 明暗主题切换 → 实时广播给所有已渲染的 iframe(postMessage,不重载) */
    this._mo = new MutationObserver(function () { this.broadcastTheme(); }.bind(this));
    this._mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    this.addCommand({
      id: 'open-html-view',
      name: '用内嵌视图打开当前 HTML 文件',
      checkCallback: function (checking) {
        var active = this.app.workspace.getActiveFile();
        if (!(active instanceof obsidian.TFile) || !/\.html?$/i.test(active.path)) return false;
        if (!checking) {
          this.app.workspace.getLeaf('tab').setViewState({ type: VIEW_TYPE, state: { file: active.path } });
        }
        return true;
      }.bind(this)
    });

    this.addCommand({
      id: 'rerender-embeds',
      name: '重新渲染全部笔记视图',
      callback: function () { this.rerenderAll(); }.bind(this)
    });
  }

  onunload() {
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    this._frames = [];
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  rerenderAll() {
    this.app.workspace.iterateAllLeaves(function (leaf) {
      if (leaf.view instanceof obsidian.MarkdownView) {
        try { leaf.view.previewMode.rerender(true); } catch (e) { /* 忽略 */ }
      }
    });
  }

  /* 解析代码块内容:path = 文件路径(亦可省略参数名直接写首行),其余 key: value;支持 // 注释 */
  parseSpec(source) {
    var spec = { path: '', height: '', pathType: '', theme: '', transparent: '' };
    String(source).split('\n').map(function (s) { return s.trim(); }).forEach(function (line) {
      if (!line || line.indexOf('//') === 0) return;
      var m = line.match(/^(\w+)\s*[:=]\s*(.+)$/);
      var key = m ? SPEC_KEYS[m[1].toLowerCase()] : null;
      if (m && key) {
        spec[key] = m[2].trim();
      } else if (!spec.path) {
        spec.path = line;
      }
    });
    return spec;
  }

  renderCodeBlock(source, el, ctx) {
    var spec = this.parseSpec(source);
    if (!spec.path) {
      el.appendChild(errBox('embed-html 块中未指定文件路径(path)'));
      return;
    }
    var file = this.app.metadataCache.getFirstLinkpathDest(spec.path, ctx.sourcePath);
    if (!(file instanceof obsidian.TFile)) {
      el.appendChild(errBox('未找到文件:' + spec.path));
      return;
    }
    el.appendChild(this.buildFrame(file, {
      height: normalizeHeight(spec.height, null) || normalizeHeight(this.settings.defaultHeight, DEFAULT_HEIGHT),
      strategy: spec.pathType || this.settings.strategy,
      theme: spec.theme,
      transparent: isTruthy(spec.transparent)
    }));
  }

  /* 把库内文件解析为某种可加载地址 */
  resolveUrl(file, strat) {
    if (strat === 'resource') {
      return this.app.vault.getResourcePath(file);
    }
    if (strat === 'local') {
      var base = this.app.vault.adapter.getBasePath();
      var abs = (base.replace(/\/+$/, '') + '/' + file.path).replace(/\/+/g, '/');
      return 'app://local/' + abs.split('/').map(encodeURIComponent).join('/');
    }
    return null; // srcdoc 由 cachedRead 处理
  }

  /* spec.theme(块内)→ 设置默认 → auto 解析为当前主题;none = 不注入 */
  resolveTheme(specTheme) {
    var t = normalizeTheme(specTheme, null);
    if (t === null) t = normalizeTheme(this.settings.theme, 'auto');
    if (t === 'auto') t = currentTheme();
    return t === 'none' ? null : t; // null = 不注入主题
  }

  /* 构建 wrapper + iframe + 控制条,返回元素 */
  buildFrame(file, opts) {
    var self = this;
    opts = opts || {};

    var wrap = document.createElement('div');
    wrap.className = 'lhe-wrap';
    wrap.dataset.lhe = file.path;

    var frame = document.createElement('iframe');
    frame.className = 'lhe-frame';
    frame._spec = { theme: opts.theme || '', transparent: !!opts.transparent };
    if (opts.height === 'auto') {
      frame.dataset.auto = '1';
      frame.style.height = '200px'; // 占位,加载后按内容自适应
    } else if (opts.height) {
      frame.style.height = opts.height;
    }
    wrap.appendChild(frame);
    this._frames.push(frame);

    var statusEl = null;
    if (this.settings.showBar) {
      var bar = document.createElement('div');
      bar.className = 'lhe-bar';

      statusEl = document.createElement('span');
      statusEl.className = 'lhe-status';
      statusEl.textContent = '… 加载中';

      var cycle = document.createElement('button');
      cycle.textContent = '策略:' + STRAT_LABEL[opts.strategy || this.settings.strategy];
      cycle.addEventListener('click', function () {
        var cur = frame.dataset.strat || self.settings.strategy;
        var next = STRATS[(STRATS.indexOf(cur) + 1) % STRATS.length];
        cycle.textContent = '策略:' + STRAT_LABEL[next];
        self.attachWith(frame, file, next, statusEl);
      });

      var reload = document.createElement('button');
      reload.textContent = '⟳';
      reload.addEventListener('click', function () {
        self.attachWith(frame, file, frame.dataset.strat || self.settings.strategy, statusEl);
      });

      bar.appendChild(statusEl);
      bar.appendChild(cycle);
      bar.appendChild(reload);
      wrap.appendChild(bar);
    }

    this.attachWith(frame, file, opts.strategy || this.settings.strategy, statusEl);
    return wrap;
  }

  /* 设置 iframe 的内容来源并绑定状态指示 */
  attachWith(frame, file, strat, statusEl) {
    var spec = frame._spec || {};
    var theme = this.resolveTheme(spec.theme);

    frame.dataset.strat = strat;
    frame._status = statusEl || null;
    frame.style.background = spec.transparent ? 'transparent' : '';
    try { frame.style.colorScheme = theme || ''; } catch (e) { /* 忽略 */ }

    if (!frame._wired) {
      frame._wired = true;
      frame.addEventListener('load', function () {
        var st = frame._status;
        if (!st) { if (frame.dataset.auto && frame.contentDocument) try { sizeFrameToContent(frame, frame.contentDocument); } catch (e) { /* 跨域 */ } return; }
        try {
          var d = frame.contentDocument;
          if (d && d.body) {
            st.textContent = '✓ 已加载(可访问)';
            if (frame.dataset.auto) sizeFrameToContent(frame, d);
          } else {
            st.textContent = '✓ 已加载';
          }
        } catch (e) {
          st.textContent = frame.dataset.auto
            ? '✓ 已加载(跨域:auto 失效,建议策略 srcdoc)'
            : '✓ 已加载(跨域)';
        }
        st.className = 'lhe-status ok';
      });
      frame.addEventListener('error', function () {
        var st = frame._status;
        if (st) { st.textContent = '✗ 加载失败/被阻止'; st.className = 'lhe-status err'; }
      });
    }

    if (statusEl) { statusEl.textContent = '… 加载中'; statusEl.className = 'lhe-status'; }

    if (strat === 'srcdoc') {
      this.app.vault.cachedRead(file).then(function (text) {
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
        frame.removeAttribute('src');
        frame.srcdoc = injectInto(text, theme, !!spec.transparent);
      });
    } else {
      frame.removeAttribute('srcdoc');
      frame.removeAttribute('sandbox');
      frame.src = this.resolveUrl(file, strat);
    }
  }

  /* 主题切换时广播;固定 light/dark 的块不跟随 */
  broadcastTheme() {
    var self = this;
    var t = currentTheme();
    this._frames = this._frames.filter(function (f) { return f && f.isConnected; });
    this._frames.forEach(function (f) {
      var st = self.resolveTheme((f._spec || {}).theme);
      if (st === null) return; // none:不注入,也无需广播
      try { f.contentWindow.postMessage({ __lhe: true, theme: t }, '*'); } catch (e) { /* 忽略 */ }
    });
  }

  /* 兼容模式:接管 ![[xx.html]] 与本地 <iframe>(默认不启用) */
  processLegacy(el, ctx) {
    var self = this;

    el.querySelectorAll('.internal-embed[src]').forEach(function (node) {
      if (node.parentElement && node.parentElement.closest('.lhe-wrap')) return;
      var src = node.getAttribute('src') || '';
      if (!/\.html?$/i.test(src)) return;
      var file = self.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!(file instanceof obsidian.TFile)) return;
      node.replaceWith(self.buildFrame(file, {}));
    });

    el.querySelectorAll('iframe[src]').forEach(function (frame) {
      if (frame.closest('.lhe-wrap')) return;
      var src = frame.getAttribute('src') || '';
      if (!src || EXTERNAL_SRC.test(src)) return;
      var file = self.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!(file instanceof obsidian.TFile)) return;
      frame.removeAttribute('src');
      self.attachWith(frame, file, self.settings.strategy, null);
    });
  }
};
