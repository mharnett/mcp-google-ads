#!/usr/bin/env node

const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const url = require('url');

// Desktop OAuth client (installed app) from gcp-oauth.keys.json
const CLIENT_ID = '557294086068-o7rb5neg65g28uf65j85q0h60cop40j9.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPE = 'https://www.googleapis.com/auth/adwords';
const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}`;

console.log('\n=== Google Ads OAuth Token Generator (Desktop Client) ===\n');
console.log('Using desktop OAuth client. Opening browser...\n');

startServer();

function startServer() {
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    const code = parsedUrl.query.code;
    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Success!</h1><p>You can close this window and check the terminal.</p>');
      exchangeCode(code, server);
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
