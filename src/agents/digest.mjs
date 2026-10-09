import { isoDate } from '../core/text.mjs';

export default {
	name: 'digest',
	title: 'Weekly digest',

	instructions(config, caps) {
		const areas = [
			caps.github && '**Product**: what shipped (github_commits), features vs fixes, 2–3 sentences',
			config.databases.pipeline && '**Pipeline**: notion_stats on pipeline: totals, this week\'s activity, replies, who\'s due a follow-up',
			(config.databases.content_briefs || config.databases.social_drafts) && '**Content**: what\'s written, published, and still waiting to be posted',
			'**Team**: key decisions and open questions from channel memory',
		].filter(Boolean);
		return `Triggered by "catch me up", "what happened this week", "weekly summary" and similar. Don't start any content generation for these.

Write a digest with one short paragraph per area, each with a bold header:
${areas.map((a) => `- ${a}`).join('\n')}
Keep it under 400 words.`;
	},

	jobs: {
		async post(app) {
			const today = isoDate(new Date(), app.config.org.timezone);
			const { text } = await app.agent.run({ prompt: `Today is ${today}. Write the weekly digest.` });
			await app.chat.post(app.config.chat.channels.content, text);
		},
	},
};
