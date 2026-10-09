import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chunkText, section } from '../src/core/text.mjs';
import { Approvals, APPROVE, RETRY, REJECT } from '../src/core/approvals.mjs';
import { collectJobs, checkSchedule } from '../src/core/scheduler.mjs';
import { buildSystemPrompt } from '../src/core/prompt.mjs';
import { buildConfig } from '../src/config.mjs';
import { ALL_AGENTS } from '../src/agents/index.mjs';
import { dueFollowUps } from '../src/agents/pipeline.mjs';
import { buildRawEmail, emailTools } from '../src/integrations/email.mjs';
import { formatCommits } from '../src/integrations/github.mjs';
import { assemble } from '../src/index.mjs';

const example = JSON.parse(fs.readFileSync(new URL('../config/org.example.json', import.meta.url)));

test('chunkText respects the limit, keeps everything, and splits long lines', () => {
	const input = ['short', 'y'.repeat(4500), 'tail'].join('\n');
	const chunks = chunkText(input, 1900);
	assert.ok(chunks.every((c) => c.length <= 1900));
	assert.equal(chunks.join('').replace(/\n/g, ''), input.replace(/\n/g, ''));
	assert.deepEqual(chunkText('a\nb', 1900), ['a\nb']);
	assert.deepEqual(chunkText('   '), []);
});

test('section renders tagged blocks and skips empty ones', () => {
	assert.equal(section('memory', ''), '');
	assert.equal(section('memory', ' hi '), '\n\n<memory>\nhi\n</memory>');
});

test('approvals: reactions resolve once, replies carry direction or cancel', async () => {
	const approvals = new Approvals();
	const seen = [];
	const handlers = {
		onApprove: (u, d) => seen.push(['approve', u, d]),
		onRetry: (u) => seen.push(['retry', u]),
		onReject: (u) => seen.push(['reject', u]),
	};
	approvals.request('m1', handlers);
	assert.equal(await approvals.react('m1', '👀', 'sam'), false, 'other emoji ignored');
	assert.equal(await approvals.react('m1', APPROVE, 'sam'), true);
	assert.equal(await approvals.react('m1', REJECT, 'sam'), false, 'already resolved');

	approvals.request('m2', handlers);
	await approvals.reply('m2', 'focus on cold brew instead', 'ali');
	approvals.request('m3', handlers);
	await approvals.reply('m3', 'cancel that', 'ali');
	approvals.request('m4', handlers);
	await approvals.react('m4', RETRY, 'jo');

	assert.deepEqual(seen, [
		['approve', 'sam', undefined],
		['approve', 'ali', 'focus on cold brew instead'],
		['reject', 'ali'],
		['retry', 'jo'],
	]);
});

test('approvals expire instead of auto-approving', async () => {
	const approvals = new Approvals({ timeoutMs: 10 });
	let expired = false;
	approvals.request('m', { onApprove: () => assert.fail('must not approve'), onExpire: () => (expired = true) });
	await new Promise((r) => setTimeout(r, 30));
	assert.ok(expired);
	assert.equal(approvals.has('m'), false);
});

test('every scheduled job in the example profile exists and has valid cron', () => {
	const jobs = collectJobs(ALL_AGENTS);
	assert.deepEqual(checkSchedule(example.schedule, jobs), []);
	assert.match(checkSchedule([{ cron: 'nope', job: 'ghost.job' }], jobs).join(' '), /Unknown job.*Invalid cron/);
});

test('system prompt is built from the profile, deterministic, and respects disabled agents', () => {
	const config = buildConfig({ ...example, agents: { ...example.agents, writer: { enabled: false } } }, { NOTION_PIPELINE_DB: 'x' });
	const agents = ALL_AGENTS.filter((a) => config.agents[a.name]?.enabled);
	const caps = { notion: true, github: null, email: null };
	const a = buildSystemPrompt({ config, agents, capabilities: caps });
	const b = buildSystemPrompt({ config, agents, capabilities: caps });
	assert.equal(a, b);
	assert.match(a, /Northwind Coffee/);
	assert.match(a, /- pipeline: Sales/);
	assert.doesNotMatch(a, /Writer: long-form/);
	assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}/, 'no dates in the cached prompt');
});

test('dueFollowUps finds quiet contacts, oldest first', () => {
	const now = new Date('2026-10-09T12:00:00Z');
	const rows = [
		{ _id: '1', Status: 'Contacted', 'Last Contact': '2026-10-08' },
		{ _id: '2', Status: 'Follow Up', 'Last Contact': '2026-09-30' },
		{ _id: '3', Status: 'Contacted', 'Last Contact': '2026-10-01' },
		{ _id: '4', Status: 'Won', 'Last Contact': '2026-01-01' },
		{ _id: '5', Status: 'Contacted' },
	];
	assert.deepEqual(dueFollowUps(rows, { now, afterDays: 4 }).map((r) => r._id), ['2', '3']);
});

test('buildRawEmail strips header injection attempts', () => {
	const raw = Buffer.from(buildRawEmail({ from: 'a@x', to: 'b@x\r\nBcc: evil@x', subject: 'Hi\nBcc: evil@x', body: 'body' }), 'base64url').toString();
	const headers = raw.split('\r\n\r\n')[0];
	assert.doesNotMatch(headers, /\r\nBcc:/);
	assert.match(headers, /Content-Type: text\/plain/);
});

test('email_team is only offered when a team inbox is configured', () => {
	const mailer = { name: 'Gmail', send: async () => {}, draft: async () => {} };
	assert.deepEqual(emailTools(mailer, null).map((t) => t.name), ['email_draft']);
	assert.deepEqual(emailTools(mailer, 'team@x').map((t) => t.name), ['email_draft', 'email_team']);
	assert.deepEqual(emailTools(null, 'team@x'), []);
});

test('formatCommits drops merge commits', () => {
	const c = (message) => ({ commit: { message, author: { date: '2026-10-08T10:00:00Z', name: 'Sam' } } });
	assert.equal(formatCommits([c('Add oat milk option\n\nbody'), c('Merge pull request #3')]), '- 2026-10-08 Add oat milk option (Sam)');
});

test('assemble wires tools from whatever is connected', () => {
	const config = buildConfig(example, { NOTION_TOKEN: 't', NOTION_PIPELINE_DB: 'p', GITHUB_TOKEN: 'g', GITHUB_REPO: 'o/r' });
	const { tools, capabilities, jobs } = assemble(config);
	assert.deepEqual(tools.names, ['github_commits', 'notion_create', 'notion_read', 'notion_schema', 'notion_stats', 'notion_update']);
	assert.deepEqual(capabilities, { notion: true, github: 'o/r', email: null });
	assert.ok(jobs.has('writer.proposeBrief'));
});
