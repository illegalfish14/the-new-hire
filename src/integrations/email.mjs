/**
 * Email via Gmail or Outlook (Microsoft Graph), using OAuth refresh tokens.
 *
 * Deliberate safety boundary: the agent can only *send* to the team inbox.
 * Anything addressed to someone else becomes a draft that a human reviews
 * and sends.
 */

const isHtml = (body) => String(body).trimStart().startsWith('<');

/** Strip CR/LF so values can't inject extra headers. */
export const headerSafe = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

export function buildRawEmail({ from, to, subject, body }) {
	const raw = [
		`From: ${headerSafe(from)}`,
		`To: ${headerSafe(to)}`,
		`Subject: ${headerSafe(subject)}`,
		'MIME-Version: 1.0',
		`Content-Type: ${isHtml(body) ? 'text/html' : 'text/plain'}; charset=utf-8`,
		'',
		String(body),
	].join('\r\n');
	return Buffer.from(raw).toString('base64url');
}

async function refreshAccessToken(url, params, fetch) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params),
	});
	const data = await res.json();
	if (!data.access_token) throw new Error(`OAuth refresh failed: ${data.error_description ?? data.error ?? res.status}`);
	return data.access_token;
}

function gmailProvider(cfg, fetch) {
	const token = () =>
		refreshAccessToken('https://oauth2.googleapis.com/token', {
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret,
			refresh_token: cfg.refreshToken,
			grant_type: 'refresh_token',
		}, fetch);

	async function gmail(path, payload) {
		const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 300)}`);
		return res.json();
	}

	return {
		name: 'Gmail',
		send: ({ to, subject, body }) => gmail('messages/send', { raw: buildRawEmail({ from: cfg.from, to, subject, body }) }),
		draft: ({ to, subject, body }) => gmail('drafts', { message: { raw: buildRawEmail({ from: cfg.from, to, subject, body }) } }),
	};
}

function outlookProvider(cfg, fetch) {
	const token = () =>
		refreshAccessToken(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret,
			refresh_token: cfg.refreshToken,
			grant_type: 'refresh_token',
			scope: 'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access',
		}, fetch);

	const message = ({ to, subject, body }) => ({
		subject: headerSafe(subject),
		body: { contentType: isHtml(body) ? 'HTML' : 'Text', content: String(body) },
		toRecipients: [{ emailAddress: { address: headerSafe(to) } }],
	});

	async function graph(path, payload) {
		const res = await fetch(`https://graph.microsoft.com/v1.0/me/${path}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (!res.ok) throw new Error(`Outlook ${res.status}: ${(await res.text()).slice(0, 300)}`);
		return res.status === 202 ? {} : res.json();
	}

	return {
		name: 'Outlook',
		send: (msg) => graph('sendMail', { message: message(msg), saveToSentItems: true }),
		draft: (msg) => graph('messages', message(msg)),
	};
}

export function createMailer(secrets, { fetch = globalThis.fetch } = {}) {
	if (secrets.gmail) return gmailProvider(secrets.gmail, fetch);
	if (secrets.outlook) return outlookProvider(secrets.outlook, fetch);
	return null;
}

export function emailTools(mailer, teamInbox) {
	if (!mailer) return [];
	const tools = [
		{
			name: 'email_draft',
			description: 'Save an email as a draft for a human to review and send. Use for anything addressed outside the team.',
			input_schema: {
				type: 'object',
				properties: {
					to: { type: 'string' },
					subject: { type: 'string' },
					body: { type: 'string', description: 'Plain text, or HTML starting with <' },
				},
				required: ['to', 'subject', 'body'],
			},
			async run(msg) {
				await mailer.draft(msg);
				return `Draft saved in ${mailer.name} for ${msg.to}: "${msg.subject}"`;
			},
		},
	];
	if (teamInbox) {
		tools.push({
			name: 'email_team',
			description: `Send an email to the team inbox (${teamInbox}), e.g. a finished article or a weekly report.`,
			input_schema: {
				type: 'object',
				properties: { subject: { type: 'string' }, body: { type: 'string', description: 'Plain text, or HTML starting with <' } },
				required: ['subject', 'body'],
			},
			async run({ subject, body }) {
				await mailer.send({ to: teamInbox, subject, body });
				return `Sent to ${teamInbox}: "${subject}"`;
			},
		});
	}
	return tools;
}
