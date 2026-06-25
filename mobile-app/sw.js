// Service Worker for AI Status Canary PWA

// 异步从 IndexedDB 读取震动配置
function readVibratePrefFromDB() {
    return new Promise((resolve) => {
        const DB_NAME = "canary_pref_db";
        const STORE_NAME = "preferences";
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onsuccess = (e) => {
            const db = e.target.result;
            try {
                const tx = db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req = store.get("vibrate");
                req.onsuccess = () => resolve(req.result || "long");
                req.onerror = () => resolve("long");
            } catch (err) {
                resolve("long");
            }
        };
        request.onerror = () => resolve("long");
    });
}

// 依据用户偏好选择具体的震动序列
function getVibratePattern(status, pref) {
    if (pref === 'none') {
        return [];
    }
    if (pref === 'triple') {
        return [120, 80, 120, 80, 120];
    }
    // 默认 long 逻辑
    if (status === 'WAITING') {
        return [500, 110, 500, 110, 450, 110, 200, 110, 200];
    } else {
        return [200, 100, 200];
    }
}

self.addEventListener('push', event => {
    event.waitUntil(
        readVibratePrefFromDB().then(vibratePref => {
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
                vibrate: getVibratePattern(data.status, vibratePref),
                data: {
                    url: self.location.origin
                }
            };
            
            if (data.status === 'WAITING') {
                options.requireInteraction = true;
            }
            
            return self.registration.showNotification(title, options);
        })
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
