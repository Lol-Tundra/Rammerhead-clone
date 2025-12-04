const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and serve static files
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to rewrite URLs to point back to our proxy
const rewriteUrl = (url, baseUrl) => {
    try {
        if (!url) return url;
        // Skip data URIs, anchors, and links that are already proxied
        if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('/proxy')) return url;
        
        // Resolve absolute URL based on the current page's URL
        const absoluteUrl = new URL(url, baseUrl).href;
        
        // Return the proxied version
        return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
    } catch (e) {
        return url;
    }
};

app.get('/proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('URL parameter is required');
    }

    try {
        // 1. Fetch the target URL
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                // Set referer to target origin to bypass some hotlink protections
                'Referer': new URL(url).origin
            },
            redirect: 'follow'
        });

        // 2. Filter headers
        const headersToBlock = [
            'content-encoding', 
            'content-length', 
            'transfer-encoding', 
            'x-frame-options', 
            'content-security-policy', 
            'x-content-type-options'
        ];
        
        response.headers.forEach((value, name) => {
            if (!headersToBlock.includes(name.toLowerCase())) {
                res.setHeader(name, value);
            }
        });

        // Allow CORS for the iframe
        res.setHeader('Access-Control-Allow-Origin', '*');

        const contentType = response.headers.get('content-type') || '';
        const finalUrl = response.url; // The final URL after any redirects

        // 3. Handle Content Rewriting
        if (contentType.includes('text/html')) {
            let body = await response.text();

            // Rewrite HTML attributes: href, src, action
            body = body.replace(/(href|src|action)=["']([^"']+)["']/gi, (match, attr, rawUrl) => {
                return `${attr}="${rewriteUrl(rawUrl, finalUrl)}"`;
            });

            // Rewrite CSS within HTML (style tags or inline styles)
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, rawUrl) => {
                return `url(${quote}${rewriteUrl(rawUrl, finalUrl)}${quote})`;
            });
            
            // Optional: Inject a script to catch some dynamic fetch/xhr requests (advanced)
            // For now, simple rewriting covers most static sites.

            res.send(body);

        } else if (contentType.includes('text/css')) {
            let body = await response.text();
            
            // Rewrite CSS url(...) imports
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, rawUrl) => {
                return `url(${quote}${rewriteUrl(rawUrl, finalUrl)}${quote})`;
            });

            res.send(body);

        } else {
            // Stream binary data (images, videos, etc.) directly
            response.body.pipe(res);
        }

    } catch (error) {
        console.error('Proxy Error:', error.message);
        // Return a simple HTML error page so the user sees something in the iframe
        res.status(500).send(`
            <div style="color: #ff5555; font-family: sans-serif; padding: 20px; text-align: center;">
                <h2>Proxy Error</h2>
                <p>Could not fetch: ${url}</p>
                <p>${error.message}</p>
            </div>
        `);
    }
});

// Fallback for serving index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Proxy server is running on port ${PORT}`);
});
