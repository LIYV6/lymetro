/* 简洁主脚本：包含移动汉堡菜单逻辑和页面通用交互（高频、无副作用） */

// 将初始化逻辑封装为函数，便于在 fragments 注入后执行
function __main_init() {
    const navToggle = document.querySelector('.nav-toggle');

    // 创建移动菜单面板（如果页面中未存在）
    let mobilePanel = document.querySelector('.mobile-nav-panel');
    // 创建遮罩（如果页面中未存在）
    let mobileOverlay = document.querySelector('.mobile-nav-overlay');
    if (!mobilePanel) {
        mobilePanel = document.createElement('div');
        mobilePanel.className = 'mobile-nav-panel';
        const ul = document.createElement('ul');
        ul.className = 'mobile-nav-list';

        // 收集主导航链接作为移动端菜单项
        const mainNavLinks = document.querySelectorAll('.main-nav .nav-list .nav-item a');
        mainNavLinks.forEach(a => {
            const li = document.createElement('li');
            li.className = 'mobile-nav-item';
            const link = a.cloneNode(true);
            // 保证点击后关闭面板并正常导航（使用统一关闭函数以触发动画）
            link.addEventListener('click', function () {
                closeMobileNav();
            });
            li.appendChild(link);
            ul.appendChild(li);
        });

        mobilePanel.appendChild(ul);
        document.body.appendChild(mobilePanel);
    }

    if (!mobileOverlay) {
        mobileOverlay = document.createElement('div');
        mobileOverlay.className = 'mobile-nav-overlay';
        mobileOverlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(mobileOverlay);
    }

    // 切换函数：打开/关闭面板并切换按钮符号，使用 clip-path 从汉堡位置扩散
    function openMobileNav() {
        if (!navToggle) return;
        // activate panel and overlay first so panel expands to full width
        mobileOverlay.classList.add('active');
        mobilePanel.classList.add('active');

        // ensure layout updated
        const btnRect = navToggle.getBoundingClientRect();
        const panelRect = mobilePanel.getBoundingClientRect();
        const originX = btnRect.left + btnRect.width / 2 - panelRect.left;
        const originY = btnRect.top + btnRect.height / 2 - panelRect.top;

        // compute max distance to panel corners after panel is active
        const w = panelRect.width || window.innerWidth;
        const h = panelRect.height || (window.innerHeight - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 60));
        const d1 = Math.hypot(originX, originY);
        const d2 = Math.hypot(w - originX, originY);
        const d3 = Math.hypot(originX, h - originY);
        const d4 = Math.hypot(w - originX, h - originY);
        const radius = Math.ceil(Math.max(d1, d2, d3, d4));

        mobilePanel.style.setProperty('--menu-clip-x', originX + 'px');
        mobilePanel.style.setProperty('--menu-clip-y', originY + 'px');
        // start from 0 then expand
        mobilePanel.style.setProperty('--menu-clip-radius', '0px');

        // trigger expansion on next frame
        requestAnimationFrame(function () {
            mobilePanel.style.setProperty('--menu-clip-radius', radius + 'px');
        });

        navToggle.classList.add('active');
        navToggle.setAttribute('aria-expanded', 'true');
        navToggle.textContent = '×';
    }

    function closeMobileNav() {
        if (!navToggle) return;
        // shrink clip to 0, hide overlay
        mobilePanel.style.setProperty('--menu-clip-radius', '0px');
        mobileOverlay.classList.remove('active');

        // after clip transition finishes, remove active class
        const onEnd = function (e) {
            // some browsers report 'clip-path' other times 'clipPath'
            if (!e || (e.propertyName && (e.propertyName.includes('clip') || e.propertyName.includes('clip-path')))) {
                mobilePanel.classList.remove('active');
                mobilePanel.removeEventListener('transitionend', onEnd);
            }
        };

        mobilePanel.addEventListener('transitionend', onEnd);

        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.textContent = '☰';
    }

    function toggleMobileNav() {
        if (!mobilePanel.classList.contains('active')) openMobileNav(); else closeMobileNav();
    }

    if (navToggle) {
        navToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleMobileNav();
        });
    }

    // 点击遮罩关闭
    mobileOverlay.addEventListener('click', function () {
        closeMobileNav();
    });

    // 点击页面空白处关闭
    document.addEventListener('click', function (e) {
        if (!mobilePanel.contains(e.target) && navToggle && !navToggle.contains(e.target)) {
            closeMobileNav();
        }
    });

    // Esc 键关闭
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeMobileNav();
        }
    });

    // 触发一次以设置初始文本
    if (navToggle && !navToggle.textContent.trim()) navToggle.textContent = '☰';

    // 平滑滚动/其他通用交互可在此添加（轻量、无副作用）
}

// 如果 include-fragments.js 已经提供了 Promise，则等待其完成再初始化；否则在 DOMContentLoaded 时初始化
if (window.__fragmentsLoaded && typeof window.__fragmentsLoaded.then === 'function') {
    window.__fragmentsLoaded.then(function () {
        // 执行初始化（保持原有行为）
        document.addEventListener('DOMContentLoaded', __main_init);
        // 如果 DOM 已经可用，立即执行
        if (document.readyState !== 'loading') __main_init();
    }).catch(function () {
        // 失败时仍然尝试初始化以保证页面功能
        document.addEventListener('DOMContentLoaded', __main_init);
    });
} else {
    document.addEventListener('DOMContentLoaded', __main_init);
}

// 首屏自动滚动补充：在非触摸设备上，向下快速滚动会平滑跳转到第二屏
(function () {
    // 双向有阻力的平滑翻页处理（非触摸设备）
    if ('ontouchstart' in window) return;
    const first = document.getElementById('first-screen');
    const second = document.getElementById('second-screen');
    if (!first || !second) return;

    let locked = false;
    let acc = 0;
    const THRESH = 70; // 触发阈值
    const RESIST = 0.8; // 阻力系数

    function isNearTop(el) {
        const r = el.getBoundingClientRect();
        return Math.abs(r.top) < 12;
    }

    // 平滑滚动函数（requestAnimationFrame + easeOutCubic），用于上下翻页
    function smoothScrollTo(targetY, duration = 700, cb) {
        const startY = window.scrollY || window.pageYOffset;
        const diff = targetY - startY;
        const start = performance.now();
        function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
        function step(now) {
            const elapsed = now - start;
            const t = Math.min(1, elapsed / duration);
            window.scrollTo(0, Math.round(startY + diff * easeOutCubic(t)));
            if (t < 1) requestAnimationFrame(step); else if (typeof cb === 'function') cb();
        }
        requestAnimationFrame(step);
    }

    function onWheel(e) {
        // 如果正在动画中，阻止默认以避免干扰
        if (locked) { e.preventDefault(); return; }
        const d = e.deltaY;

        // 启动向下从第一页到第二页
        if (isNearTop(first) && d > 0) {
            acc = acc * RESIST + d;
            if (acc > THRESH) {
                // 阻止浏览器默认滚动，使用自定义平滑动画
                e.preventDefault();
                locked = true;
                // 使用自定义平滑滚动到第二页（第一页->第二页）
                const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 60;
                const targetYdown = second.getBoundingClientRect().top + window.scrollY - headerH;
                smoothScrollTo(targetYdown, 700, function () { locked = false; acc = 0; });
            }
            return;
        }

        // 启动向上从第二页回到第一页（移除阻力，立即触发平滑滚动）
        if (isNearTop(second) && d < 0) {
            e.preventDefault();
            if (!locked) {
                locked = true;
                const headerH2 = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 60;
                const targetYup = first.getBoundingClientRect().top + window.scrollY - headerH2;
                smoothScrollTo(targetYup, 700, function () { locked = false; acc = 0; });
            }
            return;
        }

        acc *= 0.5;
    }

    // 注意：listener 设置 passive: false 以便在触发滚动时调用 preventDefault()
    window.addEventListener('wheel', onWheel, { passive: false });
})();
