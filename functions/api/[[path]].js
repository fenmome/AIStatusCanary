import webpush from 'web-push';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 1. 获取或生成 VAPID Keys (在 Pages Function 里直接绑定和操作 KV)
  let vapidKeys = await env.CANARY_KV.get('vapid_keys', 'json');
  if (!vapidKeys) {
    vapidKeys = webpush.generateVAPIDKeys();
    await env.CANARY_KV.put('vapid_keys', JSON.stringify(vapidKeys));
  }

  webpush.setVapidDetails(
    'mailto:canary@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  // 路由 1: 获取公钥
  if (url.pathname === '/api/vapid-public-key' && request.method === 'GET') {
    return new Response(JSON.stringify({ publicKey: vapidKeys.publicKey }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 路由 2: 获取当前状态
  if (url.pathname === '/api/status' && request.method === 'GET') {
    const lastStatus = await env.CANARY_KV.get('last_status', 'json') || {
      status: "COMPLETED", last_tool: "无", detail: "AI 状态哨兵已就绪"
    };
    return new Response(JSON.stringify(lastStatus), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 路由 3: 手机端注册推送订阅
  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    const subscription = await request.json();
    if (!subscription || !subscription.endpoint) {
      return new Response(JSON.stringify({ error: "无效的订阅" }), {
        status: 400, headers: corsHeaders
      });
    }
    
    let subscriptions = await env.CANARY_KV.get('subscriptions', 'json') || [];
    const exists = subscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
      subscriptions.push(subscription);
      await env.CANARY_KV.put('subscriptions', JSON.stringify(subscriptions));
    }
    
    return new Response(JSON.stringify({ success: true }), {
      status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 路由 4: 电脑客户端推送状态变更通知
  if (url.pathname === '/api/notify' && request.method === 'POST') {
    const payload = await request.json();
    await env.CANARY_KV.put('last_status', JSON.stringify(payload));
    
    let subscriptions = await env.CANARY_KV.get('subscriptions', 'json') || [];
    const payloadString = JSON.stringify(payload);
    
    let expiredEndpoints = [];
    const promises = subscriptions.map(sub => {
      return webpush.sendNotification(sub, payloadString)
        .then(() => null)
        .catch(err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            expiredEndpoints.push(sub.endpoint);
          }
          return null;
        });
    });
    
    await Promise.all(promises);
    
    if (expiredEndpoints.length > 0) {
      subscriptions = subscriptions.filter(sub => !expiredEndpoints.includes(sub.endpoint));
      await env.CANARY_KV.put('subscriptions', JSON.stringify(subscriptions));
    }
    
    return new Response(JSON.stringify({ success: true, sent: promises.length - expiredEndpoints.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}
