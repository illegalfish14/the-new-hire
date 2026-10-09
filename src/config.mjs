/**
 * Loads the org profile (config/org.json) and resolves it against the environment.
 *
 * The org profile is the only place a business describes itself: name, voice,
 * channels, which agents are on, which Notion databases exist and when jobs run.
 * Nothing about a specific company lives in code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveConfigPath(env = process.env) {
	if (env.ORG_CONFIG) return path.resolve(ROOT, env.ORG_CONFIG);
	const custom = path.join(ROOT, 'config', 'org.json');
	if (fs.existsSync(custom)) return custom;
	return path.join(ROOT, 'config', 'org.example.json');
}

export function loadConfig(env = process.env, configPath = resolveConfigPath(env)) {
	const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	return buildConfig(raw, env, configPath);
}

/** Pure: validates a raw profile and attaches env-derived settings. */
export function buildConfig(raw, env = {}, source = '(inline)') {
	const errors = validateProfile(raw);
	if (errors.length) {
		throw new Error(`Invalid org profile ${source}:\n  - ${errors.join('\n  - ')}`);
	}

	// Only databases with an ID in the environment are exposed to the agent.
	const databases = {};
	for (const [key, db] of Object.entries(raw.databases ?? {})) {
		const id = env[db.env];
		if (id) databases[key] = { ...db, key, id };
	}

	return {
		...raw,
		source,
		models: {
			default: raw.models?.default ?? 'claude-opus-5',
			effort: { chat: 'low', longform: 'high', ...raw.models?.effort },
		},
		chat: { channels: { ...raw.chat?.channels } },
		agents: raw.agents ?? {},
		schedule: raw.schedule ?? [],
		databases,
		secrets: {
			anthropicKey: env.ANTHROPIC_API_KEY,
			discordToken: env.DISCORD_BOT_TOKEN,
			notionToken: env.NOTION_TOKEN,
			github: env.GITHUB_TOKEN && env.GITHUB_REPO ? { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO } : null,
			gmail: env.GMAIL_REFRESH_TOKEN
				? {
						clientId: env.GMAIL_CLIENT_ID,
						clientSecret: env.GMAIL_CLIENT_SECRET,
						refreshToken: env.GMAIL_REFRESH_TOKEN,
						from: env.GMAIL_FROM,
					}
				: null,
			outlook: env.OUTLOOK_REFRESH_TOKEN
				? {
						clientId: env.OUTLOOK_CLIENT_ID,
						clientSecret: env.OUTLOOK_CLIENT_SECRET,
						tenantId: env.OUTLOOK_TENANT_ID,
						refreshToken: env.OUTLOOK_REFRESH_TOKEN,
					}
				: null,
		},
	};
}

export function validateProfile(raw) {
	const errors = [];
	if (!raw || typeof raw !== 'object') return ['profile must be a JSON object'];
	if (!raw.org?.name) errors.push('org.name is required');
	if (!raw.org?.description) errors.push('org.description is required');
	if (raw.org?.timezone && !isValidTimezone(raw.org.timezone)) {
		errors.push(`org.timezone "${raw.org.timezone}" is not a valid IANA timezone`);
	}
	for (const [key, db] of Object.entries(raw.databases ?? {})) {
		if (!/^[a-z][a-z0-9_]*$/.test(key)) errors.push(`databases.${key}: keys must be snake_case`);
		if (!db.env) errors.push(`databases.${key}.env is required (the env var holding the Notion database ID)`);
	}
	for (const [i, entry] of (raw.schedule ?? []).entries()) {
		if (!entry.cron || !entry.job) errors.push(`schedule[${i}] needs both "cron" and "job"`);
		else if (!/^[a-z]+\.[A-Za-z]+$/.test(entry.job)) errors.push(`schedule[${i}].job must look like "agent.jobName"`);
	}
	return errors;
}

function isValidTimezone(tz) {
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Human-readable report of what's connected — used by `npm run check`. */
export function describeConfig(config) {
	const on = (v) => (v ? 'connected' : '—');
	const lines = [
		`Org profile:   ${config.org.name}  (${path.relative(ROOT, config.source)})`,
		`Model:         ${config.models.default}`,
		`Anthropic:     ${on(config.secrets.anthropicKey)}`,
		`Discord:       ${on(config.secrets.discordToken)}`,
		`Notion:        ${on(config.secrets.notionToken)}  databases: ${Object.keys(config.databases).join(', ') || 'none'}`,
		`GitHub:        ${config.secrets.github ? config.secrets.github.repo : '—'}`,
		`Email:         ${config.secrets.gmail ? 'Gmail' : config.secrets.outlook ? 'Outlook' : '—'}`,
		`Agents:        ${Object.entries(config.agents).filter(([, a]) => a.enabled).map(([n]) => n).join(', ')}`,
		`Schedule:      ${config.schedule.map((s) => `${s.job} @ "${s.cron}"`).join('; ') || 'none'}`,
	];
	return lines.join('\n');
}
