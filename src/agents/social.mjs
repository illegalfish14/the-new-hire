import { isoDate } from '../core/text.mjs';

export default {
	name: 'social',
	title: 'Social drafter',

	instructions(config) {
		const { platforms = {} } = config.agents.social ?? {};
		const db = config.databases;
		const formats = Object.entries(platforms).map(([p, fmt]) => `- **${p}**: ${fmt}`).join('\n');
		return `Triggered by "create social drafts", "write social posts", or a one-off like "write a LinkedIn post about X".

For a weekly batch:
1. Read the latest ${['content_insights', 'weekly_updates', 'content_briefs'].filter((k) => db[k]).join(', ') || 'context in chat'} to decide what to post about and which hooks are working.
2. Write one draft per platform:
${formats || '- One short post per platform the team uses'}
3. ${db.social_drafts ? 'Save them as ONE social_drafts row for the week (a field per platform, Status "Draft Ready"). Read the database schema first.' : 'Post the drafts in chat.'}
4. Reply in chat with each platform's opening line.

For a one-off post, just write it in chat. Drafts are never published automatically. A human always posts them.`;
	},

	jobs: {
		async draftWeek(app) {
			const today = isoDate(new Date(), app.config.org.timezone);
			const { text } = await app.agent.run({ prompt: `Today is ${today}. Create this week's social drafts.` });
			await app.chat.post(app.config.chat.channels.content, text);
		},
	},
};
