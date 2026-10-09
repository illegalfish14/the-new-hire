/**
 * Pipeline agent: answers questions about a sales / partnerships pipeline
 * kept in Notion, and posts follow-up reminders. It never sends outreach.
 * Drafts only, for a human to review.
 */

const DAY = 86_400_000;

export function dueFollowUps(rows, { now = new Date(), afterDays = 4, statuses = ['Contacted', 'Follow Up'] } = {}) {
	const cutoff = new Date(now - afterDays * DAY).toISOString().slice(0, 10);
	return rows
		.filter((r) => statuses.includes(r.Status) && r['Last Contact'] && r['Last Contact'] <= cutoff)
		.sort((a, b) => a['Last Contact'].localeCompare(b['Last Contact']));
}

export default {
	name: 'pipeline',
	title: 'Pipeline',

	instructions(config, caps) {
		const label = config.agents.pipeline?.label ?? 'pipeline';
		if (!config.databases.pipeline) return `The ${label} database isn't connected. If asked about it, say so.`;
		return `The pipeline database tracks ${label}. Rows have a Status and a "Last Contact" date.

- For counts, volumes or "how's the pipeline": call notion_stats on pipeline with date_property "Last Contact". Never count by reading rows.
- For "who needs a follow-up" or a specific contact: notion_read with a status filter and/or a Last Contact date range.
- When a teammate reports progress ("emailed Acme today", "Acme replied"), update that row's Status and Last Contact.
${caps.email ? '- If asked to write outreach or a follow-up, save it with email_draft. Never send it.' : ''}`;
	},

	jobs: {
		/** Posts a list of contacts that have gone quiet. Deterministic, no model call. */
		async followUps(app) {
			const db = app.config.databases.pipeline;
			if (!db || !app.notion) return;
			const { followUpAfterDays = 4 } = app.config.agents.pipeline ?? {};
			const rows = await app.notion.query(db.id);
			const due = dueFollowUps(rows, { afterDays: followUpAfterDays });
			if (!due.length) return;
			const lines = due.slice(0, 25).map((r) => `- **${r._title ?? r._id}**: ${r.Status}, last contact ${r['Last Contact']}`);
			await app.chat.post(
				app.config.chat.channels.alerts ?? app.config.chat.channels.content,
				`**Follow-ups due (${due.length})**\n${lines.join('\n')}${due.length > 25 ? `\n…and ${due.length - 25} more` : ''}`,
			);
		},
	},
};
