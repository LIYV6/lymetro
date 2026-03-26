/* include-fragments.js
   - 使用原生 fetch 加载 partials/header.html 和 partials/footer.html
   - 在 DOMContentLoaded 之前插入文档占位符内容
   - 在 window 上设置 window.__fragmentsLoaded Promise，供其它脚本等待
*/
(function () {
    // 外部可等待的 Promise
    let resolveLoaded;
    window.__fragmentsLoaded = new Promise(function (resolve) { resolveLoaded = resolve; });

    async function loadFragment(url) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed to load ' + url);
            return await res.text();
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    async function inject() {
        // 在加载开始时标记页面为正在加载 fragments，以便 CSS 可以隐藏主体避免闪烁
        try { document.documentElement.classList.add('fragments-loading'); } catch (e) {}
        // header placeholder: <div data-include="header"></div>
        const headerPlace = document.querySelector('[data-include="header"]');
        const footerPlace = document.querySelector('[data-include="footer"]');

        const promises = [];
        // 为了兼容根目录页和位于子目录（如 views/）的页面，尝试多个候选相对路径，使用第一个成功加载的
        function tryLoadFromCandidates(candidates) {
            return (async function () {
                for (let i = 0; i < candidates.length; i++) {
                    try {
                        const txt = await loadFragment(candidates[i]);
                        if (txt) return txt;
                    } catch (e) { /* ignore and try next */ }
                }
                return null;
            })();
        }

        const headerCandidates = [
            'partials/header.html',
            '../partials/header.html',
            '../../partials/header.html'
        ];
        const footerCandidates = [
            'partials/footer.html',
            '../partials/footer.html',
            '../../partials/footer.html'
        ];

        if (headerPlace) {
            promises.push(tryLoadFromCandidates(headerCandidates).then(html => { if (html) headerPlace.outerHTML = html; }));
        }
        if (footerPlace) {
            promises.push(tryLoadFromCandidates(footerCandidates).then(html => { if (html) footerPlace.outerHTML = html; }));
        }

        await Promise.all(promises);

    // 去重：如果页面上存在多个 header/footer，保留第一次注入的那个并移除其余的
        (function dedupeInserted() {
            // header
            const headers = Array.from(document.querySelectorAll('.site-header'));
            if (headers.length > 1) {
                // keep the first, remove others
                headers.slice(1).forEach(h => h.parentNode && h.parentNode.removeChild(h));
            }
            // footer
            const footers = Array.from(document.querySelectorAll('.main-footer'));
            if (footers.length > 1) {
                footers.slice(1).forEach(f => f.parentNode && f.parentNode.removeChild(f));
            }
        })();

        // 修复注入后片段内的相对链接：当页面位于根目录（非 /views/ 子目录）时，
        // 将 header/footer 中指向视图 HTML 的简单相对链接前缀为 views/，以便链接可在根页面工作。
        (function fixInjectedLinks() {
            try {
                const path = location.pathname || '';
                if (path.includes('/views/') || path.match(/\/views\//)) return; // 在 views 页面内无需修改

                const filenames = ['notices.html','lineplan.html','linemap.html','aboutcompany.html','moreinfo.html'];
                const elems = document.querySelectorAll('.site-header a, .main-footer a');
                elems.forEach(a => {
                    try {
                        const href = a.getAttribute('href');
                        if (!href) return;
                        // skip external links, anchors, root-relative or path-containing links
                        if (href.startsWith('http') || href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return;
                        // if href matches a filename we know lives under views/, prefix it
                        const name = href.split('?')[0].split('#')[0];
                        if (filenames.indexOf(name) !== -1) {
                            a.setAttribute('href', 'views/' + href);
                        }
                    } catch (e) { /* ignore per-link errors */ }
                });
            } catch (e) { /* ignore overall errors */ }
        })();

        // small delay to allow styles to recalc then remove loading marker
        requestAnimationFrame(() => requestAnimationFrame(() => {
            try { document.documentElement.classList.remove('fragments-loading'); } catch (e) {}
            resolveLoaded(true);
        }));
    }

    // run as early as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }

})();
