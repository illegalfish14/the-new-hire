import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConfig, validateProfile, loadConfig } from '../src/config.mjs';

const example = JSON.parse(fs.readFileSync(new URL('../config/org.example.json', import.meta.url)));

test('the example profile is valid', () => {
	assert.deepEqual(validateProfile(example), []);
});

test('only databases with an ID in the environment are exposed', () => {
	const config = buildConfig(example, { NOTION_PIPELINE_DB: 'abc123' });
	assert.deepEqual(Object.keys(config.databases), ['pipeline']);
	assert.equal(config.databases.pipeline.id, 'abc123');
});

test('email and github are only configured when their credentials exist', () => {
	const none = buildConfig(example, {});
	assert.equal(none.secrets.gmail, null);
	assert.equal(none.secrets.github, null);
	const some = buildConfig(example, { GMAIL_REFRESH_TOKEN: 'r', GITHUB_TOKEN: 'g', GITHUB_REPO: 'o/r' });
	assert.equal(some.secrets.gmail.refreshToken, 'r');
	assert.deepEqual(some.secrets.github, { token: 'g', repo: 'o/r' });
});

test('model defaults are filled in', () => {
	const config = buildConfig({ org: { name: 'X', description: 'Y' } }, {});
	assert.equal(config.models.default, 'claude-opus-5');
	assert.deepEqual(config.models.effort, { chat: 'low', longform: 'high' });
});

test('invalid profiles report every problem', () => {
	const errors = validateProfile({
		org: { name: 'X', timezone: 'Mars/Olympus' },
		databases: { BadKey: {} },
		schedule: [{ cron: '* * * * *' }, { cron: '* * * * *', job: 'nodot' }],
	});
	assert.equal(errors.length, 6);
	assert.throws(() => buildConfig({}, {}), /org.name is required/);
});

test('loadConfig honours ORG_CONFIG', () => {
	const config = loadConfig({ ORG_CONFIG: 'config/org.example.json' });
	assert.equal(config.org.name, example.org.name);
});
