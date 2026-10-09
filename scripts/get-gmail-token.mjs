/**
 * One-off: get a Gmail refresh token for GMAIL_REFRESH_TOKEN.
 *
 *   1. Create an OAuth client (type "Desktop app") in Google Cloud Console and
 *      put GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env
 *   2. npm run token:gmail
 *   3. Open the printed URL while signed in to the mailbox the bot should use
 */

import { createServer } from 'node:http';

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env;
if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
	console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first.');
	process.exit(1);
}

const PORT = 3001;
const REDIRECT_URI = `http://localhost:${PORT}`;
// gmail.send + gmail.compose cover sending to the team inbox and creating drafts.
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
	client_id: GMAIL_CLIENT_ID,
	response_type: 'code',
	redirect_uri: REDIRECT_URI,
	scope: SCOPES,
	access_type: 'offline',
	prompt: 'consent',
});

console.log('\nOpen this URL, signed in to the mailbox the bot should use:\n');
console.log(authUrl.href, '\n');

const code = await new Promise((resolve, reject) => {
	const server = createServer((req, res) => {
		const url = new URL(req.url, REDIRECT_URI);
		const code = url.searchParams.get('code');
		const error = url.searchParams.get('error');
		if (!code && !error) return void res.writeHead(204).end();
		res.writeHead(200, { 'Content-Type': 'text/html' }).end(code ? '<h2>Authorised. You can close this tab.</h2>' : `<h2>Error: ${error}</h2>`);
		server.close();
		code ? resolve(code) : reject(new Error(error));
	});
	server.listen(PORT, () => console.log(`Waiting for the redirect on ${REDIRECT_URI} …`));
});

const res = await fetch('https://oauth2.googleapis.com/token', {
	method: 'POST',
	headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
});
const json = await res.json();
if (!json.refresh_token) {
	console.error('Token exchange failed:', json);
	process.exit(1);
}
console.log(`\nAdd this to .env:\n\nGMAIL_REFRESH_TOKEN=${json.refresh_token}\n`);
