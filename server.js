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
app.use(express.raw({ type: '*/*', limit: '20mb' }));

// -----------------------------------------------------------------------------
// CLIENT-SIDE INJECTION SCRIPT
// -----------------------------------------------------------------------------
const CLIENT_INJECTION = `
<script>
(function() {
    const PROXY_BASE = '/proxy?url=';
    // Attempt to determine the 'real' current URL being proxied
    const originalUrlParam = new URL(window.location.href).searchParams.get('url');
    const currentOrigin = originalUrlParam ? new URL(originalUrlParam).origin : window.location.origin;

    // Helper: Rewrite URL to go through proxy
    function rewriteUrl(url) {
        if (!url) return url;
        if (typeof url !== 'string') return url;
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:') || url.startsWith('javascript:')) return url;
        if (url.includes('/proxy?url=')) return url;
        
        // Handle absolute URLs
        if (url.startsWith('http')) {
             return PROXY_BASE + encodeURIComponent(url);
        }
        
        // Handle relative URLs
        try {
            // If we are already proxied, we need to resolve against the ORIGINAL url, not the proxy host
            const base = originalUrlParam || window.location.href;
            const resolved = new URL(url, base).href;
            return PROXY_BASE + encodeURIComponent(resolved);
        } catch(e) { return url; }
    }

    // --- 1. PROPERTY INTERCEPTORS ---
    const elementConfig = [
        { tag: 'HTMLAnchorElement', attr: 'href' },
        { tag: 'HTMLImageElement', attr: 'src' },
        { tag: 'HTMLImageElement', attr: 'srcset' },
        { tag: 'HTMLScriptElement', attr: 'src' },
        { tag: 'HTMLLinkElement', attr: 'href' },
        { tag: 'HTMLIFrameElement', attr: 'src' },
        { tag: 'HTMLMediaElement', attr: 'src' },
        { tag: 'HTMLSourceElement', attr: 'src' },
        { tag: 'HTMLFormElement', attr: 'action' }
    ];

    elementConfig.forEach(config => {
        const proto = window[config.tag] && window[config.tag].prototype;
        if (!proto) return;

        const descriptor = Object.getOwnPropertyDescriptor(proto, config.attr);
        const originalSet = descriptor ? descriptor.set : null;
        const originalGet = descriptor ? descriptor.get : null;

        Object.defineProperty(proto, config.attr, {
            get: function() {
                // Return original URL to keep scripts happy
                return originalGet ? originalGet.call(this) : this.getAttribute(config.attr);
            },
            set: function(value) {
                let proxied = value;
                if (config.attr === 'srcset') {
                    proxied = value.split(',').map(part => {
                        const [url, desc] = part.trim().split(/\s+/);
                        return rewriteUrl(url) + (desc ? ' ' + desc : '');
                    }).join(', ');
                } else {
                    proxied = rewriteUrl(value);
                }

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

    // XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return originalOpen.call(this, method, rewriteUrl(url), ...args);
    };

    // Workers
    const OriginalWorker = window.Worker;
    window.Worker = function(scriptURL, options) {
        return new OriginalWorker(rewriteUrl(scriptURL), options);
    };
    
    // History API (Fixes YouTube SPA navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(state, unused, url) {
        if (url) {
            // We don't want to actually change the browser URL bar to the target URL,
            // because that would break the proxy context.
            // But sites like YouTube rely on this to update the /watch?v=...
            // We silently ignore the URL update in the browser bar or map it to a proxy parameter?
            // For now, we rewrite it so the internal state is consistent.
            url = rewriteUrl(url);
        }
        return originalPushState.call(this, state, unused, url);
    };
    
    history.replaceState = function(state, unused, url) {
        if (url) url = rewriteUrl(url);
        return originalReplaceState.call(this, state, unused, url);
    };

    // --- 3. TAB/WINDOW MANAGEMENT ---
    
    // Intercept window.open
    window.open = function(url, target, features) {
        if (url) {
            const fullUrl = rewriteUrl(url);
            window.parent.postMessage({ type: 'PROXY_NEW_TAB', url: fullUrl }, '*');
        }
        return null;
    };

    // Intercept target="_blank"
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && (link.target === '_blank' || link.target === '_new')) {
            e.preventDefault();
            window.parent.postMessage({ type: 'PROXY_NEW_TAB', url: link.href }, '*');
        }
    }, true);

    // Prevent frame busting
    try {
        window.top = window.self;
        window.parent = window.self;
    } catch(e) {}

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
        // Validate URL
        new URL(targetUrl); 

        // Headers to forward to the target
        const headers = {};
        // We forward almost everything to look like a real browser
        const headersToForward = [
            'user-agent', 'accept', 'accept-language', 'cookie', 
            'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 
            'upgrade-insecure-requests', 'range', 'origin', 'referer'
        ];
        
        headersToForward.forEach(h => {
            if (req.headers[h]) headers[h] = req.headers[h];
        });

        // Spoof Referer/Origin if not present (helps with hotlinking protection)
        const targetOrigin = new URL(targetUrl).origin;
        if (!headers['origin']) headers['origin'] = targetOrigin;
        if (!headers['referer']) headers['referer'] = targetOrigin + '/';

        const fetchOptions = {
            method: req.method,
            headers: headers,
            redirect: 'manual', // Handle redirects manually
            compress: false // IMPORTANT: Do not let node-fetch decompress automatically for binary streams
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = req.body;
        }

        const response = await fetch(targetUrl, fetchOptions);
        
        // Handle Manual Redirects (301, 302, 303, 307, 308)
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
            const location = response.headers.get('location');
            const absoluteLocation = new URL(location, targetUrl).href;
            const proxyPath = `/proxy?url=${encodeURIComponent(absoluteLocation)}`;
            
            res.setHeader('Location', proxyPath);
            res.status(response.status);
            res.end();
            return;
        }

        // Determine if we should rewrite the body
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        
        // Rewritable types: HTML, CSS, JS, M3U8 (HLS Manifests)
        const isHtml = contentType.includes('text/html');
        const isCss = contentType.includes('text/css');
        const isJs = contentType.includes('javascript') || contentType.includes('application/x-javascript');
        const isManifest = contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl');
        
        const shouldRewrite = isHtml || isCss || isJs || isManifest;

        // --- Forward Response Headers ---
        response.headers.forEach((value, name) => {
            const n = name.toLowerCase();
            
            // Dangerous headers to always strip
            if (['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'x-content-type-options'].includes(n)) {
                return;
            }

            // Strip Content-Encoding and Content-Length ONLY if we are rewriting the body
            // If we are passing through (Video/Image), we MUST keep them for the browser to work correctly
            if (shouldRewrite && ['content-encoding', 'content-length', 'transfer-encoding'].includes(n)) {
                return;
            }

            // Rewrite Cookies to not conflict with localhost
            if (n === 'set-cookie') {
                const cookies = response.headers.raw()['set-cookie'].map(c => 
                    c.replace(/Domain=[^;]+;/i, '').replace(/Secure;/i, '').replace(/SameSite=[^;]+;/i, '')
                );
                res.setHeader('Set-Cookie', cookies);
            } else {
                res.setHeader(name, value);
            }
        });
        
        // CORS (Always allow)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        res.status(response.status);

        // --- Body Handling ---

        if (shouldRewrite) {
            // We need to read the body as text to modify it
            // Note: Since we set compress: false, we might get gzipped data if the server ignored us.
            // node-fetch usually handles this text() conversion well if encoding headers are correct.
            let body = await response.text();
            const finalUrl = response.url;

            if (isHtml) {
                // Remove SRI, CSP
                body = body.replace(/integrity="[^"]*"/gi, '');
                body = body.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
                
                // Inject Client Script
                body = body.replace('<head>', `<head>${CLIENT_INJECTION}`);

                // Rewrite HTML Attributes
                body = body.replace(/\b(href|src|action|poster|data-src)=["']([^"']+)["']/gi, (match, attr, url) => {
                    return `${attr}="${rewriteUrlRegex(url, finalUrl)}"`;
                });

                // Rewrite CSS inside HTML
                body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, url) => {
                    return `url(${quote}${rewriteUrlRegex(url, finalUrl)}${quote})`;
                });
                
                // Rewrite Srcset
                body = body.replace(/srcset=["']([^"']+)["']/gi, (match, srcsetContent) => {
                    const newSrcset = srcsetContent.split(',').map(part => {
                        const [url, desc] = part.trim().split(/\s+/);
                        return rewriteUrlRegex(url, finalUrl) + (desc ? ` ${desc}` : '');
                    }).join(', ');
                    return `srcset="${newSrcset}"`;
                });
            } else if (isManifest) {
                // HLS Manifest Rewriting
                const lines = body.split('\n');
                body = lines.map(line => {
                    if (line.trim() && !line.trim().startsWith('#')) {
                        return rewriteUrlRegex(line.trim(), finalUrl);
                    }
                    return line;
                }).join('\n');
            } else if (isCss) {
                body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, url) => {
                    return `url(${quote}${rewriteUrlRegex(url, finalUrl)}${quote})`;
                });
            }

            res.send(body);

        } else {
            // BINARY / PASSTHROUGH (Videos, Images, Files)
            // Pipe the raw stream directly.
            // Because we set compress: false, and forwarded Content-Length, the browser
            // gets the exact bytes and headers it expects for seeking and progress bars.
            response.body.pipe(res);
        }

    } catch (error) {
        console.error('Proxy Error:', error);
        if (!res.headersSent) {
            res.status(500).send('Proxy Error: ' + error.message);
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
