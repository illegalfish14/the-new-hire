export default {
	name: 'analyst',
	title: 'Analyst: weekly performance review',

	instructions(config, caps) {
		const { platforms = ['your social channels'] } = config.agents.analyst ?? {};
		const db = config.databases;
		return `Triggered by requests like "run the analyst" or "what performed this week", usually with stats pasted into chat.

1. If no performance data is in the message or recent channel activity, ask for last week's numbers from ${platforms.join(', ')} and stop.
2. Identify the top and bottom performers and what the winners have in common (hook, format, topic, timing). Turn that into 2–3 recommendations: double down, stop, or test next.
3. ${db.content_insights ? 'Save the analysis as a new content_insights row.' : 'Post the analysis in chat (no insights database is connected).'}
${caps.github && db.weekly_updates ? '4. Call github_commits and save a weekly_updates row summarising what shipped this week, grouped into New and Fixed, in customer-friendly language.\n' : ''}Finish with the key findings in chat, under 150 words.`;
	},
};
