// 移动端汉堡菜单（独立文件）
// 功能：在 header fragments 注入后初始化，点击汉堡按钮展示移动导航（卷帘门效果），再次点击或点击遮罩/按 ESC 关闭
(function () {
    'use strict';

    // 简单日志（在需要时可通过在页面中设置 window.__MOBILE_NAV_DEBUG = true 开启）
    function dlog() {
        try {
            if (window && window.__MOBILE_NAV_DEBUG && console && console.log) {
                var args = Array.prototype.slice.call(arguments);
                console.log.apply(console, args);
            }
        } catch (e) {}
    }

    // 等待 fragments 注入完成或 DOMContentLoaded
    function whenReady(callback) {
        try {
            var run = function () { try { callback(); } catch (e) { dlog('mobile-nav callback error', e); } };
            // 为了兼容 fragments 异步注入 header 的情况，优先等待全局 promise；若不存在或未暴露，等待 DOMContentLoaded
            // 并额外等待 .nav-toggle 出现（通过 MutationObserver）再执行 callback，解决绑定时机问题
            var afterDom = function () {
                try {
                    var proceed = function () {
                        // 等待 .nav-toggle 出现（若在 header 中注入）再运行 callback
                        waitForSelector('.nav-toggle', function () { run(); }, 3000);
                    };
                    if (window.__fragmentsLoaded && typeof window.__fragmentsLoaded.then === 'function') {
                        try { window.__fragmentsLoaded.then(proceed).catch(proceed); } catch (e) { proceed(); }
                    } else { proceed(); }
                } catch (e) { run(); }
            };

            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', afterDom, false); else afterDom();
        } catch (e) { dlog('whenReady error', e); }
    }

    // 等待某个选择器出现（通过 MutationObserver），超时后会调用回调以避免永久悬挂
    function waitForSelector(selector, cb, timeout) {
        try {
            timeout = typeof timeout === 'number' ? timeout : 2000;
            if (!selector) { try { cb(); } catch (e) {} return; }
            // 立刻检查
            var el = document.querySelector(selector);
            if (el) { try { cb(); } catch (e) {} return; }
            // 使用 MutationObserver 监听 body 的子树变化
            var observed = false;
            var obs = null;
            var timer = setTimeout(function () {
                try { if (obs) obs.disconnect(); } catch (e) {}
                try { cb(); } catch (e) {}
            }, timeout);
            try {
                obs = new MutationObserver(function (mutations) {
                    if (observed) return;
                    try {
                        if (document.querySelector(selector)) {
                            observed = true;
                            clearTimeout(timer);
                            try { cb(); } catch (e) {}
                            try { obs.disconnect(); } catch (e) {}
                        }
                    } catch (e) {}
                });
                obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
            } catch (e) {
                clearTimeout(timer);
                try { cb(); } catch (er) {}
            }
        } catch (e) { try { cb(); } catch (er) {} }
    }

    // 创建移动面板 DOM（如果页面没有）并返回重要节点
    function ensurePanel() {
        var panel = document.querySelector('.mobile-nav-panel');
        var overlay = document.querySelector('.mobile-nav-overlay');
        if (!panel) {
            panel = document.createElement('nav');
            panel.className = 'mobile-nav-panel';
            panel.setAttribute('aria-hidden', 'true');
            var ul = document.createElement('ul'); ul.className = 'mobile-nav-list'; panel.appendChild(ul);
            document.body.appendChild(panel);
        }
        if (!overlay) {
            overlay = document.createElement('div'); overlay.className = 'mobile-nav-overlay'; overlay.setAttribute('aria-hidden', 'true');
            document.body.appendChild(overlay);
        }
        return { panel: panel, overlay: overlay };
    }

    // 从 header 的主导航里复制链接到移动面板（保留原始点击行为：优先触发原始元素的 click，再导航）
    function populatePanel(panel) {
        try {
            var ul = panel.querySelector('.mobile-nav-list'); if (!ul) return;
            if (ul.children && ul.children.length > 0) return; // 已填充
            var source = document.querySelectorAll('.main-nav .nav-list a');
            if (!source || source.length === 0) return;
            for (var i = 0; i < source.length; i++) {
                var a = source[i];
                var li = document.createElement('li'); li.className = 'mobile-nav-item';
                var link = document.createElement('a');
                try { if (a.getAttribute('href')) link.setAttribute('href', a.getAttribute('href')); } catch (e) {}
                try { link.innerHTML = a.innerHTML; } catch (e) { link.textContent = a.textContent || a.innerText || ''; }
                try { link.className = a.className || ''; } catch (e) {}
                // mark active if href path matches
                try {
                    var href = link.getAttribute('href');
                    if (href) {
                        var aUrl = document.createElement('a'); aUrl.href = href;
                        var cur = window.location.pathname || window.location.href;
                        // compare pathname or full href if needed
                        if (aUrl.pathname === (window.location.pathname || '')) link.classList.add('active');
                    }
                } catch (e) {}
                // 点击优先尝试触发原始元素的 click 事件，以保留可能的 JS 路由
                (function (orig) {
                    link.addEventListener('click', function (ev) {
                        try {
                            ev.preventDefault();
                            ev.stopPropagation();
                            var initialHref = window.location.href;
                            // 优先使用原生 click()，它更接近真实用户交互并能触发绑定在元素上的原始处理器
                            try {
                                if (orig && typeof orig.click === 'function') {
                                    orig.click();
                                } else if (orig && typeof orig.dispatchEvent === 'function') {
                                    var evt = document.createEvent('MouseEvents');
                                    evt.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
                                    orig.dispatchEvent(evt);
                                }
                            } catch (e) { dlog('dispatch/click failed', e); }
                            // 若原处理器未导致导航，且 href 是同源且不是 _blank，则兜底跳转
                            (function (h, t, before) {
                                setTimeout(function () {
                                    try {
                                        if (window.location.href === before) {
                                            if (h) {
                                                try {
                                                    if (t && t.toLowerCase() === '_blank') {
                                                        window.open(h, '_blank');
                                                    } else {
                                                        window.location.href = h;
                                                    }
                                                } catch (e) { dlog('navigation fallback err', e); }
                                            }
                                        }
                                    } catch (e) { dlog('navigation fallback err', e); }
                                }, 180);
                            })(link.getAttribute('href'), orig && orig.getAttribute ? orig.getAttribute('target') : null, initialHref);
                        } catch (e) { dlog('mobile link click error', e); }
                        // 关闭面板（外部会处理关闭逻辑）
                        try { closePanel(); } catch (e) {}
                    }, false);
                })(a);
                li.appendChild(link); ul.appendChild(li);
            }
        } catch (e) { dlog('populatePanel error', e); }
    }

    var _state = { open: false };
    var nodes = { toggles: [], panel: null, overlay: null };
    var _handlers = { captureToggle: null, toggleClick: null, observer: null };
    var _lastToggleTime = 0;
    var _lastBodyOverflow = '';

    function openPanel() {
        if (_state.open) return;
        _state.open = true;
        nodes.panel.style.transformOrigin = 'top';
        nodes.panel.classList.add('active');
        nodes.panel.setAttribute('aria-hidden', 'false');
        nodes.overlay.classList.add('active'); nodes.overlay.setAttribute('aria-hidden', 'false');
        try { _lastBodyOverflow = document.body.style.overflow || ''; document.body.style.overflow = 'hidden'; } catch (e) {}
        // focus 管理
        try { var f = nodes.panel.querySelector('a, button'); if (f && f.focus) f.focus(); } catch (e) {}
        dlog('mobile-nav opened');
    }

    function closePanel() {
        if (!_state.open) return;
        _state.open = false;
        // 为了实现收起从下向上，先设置 transform-origin 底部，然后移除 active 触发收起动画
        nodes.panel.style.transformOrigin = 'bottom';
        // 在将 panel 标记为 aria-hidden 之前，确保没有 focus 在其内部，以避免浏览器警告
        try {
            var active = document.activeElement;
            if (active && nodes.panel && nodes.panel.contains(active)) {
                // 把焦点恢复到第一个 toggle 或 body
                var tgt = (nodes.toggles && nodes.toggles.length && nodes.toggles[0]) ? nodes.toggles[0] : document.body;
                try { if (tgt && typeof tgt.focus === 'function') tgt.focus(); } catch (e) {}
            }
        } catch (e) {}
        // 移除 active 将触发 CSS animate 至 scaleY(0)
        nodes.panel.classList.remove('active');
        nodes.panel.setAttribute('aria-hidden', 'true');
        nodes.overlay.classList.remove('active'); nodes.overlay.setAttribute('aria-hidden', 'true');
        // 等待过渡结束再恢复 body overflow
        var done = function () { try { document.body.style.overflow = _lastBodyOverflow || ''; nodes.panel.removeEventListener('transitionend', done, false); } catch (e) { dlog('close done error', e); } };
        nodes.panel.addEventListener('transitionend', done, false);
        // 保险超时
        setTimeout(function () { try { document.body.style.overflow = _lastBodyOverflow || ''; } catch (e) {} }, 600);
        dlog('mobile-nav closed');
    }

    function togglePanel() { if (_state.open) closePanel(); else openPanel(); }

    function _bindToggleElements() {
        try {
            var els = Array.prototype.slice.call(document.querySelectorAll('.nav-toggle') || []);
            nodes.toggles = els;
            // install toggleClick if not exists
            if (!_handlers.toggleClick) {
                _handlers.toggleClick = function (e) {
                    try {
                        try { if (e && e.__mobileNavHandled) return; } catch (er) {}
                        e.preventDefault(); e.stopPropagation();
                        var now = Date.now(); if (now - _lastToggleTime < 300) return; _lastToggleTime = now;
                        togglePanel();
                    } catch (err) { dlog('toggleClick err', err); }
                };
            }
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (!el.__mobileNavBound) {
                    el.addEventListener('click', _handlers.toggleClick, false);
                    try { el.setAttribute('aria-expanded', 'false'); el.setAttribute('aria-controls', 'mobile-nav-panel'); } catch (e) {}
                    el.__mobileNavBound = true;
                }
            }
        } catch (e) { dlog('bindToggleElements error', e); }
    }

    function bind() {
        try {
            var p = ensurePanel(); nodes.panel = p.panel; nodes.overlay = p.overlay;
            if (nodes.panel && nodes.panel.querySelector('.mobile-nav-list')) populatePanel(nodes.panel);

            // capture-phase handler: 优先捕获 .nav-toggle 点击，解决被其他脚本 stopPropagation 导致的失效
            if (!_handlers.captureToggle) {
                _handlers.captureToggle = function (e) {
                    try {
                        var t = e.target && e.target.closest && e.target.closest('.nav-toggle');
                        if (t) {
                            try { e.__mobileNavHandled = true; } catch (er) {}
                            var now = Date.now(); if (now - _lastToggleTime < 300) return; _lastToggleTime = now;
                            togglePanel();
                        }
                    } catch (err) { dlog('captureToggle err', err); }
                };
                document.addEventListener('click', _handlers.captureToggle, true);
            }

            _bindToggleElements();

            // overlay & keydown & doc click
            nodes.overlay.addEventListener('click', function (e) { try { e.preventDefault(); closePanel(); } catch (err) { dlog('overlay click err', err); } }, false);
            document.addEventListener('keydown', function (e) { var k = e.key || e.keyCode; if (k === 'Escape' || k === 'Esc' || k === 27) closePanel(); }, false);
            document.addEventListener('click', function (e) {
                try {
                    if (!_state.open) return;
                    var tgt = e.target || e.srcElement; if (!tgt) return;
                    // ignore clicks inside panel or on any toggle
                    if ((nodes.panel && nodes.panel.contains(tgt)) || nodes.toggles.some && nodes.toggles.some(function (el) { try { return el.contains && el.contains(tgt); } catch (e) { return false; } })) return;
                    closePanel();
                } catch (err) { dlog('doc click handler err', err); }
            }, false);

            // 监视 header 容器内的变动，若新增 toggle 则重绑
            try {
                var header = document.querySelector('.header-container') || document.body;
                if (window.MutationObserver) {
                    _handlers.observer = new MutationObserver(function () { try { _bindToggleElements(); } catch (e) {} });
                    _handlers.observer.observe(header, { childList: true, subtree: true });
                }
            } catch (e) { dlog('observer setup err', e); }

        } catch (e) { dlog('bind error', e); }
    }

    whenReady(function () { try { bind(); dlog('mobile-nav initialized'); } catch (e) { dlog('whenReady bind err', e); } });

    // 对外（测试）暴露少量接口
    try { window.__MOBILE_NAV = { open: openPanel, close: closePanel, toggle: togglePanel }; } catch (e) {}

})();
