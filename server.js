// server.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. Serving the Frontend ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 2. Simple Reverse Proxy Logic ---
app.use('/proxy', (req, res, next) => {
    const targetUrl = req.originalUrl.substring('/proxy/'.length);

    if (!targetUrl.startsWith('http')) {
        return res.status(400).send('Invalid target URL provided in the path.');
    }

    const proxyOptions = {
        target: targetUrl,
        changeOrigin: true,
        logLevel: 'debug', 
        pathRewrite: {
            '^/proxy/': '/', 
        },
        // --- CRUCIAL: Header Stripping for iframe compatibility ---
        onProxyRes: function (proxyRes, req, res) {
            // Remove or modify headers that prevent framing/embedding
            if (proxyRes.headers['x-frame-options']) {
                delete proxyRes.headers['x-frame-options'];
            }
            if (proxyRes.headers['content-security-policy']) {
                delete proxyRes.headers['content-security-policy'];
            }
        }
        // --------------------------------------------------------
    };

    createProxyMiddleware(proxyOptions)(req, res, next);
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
});
