/**
 * Long-term channel memory.
 *
 * Once a day every channel is summarised into ~150 words and stored in Notion.
 * Every message the agent handles then carries the last N days of summaries,
 * which gives it cross-channel awareness without stuffing raw history into
 * the context window.
 */

import { isoDate } from '../core/text.mjs';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function readMemory(app) {
	const db = app.config.databases.channel_memory;
	if (!db || !app.notion) return '';
	const days = app.config.agents.memory?.retentionDays ?? 7;
	const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
	const rows = await app.notion.query(db.id, {
		filter: { property: 'Date', date: { on_or_after: since } },
		sorts: [{ property: 'Date', direction: 'descending' }],
		limit: 100,
	});
	return rows.map((r) => `#${r.Channel} (${r.Date}): ${r.Summary ?? ''}`).join('\n');
}

export default {
	name: 'memory',
	title: 'Channel memory',

	instructions() {
		return 'Use the channel memory provided with each message to answer questions about past discussions and decisions in any channel. Say which channel and day something came from.';
	},

	jobs: {
		async summarise(app) {
			const db = app.config.databases.channel_memory;
			if (!db || !app.notion) return app.log.warn('memory.summarise: channel_memory database not connected');
			const tz = app.config.org.timezone;
			const date = isoDate(new Date(), tz);
			const day = DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

			for (const channel of app.chat.channelNames()) {
				try {
					const messages = await app.chat.recentMessages(channel, { sinceMs: 86_400_000, includeBots: false });
					if (!messages.length) continue;
					const log = messages.map((m) => `${m.author}: ${m.text}`).join('\n').slice(-12_000);
					const { text: summary } = await app.agent.run({
						useTools: false,
						prompt: `Summarise today's activity in #${channel} in 100–150 words of plain prose. Focus on decisions, open questions and anything actionable. No bullet points.\n\n<chat_log>\n${log}\n</chat_log>`,
					});
					const existing = await app.notion.query(db.id, {
						filter: { and: [{ property: 'Channel', title: { equals: channel } }, { property: 'Date', date: { equals: date } }] },
						limit: 1,
					});
					const values = { Channel: channel, Date: date, Day: day, Summary: summary };
					if (existing[0]) await app.notion.update(existing[0]._id, db.id, values);
					else await app.notion.create(db.id, values);
					app.log.info(`Summarised #${channel}`);
				} catch (err) {
					app.log.error(`Failed to summarise #${channel}: ${err.message}`);
				}
			}
		},
	},
};
