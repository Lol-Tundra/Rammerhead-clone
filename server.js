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
// This script is injected into HTML pages to intercept JS-driven requests (AJAX/Fetch)
// -----------------------------------------------------------------------------
const CLIENT_INJECTION = `
<script>
(function() {
    const PROXY_BASE = '/proxy?url=';
    const currentUrl = new URL(window.location.href).searchParams.get('url') || '';
    
    // Helper to encode URLs for the proxy
    function rewriteUrl(url) {
        if (!url) return url;
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#')) return url;
        if (url.startsWith('/proxy')) return url;
        
        try {
            // Resolve relative URLs against the REAL current URL, not the proxy URL
            const resolved = new URL(url, currentUrl).href;
            return PROXY_BASE + encodeURIComponent(resolved);
        } catch(e) { return url; }
    }

    // 1. Intercept standard fetch requests (used by YouTube, modern sites)
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let url = input;
        if (typeof input === 'string') {
            url = rewriteUrl(input);
        } else if (input instanceof Request) {
            // Clone the request with the new URL
            url = new Request(rewriteUrl(input.url), input);
        }
        return originalFetch(url, init);
    };

    // 2. Intercept XMLHttpRequest (used by older sites, Google)
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return originalOpen.call(this, method, rewriteUrl(url), ...args);
    };

    // 3. Intercept Form Submissions
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.action) {
            form.action = rewriteUrl(form.getAttribute('action'));
        }
    }, true);

    // 4. Force URL rewriting on History API (fixes "jumping links")
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(state, unused, url) {
        // We don't want to actually change the browser URL bar to the target site, 
        // we just want to update the internal state if needed.
        // For a proxy, we usually ignore this or rewrite it to the proxy format.
        if (url) {
            return originalPushState.call(this, state, unused, rewriteUrl(url));
        }
        return originalPushState.call(this, state, unused, url);
    };
    
    history.replaceState = function(state, unused, url) {
        if (url) {
            return originalReplaceState.call(this, state, unused, rewriteUrl(url));
        }
        return originalReplaceState.call(this, state, unused, url);
    };

})();
</script>
`;

// Helper: Rewrite URLs in static HTML/CSS content
const rewriteUrl = (url, baseUrl) => {
    try {
        if (!url) return url;
        if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('/proxy')) return url;
        const absoluteUrl = new URL(url, baseUrl).href;
        return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
    } catch (e) {
        return url;
    }
};

app.all('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL parameter is required');
    }

    try {
        const targetUrlObj = new URL(targetUrl);

        // Prepare headers to look like a real browser
        const headers = {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': req.headers['accept'] || '*/*',
            'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
            // Crucial: Forward cookies from the client to the target
            'Cookie': req.headers['cookie'] || '',
            // Spoof Referer and Origin to bypass hotlink protection
            'Referer': targetUrlObj.origin + '/',
            'Origin': targetUrlObj.origin
        };

        // Handle POST body forwarding
        const fetchOptions = {
            method: req.method,
            headers: headers,
            redirect: 'follow'
        };

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = req.body;
        }

        const response = await fetch(targetUrl, fetchOptions);

        // --- RESPONSE HANDLING ---

        // 1. Forward Cookies from Target -> Client
        // We need to rewrite the Domain/Path of cookies so the browser accepts them for our proxy domain
        const rawCookies = response.headers.raw()['set-cookie'];
        if (rawCookies) {
            const newCookies = rawCookies.map(cookie => {
                // Remove Domain/Secure/SameSite attributes to force browser to accept it on localhost/render
                return cookie.replace(/Domain=[^;]+;/i, '').replace(/Secure;/i, '').replace(/SameSite=[^;]+;/i, '');
            });
            res.setHeader('Set-Cookie', newCookies);
        }

        // 2. Filter Security Headers (CORS/Frame Blocking)
        const headersToBlock = [
            'content-encoding', 
            'content-length', 
            'x-frame-options', 
            'content-security-policy', 
            'x-content-type-options',
            'access-control-allow-origin' // We set our own
        ];

        response.headers.forEach((value, name) => {
            if (!headersToBlock.includes(name.toLowerCase())) {
                res.setHeader(name, value);
            }
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        
        const contentType = response.headers.get('content-type') || '';
        const finalUrl = response.url;

        // 3. Content Rewriting
        if (contentType.includes('text/html')) {
            let body = await response.text();

            // Inject the Client-Side Script immediately after <head>
            body = body.replace('<head>', `<head>${CLIENT_INJECTION}`);

            // Robust Regex Rewriting for attributes
            // Covers src, href, action, poster (video), data-src, srcset
            const attributeRegex = /\b(href|src|action|poster|data-src|srcset)=["']([^"']+)["']/gi;
            
            body = body.replace(attributeRegex, (match, attr, rawUrl) => {
                // Handle srcset separately as it has comma-separated URLs
                if (attr === 'srcset') {
                    return `${attr}="${rawUrl.split(',').map(part => {
                        const [u, w] = part.trim().split(/\s+/);
                        return rewriteUrl(u, finalUrl) + (w ? ` ${w}` : '');
                    }).join(', ')}"`;
                }
                return `${attr}="${rewriteUrl(rawUrl, finalUrl)}"`;
            });

            // Rewrite URL inside CSS styles in HTML
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, rawUrl) => {
                return `url(${quote}${rewriteUrl(rawUrl, finalUrl)}${quote})`;
            });

            res.send(body);

        } else if (contentType.includes('text/css')) {
            let body = await response.text();
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, rawUrl) => {
                return `url(${quote}${rewriteUrl(rawUrl, finalUrl)}${quote})`;
            });
            res.setHeader('Content-Type', 'text/css');
            res.send(body);
        } else if (contentType.includes('javascript') || contentType.includes('application/x-javascript')) {
             // We generally don't rewrite JS files via regex because it breaks code easily.
             // The CLIENT_INJECTION script handles the dynamic requests made by these JS files.
             response.body.pipe(res);
        } else {
            // Pipe binary data (Video, Images, Audio)
            response.body.pipe(res);
        }

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send(`Error fetching ${targetUrl}: ${error.message}`);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
