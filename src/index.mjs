/**
 * The New Hire: an AI operations teammate for your team chat.
 *
 *   npm start          run the bot
 *   npm run check      show what's configured and connected, then exit
 */

import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, describeConfig } from './config.mjs';
import { createAgent } from './core/agent.mjs';
import { ToolRegistry } from './core/tools.mjs';
import { Approvals } from './core/approvals.mjs';
import { buildSystemPrompt } from './core/prompt.mjs';
import { collectJobs, checkSchedule, startSchedule } from './core/scheduler.mjs';
import { section, isoDate } from './core/text.mjs';
import { NotionClient, notionTools } from './integrations/notion.mjs';
import { createGitHub, githubTools } from './integrations/github.mjs';
import { createMailer, emailTools } from './integrations/email.mjs';
import { createDiscordChat } from './chat/discord.mjs';
import { readMemory } from './agents/memory.mjs';
import { ALL_AGENTS } from './agents/index.mjs';

const log = {
	info: (...a) => console.log(new Date().toISOString(), ...a),
	warn: (...a) => console.warn(new Date().toISOString(), '⚠', ...a),
	error: (...a) => console.error(new Date().toISOString(), '✗', ...a),
};

export function assemble(config, { anthropic, fetch = globalThis.fetch } = {}) {
	const notion = config.secrets.notionToken ? new NotionClient({ token: config.secrets.notionToken, fetch }) : null;
	const github = config.secrets.github ? createGitHub(config.secrets.github, { fetch }) : null;
	const mailer = createMailer(config.secrets, { fetch });

	const tools = new ToolRegistry(log).register(
		notion ? notionTools(notion, config.databases) : [],
		githubTools(github),
		emailTools(mailer, config.team?.inbox),
	);

	const agents = ALL_AGENTS.filter((a) => config.agents[a.name]?.enabled);
	const capabilities = { notion: !!notion, github: github?.repo ?? null, email: mailer?.name ?? null };
	const system = buildSystemPrompt({ config, agents, capabilities });
	const jobs = collectJobs(agents);

	return { notion, github, mailer, tools, agents, capabilities, system, jobs, agent: anthropic ? createAgent({ client: anthropic, config, tools, system, log }) : null };
}

async function main() {
	const config = loadConfig();
	const anthropic = config.secrets.anthropicKey ? new Anthropic({ apiKey: config.secrets.anthropicKey }) : null;
	const parts = assemble(config, { anthropic });
	const scheduleProblems = checkSchedule(config.schedule, parts.jobs);

	if (process.argv.includes('--check')) {
		console.log(describeConfig(config));
		console.log(`Tools:         ${parts.tools.names.join(', ') || 'none'}`);
		console.log(`System prompt: ${parts.system.length.toLocaleString()} chars`);
		for (const p of scheduleProblems) console.log(`⚠ ${p}`);
		return;
	}

	for (const key of ['anthropicKey', 'discordToken']) {
		if (!config.secrets[key]) throw new Error(`Missing ${key === 'anthropicKey' ? 'ANTHROPIC_API_KEY' : 'DISCORD_BOT_TOKEN'}. Copy .env.example to .env.`);
	}
	for (const p of scheduleProblems) log.warn(p);

	const { agent, notion, jobs } = parts;
	const discord = createDiscordChat({ token: config.secrets.discordToken, log });
	const approvals = new Approvals();
	const app = { config, agent, notion, chat: discord.chat, approvals, log };

	async function runJob(name, triggeredBy) {
		const job = jobs.get(name);
		if (!job) throw new Error(`Unknown job "${name}". Available: ${[...jobs.keys()].join(', ')}`);
		log.info(`Running ${name} (${triggeredBy})`);
		try {
			await job(app);
		} catch (err) {
			log.error(`${name} failed: ${err.stack ?? err.message}`);
			const alerts = config.chat.channels.alerts ?? config.chat.channels.content;
			if (alerts) await discord.chat.post(alerts, `❌ ${name} failed: ${err.message}`).catch(() => {});
		}
	}

	await discord.start({
		async onMention({ text, author, channelName, history, reply }) {
			// "@bot run digest.post" runs any job on demand
			const command = text.match(/^run\s+([a-z]+\.[A-Za-z]+)\s*$/);
			if (command) {
				await reply(`Running \`${command[1]}\`…`);
				return runJob(command[1], author);
			}
			const memory = await readMemory(app).catch((err) => (log.warn(`memory: ${err.message}`), ''));
			const prompt =
				`${author} in #${channelName}: ${text}` +
				section('today', isoDate(new Date(), config.org.timezone)) +
				section('recent_channel_activity', history.map((m) => `${m.author}: ${m.text}`).join('\n')) +
				section('channel_memory', memory);
			const { text: out } = await agent.run({ prompt, mode: /\b(article|blog|long[- ]form)\b/i.test(text) ? 'longform' : 'chat' });
			await reply(out);
		},
		onReply: ({ referencedId, text, author }) => approvals.reply(referencedId, text, author),
		onReaction: ({ messageId, emoji, author }) => approvals.react(messageId, emoji, author),
	});

	const stopSchedule = startSchedule({ schedule: config.schedule, jobs, timezone: config.org.timezone ?? 'UTC', runJob, log });

	const shutdown = () => {
		log.info('Shutting down');
		stopSchedule();
		discord.stop();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		log.error(err.message);
		process.exit(1);
	});
}
