// AI Status Canary - Tauri Client Javascript

let audioCtx = null;
let lastStatus = null;
let isFirstLoad = true;

// SVG 图标定义
const ICONS = {
    RUNNING: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-running">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    WAITING: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-waiting">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="9" x2="12" y2="13" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="17" x2="12.01" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `,
    COMPLETED: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-completed">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="22 4 12 14.01 9 11.01" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `
};

// 获取 Tauri API 支持
function getTauri() {
    return window.__TAURI__ || null;
}

// 初始化并激活 AudioContext
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const banner = document.getElementById('audio-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

// 网页任意点击激活音频
document.addEventListener('click', initAudio, { once: false });
document.addEventListener('keydown', initAudio, { once: false });

// Web Audio API 本地音效合成器
function playSynthesizedSound(type) {
    if (!document.getElementById('sound-toggle').checked) return;
    
    initAudio();
    if (!audioCtx) return;
    
    const volumeSlider = document.getElementById('volume-slider');
    const masterVolume = parseFloat(volumeSlider.value) / 100;
    
    if (masterVolume === 0) return;
    
    const now = audioCtx.currentTime;
    
    if (type === 'running') {
        // C4 -> E4 -> G4 -> C5 升音阶电子琶音
        const notes = [261.63, 329.63, 392.00, 523.25];
        notes.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + index * 0.08);
            
            gain.gain.setValueAtTime(0, now + index * 0.08);
            gain.gain.linearRampToValueAtTime(masterVolume * 0.5, now + index * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.25);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(now + index * 0.08);
            osc.stop(now + index * 0.08 + 0.3);
        });
        
    } else if (type === 'waiting') {
        // A4 频率双短音警报音
        const times = [0, 0.25];
        times.forEach(delay => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440.00, now + delay);
            
            gain.gain.setValueAtTime(0, now + delay);
            gain.gain.linearRampToValueAtTime(masterVolume * 0.6, now + delay + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(now + delay);
            osc.stop(now + delay + 0.2);
        });
        
    } else if (type === 'completed') {
        // C4/E4/G4/C5 共同鸣响和弦铜铃音
        const notes = [261.63, 329.63, 392.00, 523.25];
        notes.forEach(freq => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.linearRampToValueAtTime(freq + 3, now + 0.5);
            
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(masterVolume * 0.3, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(now);
            osc.stop(now + 1.3);
        });
    }
}

// 模拟测试音效
window.playChimeTest = function(type) {
    initAudio();
    playSynthesizedSound(type);
};

// 中文 TTS 语音播报
function speakStatus(text) {
    if (!document.getElementById('tts-toggle').checked) return;
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    
    const volumeSlider = document.getElementById('volume-slider');
    utterance.volume = parseFloat(volumeSlider.value) / 100;
    utterance.rate = 1.05;
    
    window.speechSynthesis.speak(utterance);
}

// 侧边通知栏 Toast
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

// 切换选项卡
window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // 激活当前
    if (event && event.target) {
        event.target.classList.add('active');
    }
    document.getElementById(tabId).classList.add('active');
};

// 加载配置
async function loadSettings() {
    const tauri = getTauri();
    if (!tauri) return;
    
    try {
        const data = await tauri.core.invoke('get_config');
        document.getElementById('bark_key').value = data.bark_key || '';
        document.getElementById('feishu_webhook').value = data.feishu_webhook || '';
        document.getElementById('dingtalk_webhook').value = data.dingtalk_webhook || '';
        document.getElementById('wechat_webhook').value = data.wechat_webhook || '';
        
        document.getElementById('push_on_waiting').checked = !!data.push_on_waiting;
        document.getElementById('push_on_completed').checked = !!data.push_on_completed;
        document.getElementById('push_on_running').checked = !!data.push_on_running;
    } catch (e) {
        console.error("无法加载本地配置:", e);
    }
}

// 保存配置
window.saveSettings = async function(e) {
    e.preventDefault();
    const tauri = getTauri();
    if (!tauri) return;
    
    const payload = {
        bark_key: document.getElementById('bark_key').value.trim(),
        feishu_webhook: document.getElementById('feishu_webhook').value.trim(),
        dingtalk_webhook: document.getElementById('dingtalk_webhook').value.trim(),
        wechat_webhook: document.getElementById('wechat_webhook').value.trim(),
        push_on_waiting: document.getElementById('push_on_waiting').checked,
        push_on_completed: document.getElementById('push_on_completed').checked,
        push_on_running: document.getElementById('push_on_running').checked,
        port: 8000
    };
    
    try {
        await tauri.core.invoke('save_config', { newConfig: payload });
        showToast("配置已成功保存");
    } catch (e) {
        showToast("保存配置失败: " + e);
    }
};

// 发送移动端消息推送网关
async function sendNotification(status, detail) {
    const tauri = getTauri();
    if (!tauri) return;
    
    const config = await tauri.core.invoke('get_config');
    const should_push = (status === 'RUNNING' && config.push_on_running) ||
                        (status === 'WAITING' && config.push_on_waiting) ||
                        (status === 'COMPLETED' && config.push_on_completed);
    
    if (!should_push) return;
    
    const status_name_map = {
        "RUNNING": "🔵 AI 正在执行任务...",
        "WAITING": "🟡 AI 正在等待您的确认！",
        "COMPLETED": "🟢 AI 任务已完成！"
    };
    
    const title = status_name_map[status] || `AI 状态变更: ${status}`;
    const dateStr = new Date().toLocaleString();
    const body = `时间: ${dateStr}\n细节: ${detail}`;
    
    // Bark 推送
    if (config.bark_key) {
        const url = `https://api.day.app/${config.bark_key}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
        fetch(url).catch(e => console.error("Bark 推送失败:", e));
    }
    // 飞书
    if (config.feishu_webhook) {
        fetch(config.feishu_webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msg_type: "post",
                content: {
                    post: {
                        zh_cn: {
                            title: title,
                            content: [[{ tag: "text", text: body }]]
                        }
                    }
                }
            })
        }).catch(e => console.error("飞书 Webhook 失败:", e));
    }
    // 钉钉
    if (config.dingtalk_webhook) {
        fetch(config.dingtalk_webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msgtype: "markdown",
                markdown: {
                    title: title,
                    text: `### ${title}\n\n${body}`
                }
            })
        }).catch(e => console.error("钉钉 Webhook 失败:", e));
    }
    // 企业微信
    if (config.wechat_webhook) {
        fetch(config.wechat_webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msgtype: "markdown",
                markdown: {
                    content: `**${title}**\n\n${body}`
                }
            })
        }).catch(e => console.error("企业微信 Webhook 失败:", e));
    }
}

// 测试通知推送
window.testNotification = async function(channel) {
    let keyVal = "";
    let payload = {};
    
    if (channel === 'bark') {
        keyVal = document.getElementById('bark_key').value.trim();
        if (!keyVal) { showToast("请先填入 Bark Key"); return; }
    } else if (channel === 'feishu') {
        keyVal = document.getElementById('feishu_webhook').value.trim();
        if (!keyVal) { showToast("请先填入飞书 Webhook"); return; }
    } else if (channel === 'dingtalk') {
        keyVal = document.getElementById('dingtalk_webhook').value.trim();
        if (!keyVal) { showToast("请先填入钉钉 Webhook"); return; }
    } else if (channel === 'wechat') {
        keyVal = document.getElementById('wechat_webhook').value.trim();
        if (!keyVal) { showToast("请先填入企业微信 Webhook"); return; }
    }
    
    showToast("正在发送测试推送...");
    
    const title = "🚨 AI 哨兵测试推送";
    const body = "这是一条来自 AI 状态哨兵的测试通知，您的推送通道配置正确！";
    
    try {
        if (channel === 'bark') {
            const url = `https://api.day.app/${keyVal}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
            await fetch(url);
        } else if (channel === 'feishu') {
            await fetch(keyVal, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msg_type: "post",
                    content: {
                        post: {
                            zh_cn: {
                                title: title,
                                content: [[{ tag: "text", text: body }]]
                            }
                        }
                    }
                })
            });
        } else if (channel === 'dingtalk') {
            await fetch(keyVal, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: "markdown",
                    markdown: {
                        title: title,
                        text: `### ${title}\n\n${body}`
                    }
                })
            });
        } else if (channel === 'wechat') {
            await fetch(keyVal, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: "markdown",
                    markdown: {
                        content: `**${title}**\n\n${body}`
                    }
                })
            });
        }
        showToast("测试推送已成功发出");
    } catch (e) {
        showToast("发送推送失败，请检查网络和地址");
    }
};

// 状态变更的核心更新处理
function handleStateChange(data) {
    // 更新会话 ID
    document.getElementById('session-id').innerText = data.conversation_id || '暂无活跃会话';
    
    const status = data.status;
    const lastTool = data.last_tool || '无';
    const lastUpdate = data.last_update || '--:--:--';
    
    // 更新元数据
    document.getElementById('last-tool').innerText = lastTool;
    document.getElementById('last-update').innerText = lastUpdate;
    
    if (status !== lastStatus) {
        updateStatusUI(status, data);
        
        if (!isFirstLoad) {
            // 本地响铃
            playSynthesizedSound(status.toLowerCase());
            
            // TTS 播报
            let speechText = "";
            if (status === 'RUNNING') speechText = "AI 开始执行。";
            if (status === 'WAITING') speechText = "AI 正在等待确认！";
            if (status === 'COMPLETED') speechText = "AI 任务执行完毕。";
            speakStatus(speechText);
            
            // 异步触发云端推送
            const detailMsg = data.events && data.events.length > 0 ? data.events[0].detail : "";
            sendNotification(status, detailMsg);
        }
        
        lastStatus = status;
        isFirstLoad = false;
    }
    
    renderTimeline(data.events);
}

// 改变状态界面配色
function updateStatusUI(status, data) {
    const ring = document.getElementById('status-ring');
    const display = document.getElementById('status-display');
    const iconContainer = document.getElementById('status-icon');
    const title = document.getElementById('status-title');
    const desc = document.getElementById('status-desc');
    const logo = document.querySelector('.brand-logo');
    
    ring.className = 'status-ring';
    display.className = 'status-display';
    logo.classList.remove('animating');
    
    if (status === 'RUNNING') {
        ring.classList.add('ring-running');
        display.classList.add('state-running');
        iconContainer.innerHTML = ICONS.RUNNING;
        title.innerText = '执行中';
        desc.innerText = 'AI 正在全力干活，请稍候...';
        logo.classList.add('animating');
    } else if (status === 'WAITING') {
        ring.classList.add('ring-waiting');
        display.classList.add('state-waiting');
        iconContainer.innerHTML = ICONS.WAITING;
        title.innerText = '等待确认';
        desc.innerText = 'AI 遇到了敏感指令，正在等待您的允许确认！';
    } else if (status === 'COMPLETED') {
        ring.classList.add('ring-completed');
        display.classList.add('state-completed');
        iconContainer.innerHTML = ICONS.COMPLETED;
        title.innerText = '任务完成';
        desc.innerText = '本轮执行已顺利结束，可继续下发任务。';
    }
    
    if (data.events && data.events.length > 0) {
        desc.innerText = data.events[0].detail;
    }
}

// 渲染历史事件列表
function renderTimeline(events) {
    const container = document.getElementById('events-timeline');
    if (!events || events.length === 0) {
        container.innerHTML = '<div class="timeline-empty">暂无状态变更记录，等待监听中...</div>';
        return;
    }
    
    let html = '';
    events.forEach(evt => {
        let typeClass = 'item-completed';
        let iconSvg = ICONS.COMPLETED;
        let title = '任务完成';
        
        if (evt.to === 'RUNNING') {
            typeClass = 'item-running';
            iconSvg = ICONS.RUNNING;
            title = '开始执行';
        } else if (evt.to === 'WAITING') {
            typeClass = 'item-waiting';
            iconSvg = ICONS.WAITING;
            title = '等待确认';
        }
        
        html += `
            <div class="timeline-item ${typeClass}">
                <div class="item-icon">${iconSvg}</div>
                <div class="item-content">
                    <div class="item-header">
                        <span class="item-title">${title}</span>
                        <span class="item-time">${evt.time}</span>
                    </div>
                    <div class="item-detail">${evt.detail}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 绑定与初始化加载
window.addEventListener('DOMContentLoaded', async () => {
    // 声音和语音开关本地存储获取
    if (localStorage.getItem('sound-enabled') !== null) {
        document.getElementById('sound-toggle').checked = localStorage.getItem('sound-enabled') === 'true';
    }
    if (localStorage.getItem('tts-enabled') !== null) {
        document.getElementById('tts-toggle').checked = localStorage.getItem('tts-enabled') === 'true';
    }
    if (localStorage.getItem('alert-volume') !== null) {
        const val = localStorage.getItem('alert-volume');
        document.getElementById('volume-slider').value = val;
        document.getElementById('volume-val').innerText = val + '%';
    }
    
    document.getElementById('sound-toggle').addEventListener('change', (e) => {
        localStorage.setItem('sound-enabled', e.target.checked);
        if (e.target.checked) initAudio();
    });
    
    document.getElementById('tts-toggle').addEventListener('change', (e) => {
        localStorage.setItem('tts-enabled', e.target.checked);
        if (e.target.checked) {
            initAudio();
            speakStatus("语音播报功能已开启");
        }
    });
    
    document.getElementById('volume-slider').addEventListener('input', (e) => {
        document.getElementById('volume-val').innerText = e.target.value + '%';
        localStorage.setItem('alert-volume', e.target.value);
    });
    
    // 初始化配置加载
    await loadSettings();
    
    const tauri = getTauri();
    if (tauri) {
        // 1. 获取初始状态
        try {
            const currentData = await tauri.core.invoke('get_status');
            handleStateChange(currentData);
        } catch (e) {
            console.error("获取初始状态失败:", e);
        }
        
        // 2. 注册监听 Rust 后端状态推送事件
        try {
            await tauri.event.listen('status-changed', (event) => {
                handleStateChange(event.payload);
            });
            console.log("成功注册 Tauri 状态监听器");
        } catch (e) {
            console.error("注册 Tauri 状态监听失败:", e);
        }
    } else {
        document.getElementById('session-id').innerText = '未在桌面客户端中运行';
    }
});
