// server.js

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
// Render sets the PORT env variable; we fall back to 3000 for local testing
const PORT = process.env.PORT || 3000;

// --- 1. Serving the Frontend ---
// Assumes index.html is inside a 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 2. Fixed Reverse Proxy Logic ---

// This route catches all requests starting with /proxy/ followed by anything (the URL)
app.use('/proxy/:targetUrl*', (req, res, next) => {
    // 1. Get the full target URL string from the path parameters
    // req.params.targetUrl gets the first segment (e.g., "https://google.com")
    // req.params[0] gets everything else (e.g., "/search?q=test")
    let target = req.params.targetUrl + req.params[0]; 

    // 2. Ensure it starts with http(s) (should already be done by frontend, but good safeguard)
    if (!target.startsWith('http')) {
        target = 'https://' + target;
    }
    
    // Create the proxy middleware dynamically for this specific request
    const proxy = createProxyMiddleware({
        target: target, 
        changeOrigin: true, // Needed for many hosts to work correctly
        logLevel: 'info', 
        
        // CRITICAL FIX: We must strip the entire proxy path (including the target URL)
        // so the path sent to the actual target host is correct (e.g., just / or /page)
        pathRewrite: (path, req) => {
            // path is like "/proxy/https://google.com/search?q=hello"
            // We want the result to be just "/search?q=hello"
            const prefix = `/proxy/${req.params.targetUrl}`;
            return path.substring(prefix.length);
        },

        // Header Stripping for iframe compatibility
        onProxyRes: function (proxyRes, req, res) {
            // Remove headers that prevent sites from being framed
            if (proxyRes.headers['x-frame-options']) {
                delete proxyRes.headers['x-frame-options'];
            }
            if (proxyRes.headers['content-security-policy']) {
                delete proxyRes.headers['content-security-policy'];
            }
        },
        
        // This is necessary to avoid "Protocol not found" errors when redirecting
        router: (req) => {
            return target;
        }
    });

    // Apply the dynamically created proxy to the current request
    proxy(req, res, next);
});


// --- Server Start ---
app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
});
