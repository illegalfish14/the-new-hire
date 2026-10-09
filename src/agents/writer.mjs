import { isoDate } from '../core/text.mjs';

export default {
	name: 'writer',
	title: 'Writer: long-form articles',

	instructions(config) {
		const { wordCount = '1,200–1,800', categories = [] } = config.agents.writer ?? {};
		const briefs = config.databases.content_briefs;
		return `Triggered by "write an article about X", "write this week's blog", or an approved brief.

1. ${briefs ? 'If no topic is given, use the newest content_briefs row with Status "Brief Ready".' : 'If no topic is given, propose one.'} If there's nothing to use, pick the least-covered of these categories: ${categories.join('; ') || 'any topic useful to our customers'}.
2. Write a complete ${wordCount} word article in the brand voice: a clear headline, a short intro that states the reader's problem, scannable H2 sections, and a closing call to action.
3. ${briefs ? 'Save or update the brief in content_briefs with Status "Ready to Publish".' : ''} If email_team is available, send the full article to the team inbox as HTML.
4. In chat, reply with the headline, a two-sentence summary and where it was saved. Do not paste the whole article into chat.`;
	},

	jobs: { proposeBrief },
};

/** Proposes a brief, waits for a teammate to approve it, then writes the article. */
async function proposeBrief(app) {
	const channel = app.config.chat.channels.content;
	const today = isoDate(new Date(), app.config.org.timezone);
	const { text: brief } = await app.agent.run({
		prompt: `Today is ${today}. Propose ONE article brief for this week. Check recent content_briefs if available so you don't repeat a topic. Do not write the article or save anything yet.
Reply with exactly: a working title, the target reader, the angle (one sentence), and 4–6 section headings.`,
	});

	const proposal = await app.chat.post(
		channel,
		`**Proposed brief for this week**\n\n${brief}\n\nReact ✅ to write it, 🔄 for a different angle, ❌ to skip. Or reply with a different direction.`,
		{ approval: true },
	);

	app.approvals.request(proposal.id, {
		onApprove: async (user, direction) => {
			await app.chat.post(channel, `✍️ ${user} approved. Writing the article now…`);
			const { text } = await app.agent.run({
				mode: 'longform',
				prompt: `Today is ${today}. Write the article for this approved brief${direction ? `, adjusted per ${user}'s direction: "${direction}"` : ''}.\n\n${brief}`,
			});
			await app.chat.post(channel, text);
		},
		onRetry: async () => proposeBrief(app),
		onReject: async (user) => app.chat.post(channel, `Skipped this week's brief (${user}).`),
		onExpire: async () => app.chat.post(channel, 'No response to the brief, so I skipped it this week.'),
	});
}
