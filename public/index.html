const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse raw body for POST requests
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// -----------------------------------------------------------------------------
// CLIENT-SIDE INJECTION SCRIPT
// -----------------------------------------------------------------------------
const CLIENT_INJECTION = `
<script>
(function() {
    const PROXY_BASE = '/proxy?url=';
    const originalUrl = new URL(window.location.href).searchParams.get('url');
    const currentOrigin = originalUrl ? new URL(originalUrl).origin : window.location.origin;

    // Helper: Rewrite URL to go through proxy
    function rewriteUrl(url) {
        if (!url) return url;
        if (typeof url !== 'string') return url;
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return url;
        if (url.startsWith(window.location.origin + '/proxy')) return url;
        
        // If it's already a full URL
        if (url.startsWith('http')) {
             return PROXY_BASE + encodeURIComponent(url);
        }
        
        // Resolve relative URL
        try {
            const resolved = new URL(url, originalUrl || window.location.href).href;
            return PROXY_BASE + encodeURIComponent(resolved);
        } catch(e) { return url; }
    }

    // --- 1. PROPERTY INTERCEPTORS (The Magic) ---
    // This traps any JS trying to set .src or .href and rewrites it instantly
    
    const elementConfig = [
        { tag: 'HTMLAnchorElement', attr: 'href' },
        { tag: 'HTMLImageElement', attr: 'src' },
        { tag: 'HTMLScriptElement', attr: 'src' },
        { tag: 'HTMLLinkElement', attr: 'href' },
        { tag: 'HTMLIFrameElement', attr: 'src' },
        { tag: 'HTMLMediaElement', attr: 'src' }, // Video & Audio
        { tag: 'HTMLSourceElement', attr: 'src' },
        { tag: 'HTMLFormElement', attr: 'action' }
    ];

    elementConfig.forEach(config => {
        const proto = window[config.tag] && window[config.tag].prototype;
        if (!proto) return;

        const descriptor = Object.getOwnPropertyDescriptor(proto, config.attr);
        // Save original setter to call later
        const originalSet = descriptor ? descriptor.set : null;
        const originalGet = descriptor ? descriptor.get : null;

        Object.defineProperty(proto, config.attr, {
            get: function() {
                // Optional: Return original URL to trick scripts checking for validity
                return originalGet ? originalGet.call(this) : this.getAttribute(config.attr);
            },
            set: function(value) {
                const proxied = rewriteUrl(value);
                if (originalSet) {
                    originalSet.call(this, proxied);
                } else {
                    this.setAttribute(config.attr, proxied);
                }
            }
        });
    });

    // --- 2. NATIVE API INTERCEPTORS ---

    // Fetch
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let url = input;
        if (typeof input === 'string') {
            url = rewriteUrl(input);
        } else if (input instanceof Request) {
            url = new Request(rewriteUrl(input.url), input);
        }
        return originalFetch(url, init);
    };

    // XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return originalOpen.call(this, method, rewriteUrl(url), ...args);
    };

    // Workers (Poki / Games use this heavily)
    const OriginalWorker = window.Worker;
    window.Worker = function(scriptURL, options) {
        return new OriginalWorker(rewriteUrl(scriptURL), options);
    };

    // Window.open
    const originalWindowOpen = window.open;
    window.open = function(url, target, features) {
        return originalWindowOpen(rewriteUrl(url), target, features);
    };

    // History API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    // We mock these to prevent the URL bar from showing the long proxy URL, 
    // but internally we keep track of state.
    history.pushState = function(state, title, url) {
        // console.log('PushState blocked/rewritten', url);
        // We can just ignore visual URL updates or rewrite them safely
        return originalPushState.call(this, state, title, null);
    };
    history.replaceState = function(state, title, url) {
        return originalReplaceState.call(this, state, title, null);
    };

})();
</script>
`;

// Helper: Rewrites URLs in HTML/CSS text
const rewriteUrlRegex = (url, baseUrl) => {
    try {
        if (!url || url.trim() === '') return url;
        if (url.startsWith('data:') || url.startsWith('#')) return url;
        
        const absoluteUrl = new URL(url, baseUrl).href;
        return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
    } catch (e) {
        return url;
    }
};

app.all('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL required');

    try {
        const targetUrlObj = new URL(targetUrl);

        // Forward headers
        const headers = {};
        const headersToForward = ['user-agent', 'accept', 'accept-language', 'cookie', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'upgrade-insecure-requests'];
        
        headersToForward.forEach(h => {
            if (req.headers[h]) headers[h] = req.headers[h];
        });

        // Spoof Referer/Origin
        headers['Referer'] = targetUrlObj.origin + '/';
        headers['Origin'] = targetUrlObj.origin;

        const fetchOptions = {
            method: req.method,
            headers: headers,
            redirect: 'follow'
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = req.body;
        }

        const response = await fetch(targetUrl, fetchOptions);
        const finalUrl = response.url;

        // Forward Response Headers
        response.headers.forEach((value, name) => {
            const n = name.toLowerCase();
            // Strip restrictive headers
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'x-content-type-options'].includes(n)) {
                // Rewrite Set-Cookie domains
                if (n === 'set-cookie') {
                    const cookies = response.headers.raw()['set-cookie'].map(c => 
                        c.replace(/Domain=[^;]+;/i, '').replace(/Secure;/i, '').replace(/SameSite=[^;]+;/i, '')
                    );
                    res.setHeader('Set-Cookie', cookies);
                } else {
                    res.setHeader(name, value);
                }
            }
        });
        
        // CORS for everyone
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/html')) {
            let body = await response.text();

            // 1. Remove Integrity attributes (SRI) - causes blocks if we modify content
            body = body.replace(/integrity="[^"]*"/gi, '');

            // 2. Inject Script
            body = body.replace('<head>', `<head>${CLIENT_INJECTION}`);

            // 3. Rewrite HTML attributes
            // Using a broader regex to catch href, src, action, data-src, poster
            body = body.replace(/\b(href|src|action|poster|data-src)=["']([^"']+)["']/gi, (match, attr, url) => {
                return `${attr}="${rewriteUrlRegex(url, finalUrl)}"`;
            });

            // 4. Rewrite CSS url()
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, url) => {
                return `url(${quote}${rewriteUrlRegex(url, finalUrl)}${quote})`;
            });

            // 5. Rewrite srcset (images)
            body = body.replace(/srcset=["']([^"']+)["']/gi, (match, srcsetContent) => {
                const newSrcset = srcsetContent.split(',').map(part => {
                    const [url, desc] = part.trim().split(/\s+/);
                    return rewriteUrlRegex(url, finalUrl) + (desc ? ` ${desc}` : '');
                }).join(', ');
                return `srcset="${newSrcset}"`;
            });

            res.send(body);

        } else if (contentType.includes('text/css')) {
            let body = await response.text();
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, url) => {
                return `url(${quote}${rewriteUrlRegex(url, finalUrl)}${quote})`;
            });
            res.send(body);

        } else if (contentType.includes('javascript') || contentType.includes('application/x-javascript')) {
             // For JS, we just pipe it. 
             // We generally DO NOT want to regex replace inside JS files as it often breaks syntax.
             // Our CLIENT_INJECTION handles the dynamic loading at runtime.
             response.body.pipe(res);
        } else {
            // Binary (Images, Video, etc.)
            response.body.pipe(res);
        }

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).send('Error');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
