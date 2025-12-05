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
    const originalUrlParam = new URL(window.location.href).searchParams.get('url');
    // If we are in a proxy page, the origin is the target, otherwise logic might differ
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
        { tag: 'HTMLImageElement', attr: 'srcset' }, // Added srcset support
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
                // Return the original URL if scripts ask, to avoid breaking logic that checks domains
                return originalGet ? originalGet.call(this) : this.getAttribute(config.attr);
            },
            set: function(value) {
                let proxied = value;
                if (config.attr === 'srcset') {
                    // Handle srcset specially
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

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return originalOpen.call(this, method, rewriteUrl(url), ...args);
    };

    // Workers for games
    const OriginalWorker = window.Worker;
    window.Worker = function(scriptURL, options) {
        return new OriginalWorker(rewriteUrl(scriptURL), options);
    };
    
    // Image Constructor (for preloading)
    const OriginalImage = window.Image;
    window.Image = function(width, height) {
        const img = new OriginalImage(width, height);
        // We define a setter on this specific instance to trap .src assignment
        let internalSrc = '';
        Object.defineProperty(img, 'src', {
            get: () => internalSrc,
            set: (val) => {
                internalSrc = val;
                img.setAttribute('src', rewriteUrl(val));
            }
        });
        return img;
    };

    // Prevent frame busting (sites trying to break out of iframe)
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
        const targetUrlObj = new URL(targetUrl);

        // Forward headers
        const headers = {};
        const headersToForward = ['user-agent', 'accept', 'accept-language', 'cookie', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'upgrade-insecure-requests'];
        
        headersToForward.forEach(h => {
            if (req.headers[h]) headers[h] = req.headers[h];
        });

        // Add Range header support (Critical for video)
        if (req.headers.range) {
            headers['range'] = req.headers.range;
        }

        // Spoof Referer/Origin
        headers['Referer'] = targetUrlObj.origin + '/';
        headers['Origin'] = targetUrlObj.origin;

        const fetchOptions = {
            method: req.method,
            headers: headers,
            redirect: 'manual' // Manual redirect handling is CRITICAL for proxying
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = req.body;
        }

        const response = await fetch(targetUrl, fetchOptions);
        
        // Handle Redirects Manually
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
            const location = response.headers.get('location');
            const absoluteLocation = new URL(location, targetUrl).href;
            const proxyPath = `/proxy?url=${encodeURIComponent(absoluteLocation)}`;
            
            res.setHeader('Location', proxyPath);
            res.status(response.status);
            res.end();
            return;
        }

        const finalUrl = response.url;

        // Forward Response Headers
        response.headers.forEach((value, name) => {
            const n = name.toLowerCase();
            // Strip restrictive headers
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'x-content-type-options'].includes(n)) {
                
                // Rewrite Set-Cookie
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
        
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        // Status
        res.status(response.status);

        const contentType = response.headers.get('content-type') || '';

        // ---------------------------------------------------------------------
        // CONTENT REWRITING
        // ---------------------------------------------------------------------

        if (contentType.includes('text/html')) {
            let body = await response.text();

            // Remove Integrity (SRI)
            body = body.replace(/integrity="[^"]*"/gi, '');
            
            // Remove CSP Meta tags
            body = body.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

            // Inject Script
            body = body.replace('<head>', `<head>${CLIENT_INJECTION}`);

            // HTML Attributes
            body = body.replace(/\b(href|src|action|poster|data-src)=["']([^"']+)["']/gi, (match, attr, url) => {
                return `${attr}="${rewriteUrlRegex(url, finalUrl)}"`;
            });

            // CSS url()
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, url) => {
                return `url(${quote}${rewriteUrlRegex(url, finalUrl)}${quote})`;
            });

            // Srcset
            body = body.replace(/srcset=["']([^"']+)["']/gi, (match, srcsetContent) => {
                const newSrcset = srcsetContent.split(',').map(part => {
                    const [url, desc] = part.trim().split(/\s+/);
                    return rewriteUrlRegex(url, finalUrl) + (desc ? ` ${desc}` : '');
                }).join(', ');
                return `srcset="${newSrcset}"`;
            });

            res.send(body);

        } else if (contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) {
            // HLS Video Support (.m3u8)
            let body = await response.text();
            // Rewrite lines that are URLs (not starting with #)
            const lines = body.split('\n');
            const newBody = lines.map(line => {
                if (line.trim() && !line.trim().startsWith('#')) {
                    return rewriteUrlRegex(line.trim(), finalUrl);
                }
                return line;
            }).join('\n');
            res.send(newBody);

        } else if (contentType.includes('text/css')) {
            let body = await response.text();
            body = body.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, url) => {
                return `url(${quote}${rewriteUrlRegex(url, finalUrl)}${quote})`;
            });
            res.send(body);

        } else {
            // Binary (Images, Video, Flash, etc.)
            // Pipe directly. The status code (200 or 206) is already set above.
            response.body.pipe(res);
        }

    } catch (error) {
        console.error('Proxy Error:', error);
        // Only send error if headers haven't been sent
        if (!res.headersSent) {
            res.status(500).send('Error processing request: ' + error.message);
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
