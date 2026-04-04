// 更稳健的 MobileNav（ES5 风格，兼容更老环境）
(function () {
    'use strict';

    // ---------- 默认配置（可通过 window.__MAIN_JS_CONFIG 覆盖） ----------
    var DEFAULT_CFG = {
        dev: false,
        panelTransition: 360,
        autoPopulatePanel: true,
        selectors: {
            toggle: '.nav-toggle',
            panel: '.mobile-nav-panel',
            overlay: '.mobile-nav-overlay',
            navContainer: '.header-container',
            navLinks: '.main-nav .nav-list .nav-item a'
        },
        // 可插入生命周期钩子
        hooks: {
            beforeOpen: null,
            afterOpen: null,
            beforeClose: null,
            afterClose: null
        }
    };

    var CFG = (window && window.__MAIN_JS_CONFIG) ? extend(deepClone(DEFAULT_CFG), window.__MAIN_JS_CONFIG) : deepClone(DEFAULT_CFG);

    function safeLog() {
        if (CFG.dev && window.console && console.error) {
            var args = Array.prototype.slice.call(arguments);
            console.error.apply(console, args);
        }
    }

    function reportError(err, ctx) {
        try {
            safeLog('[main] error', ctx || '', err);
            if (typeof window.__reportError === 'function') {
                try { window.__reportError(err, ctx || 'main.js'); } catch (er) { safeLog('reportError failed', er); }
            }
        } catch (e) { /* 忽略上报错误 */ }
    }

    // 简单深拷贝（用于合并默认配置）
    function deepClone(obj) {
        try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
    }

    function extend(target, src) {
        var k;
        for (k in src) {
            if (src.hasOwnProperty(k)) target[k] = src[k];
        }
        return target;
    }

    // 解析简单选择器用于动态创建 DOM（只对简单 id/class 生效，复杂选择器将退回默认类名）
    function parseSimpleSelector(sel) {
        if (!sel || typeof sel !== 'string') return { type: 'class', classes: ['mobile-nav-panel'] };
        sel = sel.trim();
        if (sel.indexOf(' ') !== -1 || sel.indexOf('>') !== -1 || sel.indexOf('[') !== -1 || sel.indexOf(':') !== -1 || sel.indexOf(',') !== -1) {
            // 复杂选择器，不尝试映射为 class/id
            return { type: 'complex' };
        }
        if (sel.charAt(0) === '#') return { type: 'id', id: sel.slice(1) };
        if (sel.charAt(0) === '.') return { type: 'class', classes: [sel.slice(1)] };
        // bare tag or class name
        return { type: 'class', classes: [sel.replace('.', '')] };
    }

    // Helper: find first focusable element in container
    function firstFocusable(container) {
        if (!container || !container.querySelectorAll) return null;
        var nodes = container.querySelectorAll('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
        return nodes && nodes.length ? nodes[0] : null;
    }

    // ---------- MobileNav 构造函数（ES5） ----------
    function MobileNav(cfg) {
        this.cfg = cfg || CFG;
        this.sel = extend({}, this.cfg.selectors || {});
        this.toggles = []; // NodeList -> Array
        this.panel = null;
        this.overlay = null;
        this._observer = null;
        this._observerTimer = null;
        this._bound = false;
        this._animating = false;
        this._navSnapshot = '';
        this._handlers = {};
        this._bodyOverflow = '';
        this._lastToggleTime = 0;
        this._instanceId = 'mobileNav_' + Math.random().toString(36).slice(2, 9);
        // 生命周期钩子
        this.hooks = this.cfg.hooks || {};
        // 初始化 DOM 引用（不创建 DOM）
        this.panel = document.querySelector(this.sel.panel);
        this.overlay = document.querySelector(this.sel.overlay);
        this._initToggles();
    }

    // 仅执行一次的初始化：绑定/填充/观察器启动
    MobileNav.prototype.init = function () {
        if (window.__MobileNavSingleton) return window.__MobileNavSingleton;
        try {
            this.bind();
            this.populateOnce();
            this.observeNavContainer();
            window.__MobileNavSingleton = this;
            if (CFG.dev) safeLog('MobileNav initialized', this);
            return this;
        } catch (e) { reportError(e, 'MobileNav.init'); }
    };

    // 恢复或创建必须的 DOM（更谨慎地处理选择器）
    MobileNav.prototype.ensureDom = function () {
        try {
            if (!this.panel) {
                var selInfo = parseSimpleSelector(this.sel.panel);
                this.panel = document.createElement('div');
                if (selInfo.type === 'id') {
                    this.panel.id = selInfo.id;
                } else if (selInfo.type === 'class') {
                    for (var i = 0; i < selInfo.classes.length; i++) this.panel.classList.add(selInfo.classes[i]);
                } else {
                    // 复杂选择器或无法解析，使用默认类名，警告开发者
                    this.panel.classList.add('mobile-nav-panel');
                    if (CFG.dev) safeLog('警告：无法将复杂选择器映射为 class/id，已回退到默认 .mobile-nav-panel');
                }
                var ul = document.createElement('ul'); ul.className = 'mobile-nav-list'; this.panel.appendChild(ul);
                document.body.appendChild(this.panel);
            }
            if (!this.overlay) {
                var oSel = parseSimpleSelector(this.sel.overlay);
                this.overlay = document.createElement('div');
                if (oSel.type === 'id') this.overlay.id = oSel.id; else if (oSel.type === 'class') for (var j = 0; j < oSel.classes.length; j++) this.overlay.classList.add(oSel.classes[j]); else this.overlay.classList.add('mobile-nav-overlay');
                this.overlay.setAttribute('aria-hidden', 'true');
                this.overlay.style.pointerEvents = 'none';
                document.body.appendChild(this.overlay);
            }
            // ensure panel has an id for aria-controls
            if (!this.panel.id) this.panel.id = 'mobile-nav-panel';
        } catch (e) { reportError(e, 'ensureDom'); }
    };

    // 初始化 toggles 列表（支持多个按钮）
    MobileNav.prototype._initToggles = function () {
        try {
            var nodes = document.querySelectorAll(this.sel.toggle || DEFAULT_CFG.selectors.toggle);
            var newToggles = Array.prototype.slice.call(nodes || []);
            // 如果尚未绑定，直接替换列表；若已绑定，则为新增的按钮补绑事件
            if (!this._bound) {
                this.toggles = newToggles;
            } else {
                // 找出尚未绑定的元素并绑定
                for (var i = 0; i < newToggles.length; i++) {
                    var el = newToggles[i];
                    if (!el.__mobileNavBound) {
                        // 确保有 toggleClick handler
                        if (this._handlers && typeof this._handlers.toggleClick === 'function') {
                            el.addEventListener('click', this._handlers.toggleClick, false);
                            try { el.setAttribute('aria-expanded', 'false'); el.setAttribute('aria-controls', this.panel ? this.panel.id || 'mobile-nav-panel' : 'mobile-nav-panel'); } catch (e) {}
                            el.__mobileNavBound = true;
                        }
                    }
                }
                this.toggles = newToggles;
            }
        } catch (e) { reportError(e, '_initToggles'); this.toggles = []; }
    };

    // 绑定所有事件（仅绑定一次，提供 destroy）
    MobileNav.prototype.bind = function () {
        var self = this;
        if (this._bound) return; this._bound = true;
        // 捕获阶段处理：优先捕捉 toggle 点击，防止其他脚本在冒泡阶段 stopPropagation 导致失效
        this._handlers.captureToggle = function (e) {
            try {
                var t = e.target && e.target.closest && e.target.closest(self.sel.toggle);
                if (t) {
                    // 标记该事件已被 mobileNav 处理，避免后续直接绑定重复触发
                    try { e.__mobileNavHandled = true; } catch (er) {}
                    if (CFG.dev) safeLog('captureToggle handled for', t);
                    // 不调用 stopPropagation，这样其他需要在冒泡阶段处理的逻辑仍可运行；但优先处理菜单切换
                    var now = Date.now();
                    if (now - self._lastToggleTime < 350) return; // 防抖
                    self._lastToggleTime = now;
                    if (self._animating) return;
                    self.toggle();
                }
            } catch (err) { reportError(err, 'captureToggle'); }
        };
        document.addEventListener('click', this._handlers.captureToggle, true);
        // 直接为每个 toggle 绑定 handler，避免出现冒泡 + 直接绑定两次触发的问题
    this._handlers.toggleClick = function (ev) {
            try {
        // 若 capture 阶段已处理（其他脚本可能 stopPropagation），跳过，避免双触发
        try { if (ev && ev.__mobileNavHandled) return; } catch (er) {}
                ev.preventDefault();
                ev.stopPropagation();
                var now = Date.now();
                if (now - self._lastToggleTime < 350) return; // 防抖，避免双触发
                self._lastToggleTime = now;
                if (self._animating) return; // 动画中忽略
                self.toggle();
            } catch (e) { reportError(e, 'toggleClick'); }
        };
        for (var i = 0; i < this.toggles.length; i++) {
            var el = this.toggles[i];
            if (!el.__mobileNavBound) {
                el.addEventListener('click', this._handlers.toggleClick, false);
                // ARIA 初始
                try { el.setAttribute('aria-expanded', 'false'); el.setAttribute('aria-controls', this.panel ? this.panel.id || 'mobile-nav-panel' : 'mobile-nav-panel'); } catch (e) {}
                el.__mobileNavBound = true;
            }
        }

        // 文档级点击：用于点击面板外关闭
        this._handlers.onDocClick = function (e) {
            try {
                if (!self.panel || !self.panel.classList.contains('active')) return;
                var tgt = e.target || e.srcElement;
                if (!tgt) return;
                // 若点击在 toggle 上则忽略
                for (var k = 0; k < self.toggles.length; k++) { if (self.toggles[k].contains && self.toggles[k].contains(tgt)) return; }
                if (self.panel.contains(tgt)) return;
                // 允许某些组件不触发关闭
                if (tgt.closest && tgt.closest('select, option, .map-select, .dropdown-container')) return;
                self.close();
            } catch (e) { reportError(e, 'onDocClick'); }
        };
        document.addEventListener('click', this._handlers.onDocClick, false);

        // ESC
        this._handlers.onKeyDown = function (e) {
            var key = e.key || e.keyCode;
            if (key === 'Escape' || key === 'Esc' || key === 27) self.close();
            // Tab 限制在面板内（focus trap）
            if ((key === 'Tab' || key === 9) && self.panel && self.panel.classList.contains('active')) {
                // 实现简单的 focus trap
                try {
                    var focusables = self.panel.querySelectorAll('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
                    if (!focusables || focusables.length === 0) { e.preventDefault(); return; }
                    var first = focusables[0], last = focusables[focusables.length - 1];
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                } catch (er) { /* ignore */ }
            }
        };
        document.addEventListener('keydown', this._handlers.onKeyDown, false);

        // window resize：关闭菜单并断言状态一致
        this._handlers.onResize = function () { try { if (self.panel && self.panel.classList.contains('active')) self.close(); } catch (e) { reportError(e, 'onResize'); } };
        window.addEventListener('resize', this._handlers.onResize, false);
    };

    // 解除绑定，释放资源
    MobileNav.prototype.destroy = function () {
        try {
            for (var i = 0; i < this.toggles.length; i++) {
                var el = this.toggles[i];
                if (el && el.__mobileNavBound) {
                    el.removeEventListener('click', this._handlers.toggleClick, false);
                    delete el.__mobileNavBound;
                }
            }
            if (this._handlers.onDocClick) document.removeEventListener('click', this._handlers.onDocClick, false);
            if (this._handlers.onKeyDown) document.removeEventListener('keydown', this._handlers.onKeyDown, false);
            if (this._handlers.onResize) window.removeEventListener('resize', this._handlers.onResize, false);
            this.disconnectObserver();
            // 恢复 body 滚动
            try { document.body.style.overflow = this._bodyOverflow || ''; } catch (e) {}
            this._bound = false;
            if (window.__MobileNavSingleton === this) window.__MobileNavSingleton = null;
        } catch (e) { reportError(e, 'destroy'); }
    };

    // 填充导航，仅第一次填充（提供原元素映射以触发原有事件）
    MobileNav.prototype.populateOnce = function () {
        try {
            this.ensureDom();
            var ul = this.panel.querySelector('.mobile-nav-list');
            if (!ul) return;
            if (ul.children && ul.children.length > 0) return; // 已填充
            var source = document.querySelectorAll(this.sel.navLinks);
            if (!source || source.length === 0) {
                // 回退：尝试 header-container 内所有链接
                var hc = document.querySelectorAll((this.sel.navContainer || DEFAULT_CFG.selectors.navContainer) + ' a');
                source = (hc && hc.length) ? hc : [];
            }
            if (!source || source.length === 0) return;
            // 记录 snapshot，使用 JSON 字符串避免分隔符冲突
            var arr = [];
            for (var i = 0; i < source.length; i++) {
                var a = source[i];
                // 构建移动端条目，但在点击时触发原始元素的事件（dispatchEvent）以保留 JS 行为
                var li = document.createElement('li'); li.className = (this.cfg.itemClassName || 'mobile-nav-item');
                var link = document.createElement('a');
                // 复制常见属性
                try { if (a.getAttribute('href')) link.setAttribute('href', a.getAttribute('href')); } catch (e) {}
                try { if (a.getAttribute('target')) link.setAttribute('target', a.getAttribute('target')); } catch (e) {}
                try { link.innerHTML = a.innerHTML; } catch (e) { link.textContent = a.textContent || a.innerText || ''; }
                // 绑定点击：先尝试触发原始元素的 click 事件（保留监听器），再关闭面板
                    (function (orig, selfRef) {
                        link.addEventListener('click', function (ev) {
                            try {
                                // 先触发原始元素的事件
                                try {
                                    if (orig && typeof orig.dispatchEvent === 'function') {
                                        var evt = document.createEvent('MouseEvents');
                                        evt.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
                                        orig.dispatchEvent(evt);
                                    }
                                } catch (e) { /* ignore dispatch issues */ }
                                selfClose(selfRef);
                            } catch (e) { reportError(e, 'mobileLinkClick'); }
                        }, false);
                    })(source[i], this);
                li.appendChild(link); ul.appendChild(li);
                arr.push({ href: a.href || '', text: (a.textContent || a.innerText || '') });
            }
            try { this._navSnapshot = JSON.stringify(arr); } catch (e) { this._navSnapshot = ''; }
        } catch (e) { reportError(e, 'populateOnce'); }

        function selfClose(selfRef) { try { selfRef.close(); } catch (e) { reportError(e, 'selfClose'); } }
    };

    // 检查导航是否变化（observer 驱动），使用防抖
    MobileNav.prototype.refreshIfChanged = function () {
        var self = this;
        try {
            var links = document.querySelectorAll(this.sel.navLinks);
            if (!links || links.length === 0) return;
            var arr = [];
            for (var i = 0; i < links.length; i++) arr.push({ href: links[i].href || '', text: links[i].textContent || links[i].innerText || '' });
            var snap = JSON.stringify(arr);
            if (snap && snap !== this._navSnapshot) {
                var ul = this.panel.querySelector('.mobile-nav-list'); if (ul) ul.innerHTML = '';
                this._navSnapshot = '';
                this.populateOnce();
            }
        } catch (e) { reportError(e, 'refreshIfChanged'); }
    };

    // open/close/toggle
    MobileNav.prototype.open = function () {
        try {
            if (CFG.dev) safeLog('MobileNav.open');
            if (typeof this.hooks.beforeOpen === 'function') this.hooks.beforeOpen();
            this.ensureDom();
            // body scroll lock
            try { this._bodyOverflow = document.body.style.overflow || ''; document.body.style.overflow = 'hidden'; } catch (e) {}
            // 显示 overlay and panel
            try { this.overlay.style.pointerEvents = 'auto'; } catch (e) {}
            this.overlay.classList.add('active');
            // z-index
            try { this.panel.style.zIndex = (this.cfg.panelZIndex || 1115); } catch (e) {}
            this.panel.classList.add('active');
            // A11Y
            try { var now = new Date(); /* focus management */ } catch (e) {}
            try {
                this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'true'); this.panel.setAttribute('aria-hidden', 'false');
                for (var i = 0; i < this.toggles.length; i++) try { this.toggles[i].setAttribute('aria-expanded', 'true'); } catch (e) {}
                this._lastFocused = document.activeElement;
                var f = firstFocusable(this.panel); if (f && typeof f.focus === 'function') f.focus();
            } catch (e) { reportError(e, 'open-a11y'); }
            // 防止重复触发动画冲突
            this._animating = true;
            // transitionend 或超时清理 animating
            var self = this;
            var onEnd = function () { try { self._animating = false; if (typeof self.hooks.afterOpen === 'function') self.hooks.afterOpen(); self.panel.removeEventListener('transitionend', onEnd, false); } catch (e) { reportError(e, 'open.onEnd'); } };
            this.panel.addEventListener('transitionend', onEnd, false);
            // 保险超时
            setTimeout(function () { try { self._animating = false; if (typeof self.hooks.afterOpen === 'function') self.hooks.afterOpen(); } catch (e) {} }, (this.cfg.panelTransition || 360) + 200);
        } catch (e) { reportError(e, 'open'); }
    };

    MobileNav.prototype.close = function () {
        try {
            if (CFG.dev) safeLog('MobileNav.close');
            if (typeof this.hooks.beforeClose === 'function') this.hooks.beforeClose();
            // overlay pointer none
            try { if (this.overlay) this.overlay.style.pointerEvents = 'none'; } catch (e) {}
            if (this.overlay) this.overlay.classList.remove('active');
            // remove active on panel after transitionend or timeout
            var self = this;
            try { this.panel.style.setProperty('--menu-clip-radius', '0px'); } catch (e) {}
            var onEnd = function () {
                try { if (self.panel) self.panel.classList.remove('active'); } catch (e) { reportError(e, 'close.onEnd.removeActive'); }
                try { if (typeof self.hooks.afterClose === 'function') self.hooks.afterClose(); } catch (e) { reportError(e, 'close.afterClose'); }
                try { self.panel.removeEventListener('transitionend', onEnd, false); } catch (e) {}
                try { self._animating = false; } catch (e) {}
            };
            if (this.panel) this.panel.addEventListener('transitionend', onEnd, false);
            // 超时兜底
            setTimeout(function () { try { if (self.panel) self.panel.classList.remove('active'); if (typeof self.hooks.afterClose === 'function') self.hooks.afterClose(); self._animating = false; } catch (e) { reportError(e, 'close.timeout'); } }, (this.cfg.panelTransition || 360) + 200);
            // restore body overflow
            try { document.body.style.overflow = this._bodyOverflow || ''; } catch (e) {}
            // A11Y restore
            try { for (var i = 0; i < this.toggles.length; i++) try { this.toggles[i].setAttribute('aria-expanded', 'false'); } catch (e) {} if (this._lastFocused && this._lastFocused.focus) this._lastFocused.focus(); } catch (e) { reportError(e, 'close-a11y'); }
            // reset z-index 延迟清理
            setTimeout(function () { try { if (self.panel) self.panel.style.zIndex = ''; } catch (e) {} }, (this.cfg.panelTransition || 360) + 80);
        } catch (e) { reportError(e, 'close'); }
    };

    MobileNav.prototype.toggle = function () {
        try {
            if (!this.panel) this.ensureDom();
            if (!this.panel.classList.contains('active')) this.open(); else this.close();
        } catch (e) { reportError(e, 'toggle'); }
    };

    // 监听导航容器变化并防抖
    MobileNav.prototype.observeNavContainer = function () {
        var self = this;
        try {
            var container = document.querySelector(this.sel.navContainer) || document.body;
            if (!window.MutationObserver) return; // older env
            this._observer = new MutationObserver(function () {
                try {
                    if (self._observerTimer) clearTimeout(self._observerTimer);
                    self._observerTimer = setTimeout(function () { try { self.refreshIfChanged(); self._initToggles(); } catch (e) { reportError(e, 'observer.timer'); } }, 200);
                } catch (e) { reportError(e, 'observer.cb'); }
            });
            this._observer.observe(container, { childList: true, subtree: true });
        } catch (e) { reportError(e, 'observeNavContainer'); }
    };

    MobileNav.prototype.disconnectObserver = function () { try { if (this._observer) this._observer.disconnect(); if (this._observerTimer) clearTimeout(this._observerTimer); } catch (e) { reportError(e, 'disconnectObserver'); } };

    // ---------- FallbackBind：在常见生命周期事件后确保绑定 ----------
    var FallbackBind = {
        attached: false,
        attach: function (nav) {
            if (this.attached) return; this.attached = true;
            try {
                var ensure = function () { try { if (document.querySelector(nav.sel.toggle)) nav.bind(); } catch (e) { reportError(e, 'fallbackEnsure'); } };
                var evts = ['DOMContentLoaded', 'pageshow', 'hashchange', 'popstate'];
                for (var i = 0; i < evts.length; i++) window.addEventListener(evts[i], (function (fn) { return function () { setTimeout(fn, 50); }; })(ensure), false);
                setTimeout(ensure, 300);
            } catch (e) { reportError(e, 'FallbackBind.attach'); }
        }
    };

    // ---------- 初始化与启动 ----------
    function initMain() {
        try {
            var nav = new MobileNav(CFG);
            nav.init();
            FallbackBind.attach(nav);
            if (CFG.dev) window.__MobileNav = nav;
            return nav;
        } catch (e) { reportError(e, 'initMain'); }
    }

    // safe async fragments handling (no Promise assumption)
    function boot() {
        try {
            var runInit = function () { try { initMain(); } catch (e) { reportError(e, 'initMain.run'); } };
            try {
                if (window.__fragmentsLoaded && typeof window.__fragmentsLoaded.then === 'function') {
                    window.__fragmentsLoaded.then(function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit, false); else runInit(); }).catch(function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit, false); });
                } else {
                    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit, false); else runInit();
                }
            } catch (e) { // 如果环境不支持 Promise，直接绑定 DOMContentLoaded
                if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit, false); else runInit();
            }
        } catch (e) { reportError(e, 'boot'); }
    }

    boot();

})();
