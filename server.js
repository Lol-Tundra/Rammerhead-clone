const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend files (index.html)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
    }

    try {
        const response = await fetch(targetUrl);

        const headers = {};
        response.headers.forEach((value, key) => {
            const lower = key.toLowerCase();

            if (lower === 'x-frame-options') return;

            if (lower === 'content-security-policy') {
                const newCsp = value
                    .split(';')
                    .filter(d => !d.trim().startsWith('frame-ancestors'))
                    .join(';');

                if (newCsp.trim()) headers[key] = newCsp;
                return;
            }

            headers[key] = value;
        });

        const body = await response.text();

        Object.entries(headers).forEach(([key, val]) => {
            res.setHeader(key, val);
        });

        res.send(body);

    } catch (err) {
        res.status(500).send('Error fetching target URL.');
    }
});

app.listen(PORT, () => {
    console.log(`Proxy running on port ${PORT}`);
});
