/* 简洁主脚本：包含移动汉堡菜单逻辑和页面通用交互（高频、无副作用）
   已封装为 IIFE，提供可选配置覆盖：window.__MAIN_JS_CONFIG
*/
(function () {
    'use strict';

    // 默认配置，可通过 window.__MAIN_JS_CONFIG 覆盖（仅在页面中设置该全局对象即可）
    const DEFAULT_CFG = {
        dev: false, // 开发环境开启错误日志
        // 平滑滚动与翻页阈值/参数
        scroll: {
            THRESH: 70,
            RESIST: 0.8,
            smoothDuration: 700
        },
        // header height 回退值（当 CSS 变量缺失时使用）
        headerHeightFallback: 60,
        // animation/transition durations（ms）
        panelTransition: 360,
        // 是否在打开时填充移动面板
        autoPopulatePanel: true
    };

    const CFG = Object.assign({}, DEFAULT_CFG, (window && window.__MAIN_JS_CONFIG) || {});

    function logError(err, ctx) {
        if (CFG.dev && console && console.error) {
            console.error('main.js error', ctx || '', err);
        }
    }

    // 将主逻辑封装，避免污染全局
    function initMain() {
        // 本地变量
        let navToggle = document.querySelector('.nav-toggle');
        function ensureNavToggle(fallbackEl) { if (!navToggle) navToggle = (fallbackEl || document.querySelector('.nav-toggle')); return navToggle; }

        let mobilePanel = document.querySelector('.mobile-nav-panel');
        let mobileOverlay = document.querySelector('.mobile-nav-overlay');
        // nav snapshot 缓存，避免不必要的重建
        let lastNavSnapshot = '';

        // 创建面板/overlay（若不存在）
        if (!mobilePanel) {
            mobilePanel = document.createElement('div');
            mobilePanel.className = 'mobile-nav-panel';
            // 确保有 id 以便 aria-controls 指向
            if (!mobilePanel.id) mobilePanel.id = 'mobile-nav-panel';
            const ul = document.createElement('ul');
            ul.className = 'mobile-nav-list';
            mobilePanel.appendChild(ul);
            document.body.appendChild(mobilePanel);
        } else {
            if (!mobilePanel.id) mobilePanel.id = 'mobile-nav-panel';
        }

        if (!mobileOverlay) {
            mobileOverlay = document.createElement('div');
            mobileOverlay.className = 'mobile-nav-overlay';
            mobileOverlay.setAttribute('aria-hidden', 'true');
            document.body.appendChild(mobileOverlay);
        }

        // 为 navToggle 设置 aria-controls（若存在）
        try { if (navToggle) navToggle.setAttribute('aria-controls', mobilePanel.id); } catch (e) { logError(e, 'aria-controls'); }

        // 获取导航快照（用于比较是否变化）
        function getNavSnapshot() {
            try {
                const links = document.querySelectorAll('.main-nav .nav-list .nav-item a');
                if (!links || links.length === 0) return '';
                let s = '';
                links.forEach(a => { s += '|' + (a.href || '') + '::' + (a.textContent || ''); });
                return s;
            } catch (e) { logError(e, 'getNavSnapshot'); return ''; }
        }

        // 填充移动面板，仅在导航实际变化时重建 DOM
        function populateMobilePanel() {
            if (!mobilePanel) return;
            try {
                const ul = mobilePanel.querySelector('.mobile-nav-list');
                if (!ul) return;
                // snapshot 比对
                const snap = getNavSnapshot();
                if (snap && snap === lastNavSnapshot) return; // 未变化，跳过重建
                lastNavSnapshot = snap;

                // 重建列表
                ul.innerHTML = '';
                const mainNavLinks = document.querySelectorAll('.main-nav .nav-list .nav-item a');
                const source = (mainNavLinks && mainNavLinks.length) ? mainNavLinks : document.querySelectorAll('.site-header a, .header-container a');
                source.forEach(a => {
                    const li = document.createElement('li');
                    li.className = 'mobile-nav-item';
                    const link = a.cloneNode(true);
                    link.addEventListener('click', function () { closeMobileNav(); });
                    li.appendChild(link);
                    ul.appendChild(li);
                });
            } catch (e) { logError(e, 'populateMobilePanel'); }
        }

        if (CFG.autoPopulatePanel) populateMobilePanel();

    // 记录打开前的活动元素以便在关闭时恢复焦点（避免干扰像 select 的交互）
    let lastFocusedBeforeOpen = null;

    // 打开/关闭逻辑
        function openMobileNav() {
            try {
                ensureNavToggle();
                if (!navToggle || !mobilePanel || !mobileOverlay) return;
                // 在打开前确保菜单项为最新
                try { populateMobilePanel(); } catch (e) { logError(e, 'populate-before-open'); }

                mobileOverlay.classList.add('active');
                mobilePanel.classList.add('active');

                const btnRect = navToggle.getBoundingClientRect();
                const panelRect = mobilePanel.getBoundingClientRect();
                const originX = btnRect.left + btnRect.width / 2 - panelRect.left;
                const originY = btnRect.top + btnRect.height / 2 - panelRect.top;
                const w = panelRect.width || window.innerWidth;
                const h = panelRect.height || (window.innerHeight - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || CFG.headerHeightFallback));
                const d1 = Math.hypot(originX, originY);
                const d2 = Math.hypot(w - originX, originY);
                const d3 = Math.hypot(originX, h - originY);
                const d4 = Math.hypot(w - originX, h - originY);
                const radius = Math.ceil(Math.max(d1, d2, d3, d4));

                mobilePanel.style.setProperty('--menu-clip-x', originX + 'px');
                mobilePanel.style.setProperty('--menu-clip-y', originY + 'px');
                mobilePanel.style.setProperty('--menu-clip-radius', '0px');
                requestAnimationFrame(function () { mobilePanel.style.setProperty('--menu-clip-radius', radius + 'px'); });

                navToggle.classList.add('active');
                navToggle.setAttribute('aria-expanded', 'true');
                navToggle.textContent = '×';

                // Accessibility: attributes and focus
                try {
                    mobilePanel.setAttribute('role', 'dialog');
                    mobilePanel.setAttribute('aria-modal', 'true');
                    mobilePanel.setAttribute('aria-hidden', 'false');
                    mobileOverlay.setAttribute('aria-hidden', 'false');
                    // 记录打开前的活动元素（避免记录 body/document）
                    try {
                        const ae = document.activeElement;
                        if (ae && ae !== document.body && ae !== document.documentElement && ae !== navToggle) lastFocusedBeforeOpen = ae;
                    } catch (e) { /* ignore */ }
                    // focus first link
                    const firstLink = mobilePanel.querySelector('a');
                    if (firstLink && typeof firstLink.focus === 'function') firstLink.focus();
                } catch (e) { logError(e, 'open-a11y'); }
            } catch (e) { logError(e, 'openMobileNav'); }
        }

        function closeMobileNav() {
            try {
                ensureNavToggle();
                if (!navToggle || !mobilePanel || !mobileOverlay) return;
                mobilePanel.style.setProperty('--menu-clip-radius', '0px');
                mobileOverlay.classList.remove('active');

                const onEnd = function (e) {
                    if (!e || (e.propertyName && (e.propertyName.includes('clip') || e.propertyName.includes('clip-path')))) {
                        mobilePanel.classList.remove('active');
                        mobilePanel.removeEventListener('transitionend', onEnd);
                    }
                };
                mobilePanel.addEventListener('transitionend', onEnd);

                navToggle.classList.remove('active');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.textContent = '☰';

                // Accessibility: restore focus to previous active element if possible
                try {
                    mobilePanel.setAttribute('aria-hidden', 'true');
                    mobileOverlay.setAttribute('aria-hidden', 'true');
                    if (lastFocusedBeforeOpen && typeof lastFocusedBeforeOpen.focus === 'function') {
                        lastFocusedBeforeOpen.focus();
                    } else if (typeof navToggle.focus === 'function') {
                        // fallback: focus navToggle only if nothing else
                        navToggle.focus();
                    }
                    lastFocusedBeforeOpen = null;
                } catch (e) { logError(e, 'close-a11y'); }
            } catch (e) { logError(e, 'closeMobileNav'); }
        }

        function toggleMobileNav() { if (!mobilePanel.classList.contains('active')) openMobileNav(); else closeMobileNav(); }

        // 合并的 document click 处理：处理 toggler 点击和空白处关闭，避免重复监听
        function onDocumentClick(e) {
            try {
                const toggler = e.target && e.target.closest && e.target.closest('.nav-toggle');
                if (toggler) {
                    ensureNavToggle(toggler);
                    // stop here to avoid falling-through to close logic
                    e.preventDefault();
                    toggleMobileNav();
                    return;
                }
                // 点击在 panel 之外且面板处于打开状态则关闭（忽略 select 等交互控件）
                if (mobilePanel && mobilePanel.classList.contains('active') && !mobilePanel.contains(e.target)) {
                    try {
                        // 忽略对下拉/表单控件的点击，以免阻止 select 的交互
                        if (e.target && e.target.closest && e.target.closest('select, option, .map-select, .dropdown-container')) {
                            return;
                        }
                    } catch (innerErr) { /* ignore */ }
                    closeMobileNav();
                }
            } catch (err) { logError(err, 'onDocumentClick'); }
        }

        // 按键处理（Esc 关闭）
        function onKeyDown(e) { if (e.key === 'Escape') closeMobileNav(); }

        // 绑定事件（单一委托）
        document.addEventListener('click', onDocumentClick);
        document.addEventListener('keydown', onKeyDown);

        // 初始文本设置
        try { if (navToggle && !navToggle.textContent.trim()) navToggle.textContent = '☰'; } catch (e) { logError(e, 'init-text'); }

        // Expose for debugging only when dev flag enabled
        if (CFG.dev && window) { try { window.__main = { openMobileNav, closeMobileNav, populateMobilePanel }; } catch (e) { /* ignore */ } }

        // 返回一些内部引用以便测试或其他逻辑使用（不暴露全局）
        return { populateMobilePanel, openMobileNav, closeMobileNav };
    }

    // 初始化时机：如果 fragments has promise，则等待其加载，否则 DOMContentLoaded
    function boot() {
        try {
            const runInit = () => { try { initMain(); } catch (e) { logError(e, 'initMain'); } };
            if (window.__fragmentsLoaded && typeof window.__fragmentsLoaded.then === 'function') {
                window.__fragmentsLoaded.then(function () {
                    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit); else runInit();
                }).catch(function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit); });
            } else {
                if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runInit); else runInit();
            }
        } catch (e) { logError(e, 'boot'); }
    }

    // -------------- 以下为原先首屏滚动逻辑（整合配置并增强鲁棒性） --------------
    // 将整个首屏滚动逻辑封装，使用 CFG.scroll 参数
    (function () {
        // 双向有阻力的平滑翻页处理（非触摸设备）
        if ('ontouchstart' in window) return;
        const first = document.getElementById('first-screen');
        const second = document.getElementById('second-screen');
        if (!first || !second) {
            // 如果元素不存在，跳过但不抛错
            boot();
            return;
        }

        let locked = false;
        let acc = 0;
        const THRESH = (CFG.scroll && CFG.scroll.THRESH) || DEFAULT_CFG.scroll.THRESH;
        const RESIST = (CFG.scroll && CFG.scroll.RESIST) || DEFAULT_CFG.scroll.RESIST;

        function isNearTop(el) {
            try {
                if (!el || !el.getBoundingClientRect) return false;
                const r = el.getBoundingClientRect();
                return Math.abs(r.top) < 12;
            } catch (e) { logError(e, 'isNearTop'); return false; }
        }

        function smoothScrollTo(targetY, duration = (CFG.scroll && CFG.scroll.smoothDuration) || DEFAULT_CFG.scroll.smoothDuration, cb) {
            try {
                const maxY = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
                const clamped = Math.max(0, Math.min(targetY, maxY));
                const startY = window.scrollY || window.pageYOffset;
                const diff = clamped - startY;
                const start = performance.now();
                function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
                function step(now) {
                    const elapsed = now - start;
                    const t = Math.min(1, elapsed / duration);
                    window.scrollTo(0, Math.round(startY + diff * easeOutCubic(t)));
                    if (t < 1) requestAnimationFrame(step); else if (typeof cb === 'function') cb();
                }
                requestAnimationFrame(step);
            } catch (e) { logError(e, 'smoothScrollTo'); if (typeof cb === 'function') cb(); }
        }

        function onWheel(e) {
            try {
                if (locked) { e.preventDefault(); return; }
                const d = e.deltaY;
                if (isNearTop(first) && d > 0) {
                    acc = acc * RESIST + d;
                    if (acc > THRESH) {
                        e.preventDefault();
                        locked = true;
                        const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || CFG.headerHeightFallback;
                        const rect = second.getBoundingClientRect();
                        const targetYdown = rect.top + window.scrollY - headerH;
                        smoothScrollTo(targetYdown, CFG.scroll.smoothDuration, function () { locked = false; acc = 0; });
                    }
                    return;
                }
                if (isNearTop(second) && d < 0) {
                    e.preventDefault();
                    if (!locked) {
                        locked = true;
                        const headerH2 = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || CFG.headerHeightFallback;
                        const rectUp = first.getBoundingClientRect();
                        const targetYup = rectUp.top + window.scrollY - headerH2;
                        smoothScrollTo(targetYup, CFG.scroll.smoothDuration, function () { locked = false; acc = 0; });
                    }
                    return;
                }
                acc *= 0.5;
            } catch (e) { logError(e, 'onWheel'); }
        }

        window.addEventListener('wheel', onWheel, { passive: false });

        // 在初始化完成后启动主逻辑
        boot();
    })();


// 结束：所有行为封装于 IIFE 中

})();
