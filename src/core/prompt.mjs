/**
 * Builds the system prompt from the org profile and the enabled agents.
 *
 * Deterministic on purpose: no dates, IDs or anything per-request, so the
 * prompt is cacheable for the life of the process.
 */
export function buildSystemPrompt({ config, agents, capabilities }) {
	const { org, voice = {}, team = {} } = config;
	const parts = [];

	parts.push(
		`You are the newest member of the ${org.name} team: an AI operations teammate who lives in the team's chat and handles content, reporting and pipeline work.`,
		`## About ${org.name}\n${org.description}${org.website ? `\nWebsite: ${org.website}` : ''}`,
		`## How to work
- Reply conversationally and concisely. Report what you did, not what you're about to do.
- Before writing to a database, read it first so you use the exact property names and allowed status values.
- If a request is ambiguous, make a sensible assumption, state it briefly, and proceed.
- If a tool you need isn't connected, say so plainly. Never invent data, numbers or results.
- You never send email to anyone outside the team. Outbound messages are saved as drafts for a human to review and send.`,
	);

	if (voice.summary || voice.rules?.length || voice.avoid?.length) {
		const lines = [];
		if (voice.summary) lines.push(voice.summary);
		for (const rule of voice.rules ?? []) lines.push(`- ${rule}`);
		if (voice.avoid?.length) lines.push(`- Avoid these words: ${voice.avoid.join(', ')}`);
		parts.push(`## Brand voice (apply to everything you write for publication)\n${lines.join('\n')}`);
	}

	parts.push(`## Connected tools\n${describeCapabilities(config, capabilities, team)}`);

	for (const agent of agents) {
		const text = agent.instructions?.(config, capabilities);
		if (text) parts.push(`## ${agent.title}\n${text.trim()}`);
	}

	return parts.join('\n\n');
}

function describeCapabilities(config, caps, team) {
	const lines = [];
	const dbs = Object.values(config.databases);
	if (caps.notion && dbs.length) {
		lines.push('Notion databases (use the notion_* tools):');
		for (const db of dbs) lines.push(`- ${db.key}: ${db.description ?? ''}`.trimEnd());
	} else {
		lines.push('- Notion: not connected');
	}
	lines.push(caps.github ? `- GitHub: use github_commits to see what shipped in ${caps.github}` : '- GitHub: not connected');
	lines.push(
		caps.email
			? `- Email (${caps.email}): email_team sends to the team inbox${team.inbox ? ` (${team.inbox})` : ''}; email_draft saves a draft to anyone`
			: '- Email: not connected',
	);
	lines.push('- Chat: the latest channel activity and long-term channel memory are included with each message when available.');
	return lines.join('\n');
}
