const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint
app.get('/proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('URL parameter is required');
    }

    try {
        // Fetch the target URL
        const response = await fetch(url, {
            headers: {
                // Mimic a real browser to avoid some bot detection
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Collect headers from the response
        const headers = {};
        response.headers.forEach((value, name) => {
            headers[name] = value;
        });

        // Remove security headers that prevent iframe embedding
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        delete headers['x-content-type-options'];

        // Write the modified headers to the response
        res.writeHead(response.status, headers);

        // Pipe the response body to the client
        response.body.pipe(res);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send(`Error fetching URL: ${error.message}`);
    }
});

// Fallback for SPA or if index.html is requested directly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Proxy server is running on port ${PORT}`);
});
