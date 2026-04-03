/* include-fragments.js
   重构目标：配置驱动、模块化、可扩展并改进错误处理与加载性能。
   行为说明：在 DOMContentLoaded 时（或之后）查找占位符并注入片段，
   默认保留与原实现兼容的占位符与候选路径。可通过传入配置自定义路径、选择器、缓存策略、去重规则和错误回调。
*/
(function () {
    'use strict';

    // ---------- 默认配置（可通过构造器覆盖） ----------
    const DEFAULT_CONFIG = {
        // 占位符定义：键为片段名，值包含 selector 与 candidates（相对路径数组或生成函数）
        placeholders: {
            header: {
                    selector: '[data-include="header"]',
                    // 根据页面路径优先级生成候选路径：views 页面优先尝试上级目录
                    candidates: function () {
                        const p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
                        if (p.indexOf('/views/') !== -1) {
                            return ['../partials/header.html', 'partials/header.html', '../../partials/header.html', '/partials/header.html'];
                        }
                        return ['partials/header.html', '../partials/header.html', '../../partials/header.html', '/partials/header.html'];
                    }
                },
                footer: {
                    selector: '[data-include="footer"]',
                    candidates: function () {
                        const p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
                        if (p.indexOf('/views/') !== -1) {
                            return ['../partials/footer.html', 'partials/footer.html', '../../partials/footer.html', '/partials/footer.html'];
                        }
                        return ['partials/footer.html', '../partials/footer.html', '../../partials/footer.html', '/partials/footer.html'];
                    }
                }
        },
        // 去重选择器数组（保留首次出现的元素）
        dedupeSelectors: ['.site-header', '.main-footer'],
        // 在哪些注入容器内修复链接（query selector）
        linkFixContainers: ['.site-header', '.main-footer'],
        // 视图目录下常见文件名，linkFix 时会对匹配的相对链接前缀 'views/'
        viewFilenames: ['notices.html', 'lineplan.html', 'linemap.html', 'aboutcompany.html', 'moreinfo.html'],
        // fetch 缓存策略，默认为 browser default
        fetchCache: 'default', // 可选 'no-store','no-cache','reload','force-cache','only-if-cached'
        // 是否将加载结果暴露为 window.__fragmentsLoaded（保持兼容），可关闭以避免全局污染
        exposeGlobalPromise: true,
        // 是否把构造函数挂到 window 用于调试/扩展
        exposeConstructor: false,
        // 运行时机：'dom-ready' 表示在 DOMContentLoaded 时运行（若已完成则立即运行）
        runOn: 'dom-ready',
        // 错误回调：(err, context) => void
        onError: function (err /*, context */) { console && console.error && console.error(err); }
    };

    // ---------- 小型工具函数 ----------
    function isString(v) { return typeof v === 'string'; }
    function toArrayLike(nodeList) { return Array.prototype.slice.call(nodeList || []); }

    // 安全 querySelectorAll
    function qAll(selector, root = document) {
        try { return toArrayLike(root.querySelectorAll(selector)); } catch (e) { return []; }
    }

    // 使用 fetch 获取文本，发生任何错误则抛出
    async function fetchText(url, cache = 'default', signal) {
        const res = await fetch(url, { cache: cache, signal });
        if (!res.ok) throw new Error('Failed to fetch: ' + url + ' (status ' + res.status + ')');
        return await res.text();
    }

    // 依次尝试多个候选 URL（顺序），返回第一个成功的内容；若全部失败则抛错
    // candidates: [string] 或函数返回该数组
    async function tryLoadFromCandidates(candidates, cache, onError) {
        const list = isString(candidates) ? [candidates] : (typeof candidates === 'function' ? candidates() : (candidates || []));
        if (!list || !list.length) {
            const err = new Error('No candidates provided');
            onError && onError(err);
            throw err;
        }

        for (let i = 0; i < list.length; i++) {
            const url = list[i];
            try {
                const txt = await fetchText(url, cache);
                return { url: url, text: txt };
            } catch (err) {
                // 把每次失败传递给回调，但继续尝试下一个候选
                try { onError && onError(err, { url }); } catch (e) {}
                // continue
            }
        }
        const finalErr = new Error('All candidates failed');
        onError && onError(finalErr);
        throw finalErr;
    }

    // 将 html 字符串替换占位符元素（保持 DOM 节点引用稳定）
    function replacePlaceholder(el, html) {
        if (!el || !html) return null;
        const container = document.createElement('div');
        container.innerHTML = html;
        const nodes = toArrayLike(container.childNodes);
        const parent = el.parentNode;
        if (!parent) return null;
        // insert before placeholder then remove placeholder
        nodes.forEach(n => parent.insertBefore(n.cloneNode(true), el));
        parent.removeChild(el);
        return nodes;
    }

    // 去重：对于每个 selector 保留第一个匹配元素，移除其余
    function dedupeElements(selectors) {
        if (!Array.isArray(selectors)) return;
        selectors.forEach(sel => {
            try {
                const items = qAll(sel);
                if (items.length > 1) {
                    items.slice(1).forEach(i => i.parentNode && i.parentNode.removeChild(i));
                }
            } catch (e) { /* ignore per-selector errors */ }
        });
    }

    // 修复注入片段内的相对链接：当页面不在 views/ 目录下时，为特定文件名的相对链接添加 views/ 前缀
    function fixRelativeLinks(containers, filenames) {
        try {
            const path = location.pathname || '';
            if (path.indexOf('/views/') !== -1) return; // 在 views 页面内无需修改
            const nameSet = Array.isArray(filenames) ? filenames.reduce((s, n) => (s[n] = true, s), {}) : {};
            containers.forEach(containerSel => {
                qAll(containerSel).forEach(root => {
                    qAll('a', root).forEach(a => {
                        try {
                            const href = a.getAttribute('href');
                            if (!href) return;
                            if (/^(https?:)?\/\//i.test(href)) return; // external
                            if (href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return;
                            const name = href.split('?')[0].split('#')[0];
                            if (nameSet[name]) a.setAttribute('href', 'views/' + href);
                        } catch (e) { /* per-link ignore */ }
                    });
                });
            });
        } catch (e) { /* ignore overall link-fix errors */ }
    }

    // 管理 loading class
    function setLoadingState(isLoading) {
        try {
            document.documentElement.classList.toggle('fragments-loading', !!isLoading);
        } catch (e) {}
    }

    // ---------- FragmentLoader 类（对外 API） ----------
    class FragmentLoader {
        constructor(options = {}) {
            this.config = Object.assign({}, DEFAULT_CONFIG, options || {});
            // 深合并 placeholders
            this.config.placeholders = Object.assign({}, DEFAULT_CONFIG.placeholders, options.placeholders || {});
            this._loadedPromise = null;
        }

        // 加载并注入所有占位符
        async load() {
            if (this._loadedPromise) return this._loadedPromise;
            const cfg = this.config;
            setLoadingState(true);

            this._loadedPromise = (async () => {
                const tasks = [];
                try {
                    Object.keys(cfg.placeholders).forEach(key => {
                        const ph = cfg.placeholders[key];
                        try {
                            const el = document.querySelector(ph.selector);
                            if (!el) return; // 占位符不存在
                            const task = (async () => {
                                try {
                                    const result = await tryLoadFromCandidates(ph.candidates, cfg.fetchCache, cfg.onError);
                                    if (result && result.text) {
                                        replacePlaceholder(el, result.text);
                                    }
                                } catch (err) {
                                    // 将错误抛给上层处理或回调
                                    cfg.onError && cfg.onError(err, { placeholder: key });
                                }
                            })();
                            tasks.push(task);
                        } catch (e) { cfg.onError && cfg.onError(e, { placeholder: key }); }
                    });

                    await Promise.all(tasks);

                    // 后处理：去重与修复链接
                    try { dedupeElements(cfg.dedupeSelectors); } catch (e) { cfg.onError && cfg.onError(e, { step: 'dedupe' }); }
                    try { fixRelativeLinks(cfg.linkFixContainers, cfg.viewFilenames); } catch (e) { cfg.onError && cfg.onError(e, { step: 'fixLinks' }); }

                    // 等待一帧以便样式重算（单层 rAF 即可）
                    await new Promise(r => requestAnimationFrame(r));

                    setLoadingState(false);
                    return true;
                } catch (err) {
                    setLoadingState(false);
                    cfg.onError && cfg.onError(err, { step: 'overall' });
                    throw err;
                }
            })();

            return this._loadedPromise;
        }

        // 手动触发（和 load 相同）
        init() { return this.load(); }
    }

    // 将类或实例按配置暴露到全局（可选）以保持兼容与扩展性
    function bootDefault() {
        try {
            const defaultLoader = new FragmentLoader();
            if (defaultLoader.config.exposeConstructor && typeof window !== 'undefined') {
                window.FragmentLoader = FragmentLoader;
            }
            // 保持与旧版兼容：暴露全局 Promise（可关闭）
            if (defaultLoader.config.exposeGlobalPromise && typeof window !== 'undefined') {
                try {
                    if (!window.__fragmentsLoaded) window.__fragmentsLoaded = defaultLoader.load();
                } catch (e) { /* ignore */ }
            } else {
                // 不暴露全局时仍然自动加载但不写入全局变量
                defaultLoader.load().catch(() => {});
            }
        } catch (e) { console && console.error && console.error(e); }
    }

    // ---------- 运行时时机 ----------
    if (DEFAULT_CONFIG.runOn === 'dom-ready') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootDefault, { once: true });
        } else {
            // 已经 ready，立即启动
            bootDefault();
        }
    } else {
        // 未来可扩展其他生命周期选项
        bootDefault();
    }

    // 可选：将 FragmentLoader 类暴露在 window 下（仅当配置要求时）
    // 注意：此处不默认暴露以避免污染全局命名空间。

})();
