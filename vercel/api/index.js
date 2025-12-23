const express = require('express');
const request = require('request');

const BACKEND_API_MAP = {
  "grok": "https://api.x.ai",
  "claude": "https://api.anthropic.com",
  "openai": "https://api.openai.com",
  "chatgpt": "https://chatgpt.com",
  "gemini": "https://generativelanguage.googleapis.com",
};

const app = express();

// 使用 raw body 以支持任意 content-type
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// 需要过滤的请求头（这些由代理或网关自动生成，不应转发）
const EXCLUDED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'http2-settings',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'x-vercel-id',
  'x-vercel-deployment-url',
  'x-vercel-forwarded-for',
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'forwarded',
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cf-ipcountry',
  'cdn-loop',
  'true-client-ip'
]);

// 需要过滤的响应头
const EXCLUDED_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-encoding' // 让浏览器/客户端处理压缩
]);

app.all('/v1/:model/*', (req, res) => {
  try {
    const model = req.params.model.toLowerCase();
    const extraPath = req.params[0] || '';
    const baseBackendUrl = BACKEND_API_MAP[model];
    
    if (!baseBackendUrl) {
      return res.status(404).send(`Unsupported model: ${model}`);
    }

    // 构建后端 URL，包含 query 参数
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const backendUrl = `${baseBackendUrl}/${extraPath}`.replace(/\/+$/, '') + queryString;
    
    // 透传所有请求头（除了需要过滤的）
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!EXCLUDED_REQUEST_HEADERS.has(key.toLowerCase())) {
        headers[key] = value;
      }
    }
    
    const requestOptions = {
      url: backendUrl,
      method: req.method,
      headers: headers,
      followRedirect: true,
      timeout: 300000, // 5 分钟超时，支持长时间运行的请求
      encoding: null   // 保持原始 binary 数据
    };

    // 如果有 body，直接传递原始数据
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length > 0) {
      requestOptions.body = req.body;
    }

    // 创建请求并直接 pipe
    const backendRequest = request(requestOptions);

    // 处理响应
    backendRequest
      .on('response', (backendResponse) => {
        // 设置状态码
        res.status(backendResponse.statusCode);
        
        // 透传所有响应头（除了需要过滤的）
        Object.keys(backendResponse.headers).forEach(key => {
          if (!EXCLUDED_RESPONSE_HEADERS.has(key.toLowerCase())) {
            res.setHeader(key, backendResponse.headers[key]);
          }
        });
      })
      .on('error', (err) => {
        console.error('Request error:', {
          message: err.message,
          code: err.code,
          url: backendUrl
        });
        if (!res.headersSent) {
          res.status(502).send({
            error: 'Backend Connection Error',
            message: err.message,
            code: err.code
          });
        }
      })
      .pipe(res); // 直接 pipe 原始响应数据

  } catch (error) {
    console.error('Proxy error:', {
      message: error.message,
      stack: error.stack,
      url: req.url
    });
    if (!res.headersSent) {
      res.status(500).send({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }
});

app.all('*', (req, res) => {
  res.status(400).send('Invalid URL format. Expected: /v1/{model}');
});

// 导出 Vercel 处理函数
module.exports = app;
