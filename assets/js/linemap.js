// DOM加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // ========== 核心变量定义 ==========
    const mapContainer = document.getElementById('mapContainer');
    const subwayMap = document.getElementById('subwayMap');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const resetBtn = document.getElementById('reset');
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeBtn = document.getElementById('closeBtn');
    const mapSelect = document.getElementById('mapSelect');
    const infoText = document.getElementById('info-text');

    // 图片状态变量
    let scale = 1; // 缩放比例
    let posX = 0;  // 图片X偏移
    let posY = 0;  // 图片Y偏移
    let isDragging = false; // 是否拖拽中
    let startX, startY; // 拖拽起始坐标
    let startPosX, startPosY; // 拖拽起始偏移

    // 缩放限制：增大最大放大倍数，允许更小最小值
    const MIN_SCALE = 0.3;
    const MAX_SCALE = 6;
    // fit 时不将图片缩放得过小，避免视觉上变得很小
    const MIN_FIT_SCALE = 0.6;

    // 线路说明文本：尝试从外部文件 line-info.json 加载（见项目根目录），若失败回退为内置默认文本
    const defaultLineInfo = {
        "全图": { zh: "服务器轨道交通全图，包含所有已开通线路及规划线路。", },
        "鲤湖湾州及鲤城": { zh: "鲤湖湾州及鲤城片区轨道交通线路，覆盖核心城区主要站点。",},
        "大都会区": { zh: "大都会区轨道交通线路，连接周边卫星城与核心区。", },
        "第三城": { zh: "第三城片区轨道交通线路，以通勤线路为主。", },
        "铜钿城": { zh: "铜钿城片区轨道交通线路，覆盖商业及居住区。", },
        "铁路": { zh: "仅显示铁路干线，不含城市轨道交通。", }
    };
     let lineInfo = {};
    // 保存 promise，以便在用户点击时等待数据就绪
    const lineInfoPromise = fetch('./data/line-info.json')//需要注意修改
        .then(r => r.json())
        .then(data => { lineInfo = data || {}; return lineInfo; })
        .catch(err => {
            console.warn('无法加载 line-info.json, 已使用内置默认文本:', err);
            lineInfo = defaultLineInfo;
            return lineInfo;
        });

    // 语言支持已简化为中文，移除切换逻辑

    // ========== 信息按钮功能 ==========
    // 打开弹窗（注入对应线路说明），使用 class 控制显示以配合 CSS
    infoBtn.addEventListener('click', function() {
        const selectedValue = mapSelect.value;
        const item = lineInfo[selectedValue];
        // 若数据尚未加载，显示加载提示并在加载完成后更新（中文）
        if (!item) {
            infoText.textContent = '正在加载...';
            document.getElementById('modal-title').textContent = '线路说明';
            infoModal.classList.add('show');
            lineInfoPromise.then(() => {
                const loaded = lineInfo[selectedValue] || { zh: '' };
                infoText.textContent = loaded.zh || '';
            });
            return;
        }
        //数据已就绪，直接显示（中文）
        infoText.textContent = item.zh || '';
        document.getElementById('modal-title').textContent = '线路说明';
        infoModal.classList.add('show');
    });

    // 关闭弹窗
    closeBtn.addEventListener('click', function() {
        infoModal.classList.remove('show');
    });

    // 点击弹窗外区域关闭
    window.addEventListener('click', function(e) {
        if (e.target === infoModal) {
            infoModal.classList.remove('show');
        }
    });

// ========== 图片拖拽功能 ==========
// 鼠标按下：开始拖拽（允许在顶部导航下的任意位置触发）
    document.addEventListener('mousedown', function(e) {
        // 仅当交互起点在图片容器内时开始（可随后拖出容器）
        const containerRect = mapContainer.getBoundingClientRect();
        const withinContainer = e.clientX >= containerRect.left && e.clientX <= containerRect.right && e.clientY >= containerRect.top && e.clientY <= containerRect.bottom;
        if (!withinContainer) return;
        // 避免在点击容器内的按钮/链接/表单控件时触发拖拽
        if (e.target.closest('button, a, input, select, textarea, .control-btn, .info-btn, .map-select')) return;

        isDragging = true;
        // 记录起始坐标（相对于容器左上角）
        startX = e.clientX - containerRect.left;
        startY = e.clientY - containerRect.top;
        // 记录当前图片偏移
        startPosX = posX;
        startPosY = posY;
        // 阻止默认行为（避免选中页面或触发其他默认交互）
        e.preventDefault();
    });

    // 鼠标移动：执行拖拽（即使超出容器也生效）
    window.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        
        // 计算鼠标移动距离
        const currentX = e.clientX - mapContainer.getBoundingClientRect().left;
        const currentY = e.clientY - mapContainer.getBoundingClientRect().top;
        const dx = currentX - startX;
        const dy = currentY - startY;

        // 更新图片偏移
        posX = startPosX + dx;
        posY = startPosY + dy;

        // 应用偏移和缩放
        updateMapTransform();
    });

    // 鼠标松开：结束拖拽
    window.addEventListener('mouseup', function() {
        isDragging = false;
    });

// ========== 图片缩放功能（滚轮+按钮） ==========
// 滚轮缩放：在顶部导航下任意位置都可用，保持鼠标点不动
    document.addEventListener('wheel', function(e) {
// 仅在交互起点位于图片容器内时触发缩放
        const rect = mapContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const withinContainer = mouseX >= 0 && mouseX <= rect.width && mouseY >= 0 && mouseY <= rect.height;
        if (!withinContainer) return;

        // 避免在容器内对控件滚轮操作时触发（例如下拉框）
        if (e.target.closest('select, input, textarea, .map-select')) return;

        // 阻止页面默认滚动
        e.preventDefault();

        // 计算目标缩放比例并保持鼠标点不动
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const oldScale = scale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + delta));

        // 如果缩放受限（未发生变化），直接返回，避免滚轮造成位置漂移
        if (newScale === oldScale) return;

        // 计算鼠标点在图片坐标系中的位置（未变换前）
        const imgX = (mouseX - (rect.width / 2 + posX)) / oldScale;
        const imgY = (mouseY - (rect.height / 2 + posY)) / oldScale;

        // 应用新的缩放并调整偏移，使鼠标下的图片点保持不动
        scale = newScale;
        posX = mouseX - rect.width / 2 - imgX * newScale;
        posY = mouseY - rect.height / 2 - imgY * newScale;

        updateMapTransform();
    }, { passive: false });

    // 放大按钮
    zoomInBtn.addEventListener('click', function() {
        scale = Math.min(MAX_SCALE, scale + 0.2); // 增加步长与最大放大倍数
        updateMapTransform();
    });

    // 缩小按钮
    zoomOutBtn.addEventListener('click', function() {
        scale = Math.max(MIN_SCALE, scale - 0.2); // 增加步长
        updateMapTransform();
    });

    // 重置按钮：重置并使图片整体适配容器
    resetBtn.addEventListener('click', function() {
    // 清除任何拖拽偏移、重置缩放
        posX = 0;
        posY = 0;
    // 使用 contain 模式展示整张图片（确保不被裁切）
    // 临时关闭过渡以避免闪烁
    const prevTransition = subwayMap.style.transition;
    subwayMap.style.transition = 'none';
    fitImageToContainer(false);
    // 强制回流，确保 transform 已应用
    // eslint-disable-next-line no-unused-expressions
    subwayMap.getBoundingClientRect();
    subwayMap.style.transition = prevTransition || 'transform 0.05s ease';
    });

    // ========== 下拉框切换图片功能 ==========
    mapSelect.addEventListener('change', function() {
        const selectedValue = this.value;
        // 重置缩放和偏移，避免切换后位置错乱
        scale = 1;
        posX = 0;
        posY = 0;
        // 使用离屏预加载以避免切换时显示旧图或闪烁
        const newSrc = `../assets/images/${selectedValue}.png`;
        const pre = new Image();

        // 临时隐藏当前图片，使用 opacity 淡入避免闪烁
        const prevTransition = subwayMap.style.transition;
        // 确保 opacity 可过渡（若之前未包含 opacity，则在恢复时添加）
        subwayMap.style.transition = 'none';
        subwayMap.style.opacity = '0';

        pre.onload = function() {
            // 图片已完全加载于内存，安全替换 src
            subwayMap.src = newSrc;

            // 重置变换参数，保证居中显示
            scale = 1;
            posX = 0;
            posY = 0;

            // 临时移除 transform 过渡，执行 fit
            subwayMap.style.transition = 'none';
            fitImageToContainer(false);
            // 强制回流
            // eslint-disable-next-line no-unused-expressions
            subwayMap.getBoundingClientRect();

            // 恢复过渡并添加 opacity 过渡以实现平滑淡入
            subwayMap.style.transition = prevTransition || 'transform 0.05s ease, opacity 180ms ease';
            // 淡入显示
            subwayMap.style.opacity = '1';

            // 更新弹窗说明文本（中文）
            const selItem = lineInfo[selectedValue] || { zh: '' };
            infoText.textContent = selItem.zh || '';
        };

        pre.onerror = function() {
            // 预加载失败时回退到全图并提示（保持之前行为）
            alert('当前线路图加载失败，已自动切换为全图，请刷新页面重试');
            mapSelect.value = '全图';
            const defaultItem = lineInfo['全图'] || { zh: '' };
            infoText.textContent = defaultItem.zh || '';
            // 尝试加载全图
            pre.src = '../assets/images/全图.png';
        };

        // 启动预加载（如果已经缓存，onload 将同步触发）
        pre.src = newSrc;
    });

    // ========== 图片加载失败处理 ==========
    subwayMap.addEventListener('error', function() {
        // 加载默认图片（全图）
        this.src = '../assets/images/全图.png';
        // 提示用户，不篡改原有文字风格
        alert('当前线路图加载失败，已自动切换为全图，请刷新页面重试');
    // 重置选择框为全图
    mapSelect.value = '全图';
    const defaultItem = lineInfo['全图'] || { zh: '' };
    infoText.textContent = defaultItem.zh || '';
    });

    // 防止重复触发 fit 的标志（首次稳定布局后做一次 fit）
    let initialFitDone = false;
    function scheduleInitialFit() {
        if (initialFitDone) return;
        initialFitDone = true;
        // 在下一个帧执行，确保布局完成
        requestAnimationFrame(() => {
            // 小延迟再调用，减少样式/布局抖动引起的二次 fit
            setTimeout(() => {
                // 在首次 fit 时临时关闭 transition，避免图片先放大再缩小的闪烁
                const prevTransition = subwayMap.style.transition;
                subwayMap.style.transition = 'none';
                // 使用 contain（默认）以保证首次加载时图片整体可见
                fitImageToContainer(false);
                // 强制回流，确保 transform 已应用
                // eslint-disable-next-line no-unused-expressions
                subwayMap.getBoundingClientRect();
                // 恢复过渡（保守设置为短时过渡），允许后续交互有平滑感
                subwayMap.style.transition = prevTransition || 'transform 0.05s ease';
            }, 20);
        });
    }

    // 当图片加载完成时，自动调整使图片整体可见（并 schedule 初次 fit）
    subwayMap.addEventListener('load', function() {
        scheduleInitialFit();
    });

    // 如果图片已缓存并已加载完毕，安排一次初始 fit
    if (subwayMap.complete && subwayMap.naturalWidth && subwayMap.naturalHeight) {
        scheduleInitialFit();
    }

    // 在 window load 后再安排一次初始 fit，以确保样式/资源稳定
    window.addEventListener('load', function() {
        scheduleInitialFit();
    });

    // ========== 辅助函数：更新图片变换 ==========
    function updateMapTransform() {
    // 使用 transform-origin 保持缩放以图片中心为基准
    subwayMap.style.transformOrigin = '50% 50%';
    subwayMap.style.transform = `translate(-50%, -50%) translate(${posX}px, ${posY}px) scale(${scale})`;
    }

    // 将图片等比缩放并居中。
    // 参数 fillCover: true => 使用 cover（充满容器，可能裁切），false => 使用 contain（整体可见）
    function fitImageToContainer(fillCover = false) {
        // 如果图片尚未加载自然尺寸则跳过
        if (!subwayMap.naturalWidth || !subwayMap.naturalHeight) {
            // 若图片未加载，稍后 load 事件会触发
            return;
        }

        const containerRect = mapContainer.getBoundingClientRect();
        const cw = containerRect.width;
        const ch = containerRect.height;

        // 为了正确计算（考虑 CSS 对图片的影响），先读取图片在无 transform 下的布局尺寸
        const prevTransform = subwayMap.style.transform;
        subwayMap.style.transform = 'none';
        const baseRect = subwayMap.getBoundingClientRect();
        const baseW = baseRect.width;
        const baseH = baseRect.height;
        // 恢复之前的 transform（不应用 scale yet）
        subwayMap.style.transform = prevTransform || '';

        if (!baseW || !baseH) {
            // 若布局尺寸不可用，退回到使用 naturalWidth/naturalHeight 的保守计算
            const iw = subwayMap.naturalWidth;
            const ih = subwayMap.naturalHeight;
            const scaleX = cw / iw;
            const scaleY = ch / ih;
            let fitScale = fillCover ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
            if (!fillCover) fitScale = Math.max(fitScale, MIN_FIT_SCALE);
            scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fitScale));
        } else {
            // 基于布局尺寸计算目标 scale（layout size * scale => 实际显示大小）
            const scaleX = cw / baseW;
            const scaleY = ch / baseH;
            let fitScale = fillCover ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
            if (!fillCover) fitScale = Math.max(fitScale, MIN_FIT_SCALE);
            scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fitScale));
        }

        // 重置偏移为居中
        posX = 0;
        posY = 0;
        updateMapTransform();
    }

// ====键盘控制缩放/移动====
    window.addEventListener('keydown', function(e) {
        // 避免输入框等场景触发，仅在非焦点状态生效
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            switch(e.key) {
                case '+': // 放大
                    scale = Math.min(MAX_SCALE, scale + 0.2);
                    updateMapTransform();
                    break;
                case '-': // 缩小
                    scale = Math.max(MIN_SCALE, scale - 0.2);
                    updateMapTransform();
                    break;
                case 'ArrowUp': // 上移
                    posY -= 20;
                    updateMapTransform();
                    break;
                case 'ArrowDown': // 下移
                    posY += 20;
                    updateMapTransform();
                    break;
                case 'ArrowRight': // 右移
                    posX += 20;
                    updateMapTransform();
                    break;
                case 'ArrowLeft': // 左移
                    posX -= 20;
                    updateMapTransform();
                    break;
                case 'Escape': // 重置
                    posX = 0;
                    posY = 0;
                    fitImageToContainer();
                    break;
            }
        }
    });
    console.log('线网示意页面脚本加载完成');
});