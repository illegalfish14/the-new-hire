/**
 * One-off: get a Microsoft 365 / Outlook refresh token for OUTLOOK_REFRESH_TOKEN.
 *
 *   1. Register an app in Entra ID (Azure AD) with the redirect URI
 *      https://login.microsoftonline.com/common/oauth2/nativeclient and the
 *      delegated permissions Mail.ReadWrite + Mail.Send
 *   2. Put OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET / OUTLOOK_TENANT_ID in .env
 *   3. npm run token:outlook, open the URL, then paste back the redirect URL
 */

import { createInterface } from 'node:readline/promises';

const { OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_TENANT_ID } = process.env;
if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET || !OUTLOOK_TENANT_ID) {
	console.error('Set OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET and OUTLOOK_TENANT_ID in .env first.');
	process.exit(1);
}

const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPES = 'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access';
const base = `https://login.microsoftonline.com/${OUTLOOK_TENANT_ID}/oauth2/v2.0`;

const authUrl = new URL(`${base}/authorize`);
authUrl.search = new URLSearchParams({ client_id: OUTLOOK_CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES, prompt: 'consent' });

console.log('\nOpen this URL, signed in to the mailbox the bot should use:\n');
console.log(authUrl.href, '\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pasted = (await rl.question('Paste the full URL you were redirected to (or just the code): ')).trim();
rl.close();
const code = pasted.includes('code=') ? new URL(pasted).searchParams.get('code') : pasted;

const res = await fetch(`${base}/token`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ client_id: OUTLOOK_CLIENT_ID, client_secret: OUTLOOK_CLIENT_SECRET, code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', scope: SCOPES }),
});
const json = await res.json();
if (!json.refresh_token) {
	console.error('Token exchange failed:', json.error_description ?? json);
	process.exit(1);
}
console.log(`\nAdd this to .env:\n\nOUTLOOK_REFRESH_TOKEN=${json.refresh_token}\n`);
