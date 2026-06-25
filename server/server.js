import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// 静态文件服务：托管手机端的 PWA 网页
const mobileAppPath = path.join(__dirname, '../mobile-app');
app.use(express.static(mobileAppPath));

// VAPID 密钥管理（自动持久化生成，无需手动配置）
let vapidKeys;
const keysPath = path.join(__dirname, 'keys.json');

if (fs.existsSync(keysPath)) {
    try {
        vapidKeys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    } catch (e) {
        console.error("解析 keys.json 失败，正在重新生成", e);
    }
}

if (!vapidKeys) {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(keysPath, JSON.stringify(vapidKeys, null, 2), 'utf8');
    console.log("已生成全新的 VAPID 推送密钥并保存至 keys.json");
}

webpush.setVapidDetails(
    'mailto:canary@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// 订阅列表管理（持久化到本地文件）
let subscriptions = [];
const subscriptionsPath = path.join(__dirname, 'subscriptions.json');

if (fs.existsSync(subscriptionsPath)) {
    try {
        subscriptions = JSON.parse(fs.readFileSync(subscriptionsPath, 'utf8'));
    } catch (e) {
        subscriptions = [];
    }
}

function saveSubscriptions() {
    try {
        fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2), 'utf8');
    } catch (e) {
        console.error("保存订阅列表失败:", e);
    }
}

// 全局缓存最新的状态，便于手机端首次载入时拉取展示
let lastStatus = { status: "COMPLETED", last_tool: "无", detail: "AI 状态哨兵已就绪" };

// 接口 1: 获取 VAPID 公钥
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

// 获取当前最新状态
app.get('/api/status', (req, res) => {
    res.json(lastStatus);
});

// 接口 2: 手机端注册推送订阅
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: "无效的订阅信息" });
    }
    
    // 避免重复订阅
    const exists = subscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
        subscriptions.push(subscription);
        saveSubscriptions();
        console.log(`[新订阅] 已注册手机终端。当前总终端数: ${subscriptions.length}`);
    }
    
    res.status(201).json({ success: true });
});

// 接口 3: 电脑客户端推送状态变更通知
app.post('/api/notify', (req, res) => {
    const notificationPayload = req.body; // { status, last_tool, detail }
    console.log(`[收到状态变更]`, notificationPayload);
    
    // 更新全局缓存状态
    lastStatus = notificationPayload;
    
    const payloadString = JSON.stringify(notificationPayload);
    
    const promises = subscriptions.map(sub => {
        return webpush.sendNotification(sub, payloadString)
            .then(() => null)
            .catch(err => {
                console.error(`向终端发送推送失败: ${sub.endpoint.substring(0, 40)}... 错误代码: ${err.statusCode}`);
                // 404 (Not Found) 或 410 (Gone) 代表推送凭证已过期，需要清理
                if (err.statusCode === 410 || err.statusCode === 404) {
                    return sub.endpoint;
                }
                return null;
            });
    });
    
    Promise.all(promises).then(results => {
        const expiredEndpoints = results.filter(endpoint => endpoint !== null);
        if (expiredEndpoints.length > 0) {
            subscriptions = subscriptions.filter(sub => !expiredEndpoints.includes(sub.endpoint));
            saveSubscriptions();
            console.log(`[清理过期凭证] 已清理 ${expiredEndpoints.length} 个失效的推送终端。剩余总终端数: ${subscriptions.length}`);
        }
        res.status(200).json({ success: true, sent: promises.length - expiredEndpoints.length });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(` AI Status Canary 云端中转服务器已启动!`);
    console.log(` 访问地址: http://localhost:${PORT}`);
    console.log(` 局域网接入(手机扫描): http://<您的电脑局域网IP>:${PORT}`);
    console.log(`===============================================`);
});
