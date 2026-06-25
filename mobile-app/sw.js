// Service Worker for AI Status Canary PWA

self.addEventListener('push', event => {
    let data = { status: 'RUNNING', last_tool: 'System', detail: 'AI 状态更新' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            console.error("解析推送数据失败，使用默认值", e);
        }
    }
    
    const title = `AI 状态哨兵: ${data.status}`;
    const options = {
        body: `[${data.last_tool}] ${data.detail}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'ai-status-alert',
        renotify: true,
        vibrate: [200, 100, 200],
        data: {
            url: self.location.origin
        }
    };
    
    // 如果是 WAITING，设置较强的震动和提示
    if (data.status === 'WAITING') {
        options.requireInteraction = true; // 保持通知常驻，直到用户点击
        options.vibrate = [500, 110, 500, 110, 450, 110, 200, 110, 200];
    }
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // 如果已经打开了 App，直接聚焦
            for (const client of clientList) {
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // 否则新开一个窗口打开
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});
