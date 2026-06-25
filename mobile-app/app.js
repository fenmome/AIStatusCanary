// AI Status Canary Mobile - Business Logic

const API_BASE = "https://ai-status-worker.fenmo-wind.workers.dev";
let isSubscribed = false;
let swRegistration = null;
let lastStatus = null;
let eventsHistory = [];

// 辅助函数：将 Base64 VAPID 公钥转换为 Uint8Array
function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// 显示 Toast 提示
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

// 渲染历史记录列表
function renderHistory() {
    const container = document.getElementById('events-timeline');
    if (eventsHistory.length === 0) {
        container.innerHTML = '<div class="timeline-empty">暂无历史事件</div>';
        return;
    }
    
    let html = "";
    eventsHistory.forEach(item => {
        html += `
            <div class="timeline-item">
                <span class="time-badge">${item.time}</span>
                <div class="timeline-detail">
                    <span class="status-tag tag-${item.status}">${item.status}</span>
                    <span style="font-weight: 500; color: var(--text-primary);">[${item.last_tool}]</span>
                    <span style="color: var(--text-secondary);">${item.detail}</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// 向历史记录添加事件并保存到本地
function addHistoryEvent(status, last_tool, detail) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    eventsHistory.unshift({
        time: timeStr,
        status,
        last_tool: last_tool || '系统',
        detail
    });
    
    // 只保留最近 20 条
    if (eventsHistory.length > 20) {
        eventsHistory.pop();
    }
    
    localStorage.setItem('canary_events_history', JSON.stringify(eventsHistory));
    renderHistory();
}

// 加载历史记录
function loadHistory() {
    const cached = localStorage.getItem('canary_events_history');
    if (cached) {
        try {
            eventsHistory = JSON.parse(cached);
        } catch (e) {
            eventsHistory = [];
        }
    }
    renderHistory();
}

// 更新界面状态（大呼吸环）
function updateUIStatus(status, last_tool, detail) {
    const card = document.getElementById('status-card');
    const text = document.getElementById('status-text');
    const tool = document.getElementById('active-tool');
    const desc = document.getElementById('status-desc');
    const icon = document.getElementById('status-icon');
    
    // 移除旧的状态类
    card.classList.remove('status-RUNNING', 'status-WAITING', 'status-COMPLETED');
    card.classList.add(`status-${status}`);
    
    text.innerText = status === 'RUNNING' ? '正在执行' : (status === 'WAITING' ? '等待确认' : '就绪');
    tool.innerText = last_tool || '无';
    desc.innerText = detail || '正在运行中...';
    
    // 切换不同的 SVG 图标
    if (status === 'RUNNING') {
        icon.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-running" style="width: 100%; height: 100%;">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
    } else if (status === 'WAITING') {
        icon.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-waiting" style="width: 100%; height: 100%;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
    } else {
        icon.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-completed" style="width: 100%; height: 100%;">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="22 4 12 14.01 9 11.01" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
    }
}

// 轮询当前状态
async function pollStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/status`);
        if (!response.ok) return;
        const data = await response.json();
        
        if (!lastStatus || lastStatus.status !== data.status || lastStatus.last_tool !== data.last_tool) {
            updateUIStatus(data.status, data.last_tool, data.detail);
            
            // 避免首次加载就记录历史
            if (lastStatus) {
                addHistoryEvent(data.status, data.last_tool, data.detail);
            }
            lastStatus = data;
        }
    } catch (e) {
        console.error("轮询状态失败:", e);
    }
}

// 订阅 Web Push 核心逻辑
async function subscribeUser() {
    const btn = document.getElementById('btn-subscribe');
    btn.disabled = true;
    btn.innerText = '请稍候...';
    
    try {
        // 1. 获取服务器公钥
        const resKey = await fetch(`${API_BASE}/api/vapid-public-key`);
        const { publicKey } = await resKey.json();
        const convertedVapidKey = urlB64ToUint8Array(publicKey);
        
        // 2. 注册订阅
        const subscription = await swRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedVapidKey
        });
        
        // 3. 将凭证上传服务器
        const resSub = await fetch(`${API_BASE}/api/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });
        
        if (resSub.ok) {
            isSubscribed = true;
            updateSubscriptionButton();
            showToast("成功启用推送通知！");
        } else {
            throw new Error("向服务器上报凭证失败");
        }
    } catch (e) {
        console.error("订阅失败:", e);
        showToast("启用推送失败: " + e.message);
        btn.disabled = false;
        btn.innerText = '启用推送';
    }
}

// 更新订阅按钮的状态样式
function updateSubscriptionButton() {
    const btn = document.getElementById('btn-subscribe');
    const desc = document.getElementById('pwa-support-desc');
    
    if (isSubscribed) {
        btn.innerText = '已启用';
        btn.disabled = true;
        btn.classList.remove('btn-primary');
        btn.style.background = 'rgba(16, 185, 129, 0.15)';
        btn.style.color = 'var(--color-completed)';
        btn.style.boxShadow = 'none';
        desc.innerText = '已成功订阅通知，请保持 App 运行在后台';
    } else {
        btn.innerText = '启用推送';
        btn.disabled = false;
        btn.classList.add('btn-primary');
        desc.innerText = '授权以在手机状态栏接收实时预警';
    }
}

// 初始化 PWA 环境
async function initPWA() {
    const btn = document.getElementById('btn-subscribe');
    const desc = document.getElementById('pwa-support-desc');
    const iosTip = document.getElementById('ios-tip');
    
    // 检测是否为 iOS 且不在 Standalone 模式下（检测 PWA 是否添加到主屏幕）
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    
    if (isIOS && !isStandalone) {
        iosTip.style.display = 'block';
        desc.innerText = 'iOS 系统限制：必须“添加到主屏幕”后才能启用推送';
        btn.disabled = true;
        btn.innerText = '需添加到主屏幕';
        return;
    }
    
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            // 注册 Service Worker
            swRegistration = await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker 注册成功:', swRegistration);
            
            // 检查是否已经订阅
            const subscription = await swRegistration.pushManager.getSubscription();
            isSubscribed = (subscription !== null);
            
            if (isSubscribed) {
                // 每次启动自动向云端重新上报订阅凭证，防止云端容器重启丢失订阅列表
                fetch(`${API_BASE}/api/subscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(subscription)
                }).catch(e => console.error("自动同步订阅凭证失败:", e));
            }
            
            updateSubscriptionButton();
            
            btn.addEventListener('click', subscribeUser);
        } catch (e) {
            console.error('Service Worker 注册失败:', e);
            desc.innerText = '推送服务注册失败，请检查浏览器权限';
        }
    } else {
        desc.innerText = '当前浏览器不支持推送通知 (请使用 Safari/Chrome/Firefox)';
    }
}

// 页面载入
window.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    initPWA();
    pollStatus();
    
    // 每 2.5 秒轮询一次状态
    setInterval(pollStatus, 2500);
});
