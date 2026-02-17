#!/usr/bin/env node

const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const url = require('url');

const CLIENT_ID = '557294086068-rcl0jp9f2vndi2raqehvegbkcq94bc4l.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPE = 'https://www.googleapis.com/auth/adwords';
const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

console.log('\n=== Google Ads OAuth Token Generator ===\n');
console.log('IMPORTANT: First add this redirect URI to your OAuth client in Google Cloud Console:');
console.log(`\n  ${REDIRECT_URI}\n`);
console.log('Go to: https://console.cloud.google.com/apis/credentials');
console.log('Click your OAuth client > Add URI > Save\n');
console.log('Press Enter when ready...');

process.stdin.once('data', () => {
  startServer();
});

function startServer() {
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/callback') {
      const code = parsedUrl.query.code;

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Success!</h1><p>You can close this window and check the terminal.</p>');

        exchangeCode(code, server);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Error</h1><p>No code received</p>');
      }
    }
  });

  server.listen(PORT, () => {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(SCOPE)}&` +
      `access_type=offline&` +
      `prompt=consent`;

    console.log('Opening browser for authorization...\n');
    exec(`open "${authUrl}"`);
  });
}

function exchangeCode(code, server) {
  console.log('Exchanging code for tokens...\n');

  const postData = new URLSearchParams({
    code: code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  }).toString();

  const options = {
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const tokens = JSON.parse(data);
        if (tokens.error) {
          console.log('Error:', tokens.error_description || tokens.error);
        } else {
          console.log('=== SUCCESS ===\n');
          console.log('Refresh Token (copy this to config.json):\n');
          console.log(tokens.refresh_token);
          console.log('\n');
        }
      } catch (e) {
        console.log('Error parsing response:', data);
      }
      server.close();
      process.exit(0);
    });
  });

  req.on('error', (e) => {
    console.log('Request error:', e.message);
    server.close();
    process.exit(1);
  });

  req.write(postData);
  req.end();
}
