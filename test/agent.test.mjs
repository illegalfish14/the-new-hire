import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/core/agent.mjs';
import { ToolRegistry } from '../src/core/tools.mjs';

const quiet = { info() {}, warn() {}, error() {} };
const config = { models: { default: 'claude-opus-5', effort: { chat: 'low', longform: 'high' } } };

/** Fake Anthropic client that replays scripted responses and records requests. */
function fakeClient(responses) {
	const requests = [];
	return {
		requests,
		beta: {
			messages: {
				stream(params) {
					requests.push(structuredClone(params));
					const next = responses.shift();
					if (!next) throw new Error('No more scripted responses');
					return { finalMessage: async () => next };
				},
			},
		},
	};
}

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolUse = (...calls) => ({
	stop_reason: 'tool_use',
	content: calls.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })),
});

test('returns text when Claude answers directly', async () => {
	const client = fakeClient([text('Hello!')]);
	const agent = createAgent({ client, config, tools: new ToolRegistry(quiet), system: 'sys', log: quiet });
	const out = await agent.run({ prompt: 'hi' });
	assert.equal(out.text, 'Hello!');
	assert.equal(out.iterations, 1);
});

test('sends model, adaptive thinking, effort, cached system and fallbacks', async () => {
	const client = fakeClient([text('ok')]);
	const agent = createAgent({ client, config, tools: new ToolRegistry(quiet), system: 'SYSTEM', log: quiet });
	await agent.run({ prompt: 'write an article', mode: 'longform' });
	const req = client.requests[0];
	assert.equal(req.model, 'claude-opus-5');
	assert.deepEqual(req.thinking, { type: 'adaptive' });
	assert.equal(req.output_config.effort, 'high');
	assert.equal(req.fallbacks, 'default');
	assert.deepEqual(req.system, [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
	assert.equal(req.tools, undefined, 'no tools key when registry is empty');
});

test('runs parallel tool calls and returns all results in one user message', async () => {
	const tools = new ToolRegistry(quiet).register(
		{ name: 'add', description: '', input_schema: { type: 'object' }, run: ({ a, b }) => String(a + b) },
		{ name: 'boom', description: '', input_schema: { type: 'object' }, run: () => { throw new Error('kaput'); } },
	);
	const client = fakeClient([toolUse(['t1', 'add', { a: 2, b: 3 }], ['t2', 'boom', {}], ['t3', 'missing', {}]), text('done')]);
	const agent = createAgent({ client, config, tools, system: 's', log: quiet });

	const out = await agent.run({ prompt: 'go' });
	assert.equal(out.text, 'done');

	const second = client.requests[1].messages;
	assert.equal(second.length, 3); // user, assistant(tool_use), user(results)
	const results = second[2].content;
	assert.deepEqual(results.map((r) => r.tool_use_id), ['t1', 't2', 't3']);
	assert.equal(results[0].content, '5');
	assert.equal(results[0].is_error, undefined);
	assert.equal(results[1].is_error, true);
	assert.match(results[1].content, /kaput/);
	assert.equal(results[2].is_error, true);
	assert.deepEqual(client.requests[1].tools.map((t) => t.name), ['add', 'boom']);
});

test('handles a refusal without reading content', async () => {
	const client = fakeClient([{ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }]);
	const agent = createAgent({ client, config, tools: new ToolRegistry(quiet), system: 's', log: quiet });
	const out = await agent.run({ prompt: 'x' });
	assert.equal(out.stopReason, 'refusal');
});

test('stops at the iteration limit', async () => {
	const tools = new ToolRegistry(quiet).register({ name: 'loop', description: '', input_schema: { type: 'object' }, run: () => 'again' });
	const client = fakeClient(Array.from({ length: 3 }, (_, i) => toolUse([`t${i}`, 'loop', {}])));
	const agent = createAgent({ client, config, tools, system: 's', log: quiet });
	const out = await agent.run({ prompt: 'x', maxIterations: 3 });
	assert.equal(out.stopReason, 'max_iterations');
	assert.equal(client.requests.length, 3);
});

test('useTools: false omits tools even when registered', async () => {
	const tools = new ToolRegistry(quiet).register({ name: 'a', description: '', input_schema: { type: 'object' }, run: () => '' });
	const client = fakeClient([text('summary')]);
	await createAgent({ client, config, tools, system: 's', log: quiet }).run({ prompt: 'x', useTools: false });
	assert.equal(client.requests[0].tools, undefined);
});
