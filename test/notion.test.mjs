import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyPage, buildProperties, buildFilter, summariseRows, richText, NotionClient, notionTools } from '../src/integrations/notion.mjs';

test('simplifyPage flattens common property types and exposes the title', () => {
	const row = simplifyPage({
		id: 'p1',
		properties: {
			Name: { type: 'title', title: [{ plain_text: 'Acme ' }, { plain_text: 'Ltd' }] },
			Status: { type: 'status', status: { name: 'Contacted' } },
			Tags: { type: 'multi_select', multi_select: [{ name: 'cafe' }, { name: 'wholesale' }] },
			'Last Contact': { type: 'date', date: { start: '2026-10-01' } },
			Notes: { type: 'rich_text', rich_text: [] },
			Formula: { type: 'formula', formula: {} },
		},
	});
	assert.deepEqual(row, {
		_id: 'p1',
		Name: 'Acme Ltd',
		_title: 'Acme Ltd',
		Status: 'Contacted',
		Tags: ['cafe', 'wholesale'],
		'Last Contact': '2026-10-01',
		Notes: null,
	});
});

test('buildProperties maps values using the schema and skips empties', () => {
	const schema = { Name: 'title', Status: 'select', Score: 'number', Tags: 'multi_select', Done: 'checkbox' };
	assert.deepEqual(buildProperties({ Name: 'A', Status: 'New', Score: '7', Tags: 'x, y', Done: true, Empty: '' }, schema), {
		Name: { title: [{ text: { content: 'A' } }] },
		Status: { select: { name: 'New' } },
		Score: { number: 7 },
		Tags: { multi_select: [{ name: 'x' }, { name: 'y' }] },
		Done: { checkbox: true },
	});
});

test('buildProperties rejects unknown properties with a helpful message', () => {
	assert.throws(() => buildProperties({ Nmae: 'typo' }, { Name: 'title' }), /Unknown or read-only property "Nmae".*Name/);
});

test('richText splits long content under the Notion limit', () => {
	const blocks = richText('x'.repeat(4000));
	assert.equal(blocks.length, 3);
	assert.ok(blocks.every((b) => b.text.content.length <= 1900));
});

test('buildFilter picks select vs status filters from the schema', () => {
	assert.deepEqual(buildFilter({ status: 'New' }, { Status: 'select' }), { property: 'Status', select: { equals: 'New' } });
	assert.deepEqual(buildFilter({ status: 'New', dateProperty: 'Last Contact', dateAfter: '2026-01-01' }, { Status: 'status' }), {
		and: [
			{ property: 'Status', status: { equals: 'New' } },
			{ property: 'Last Contact', date: { on_or_after: '2026-01-01' } },
		],
	});
	assert.equal(buildFilter({}, {}), undefined);
	assert.throws(() => buildFilter({ dateAfter: '2026-01-01' }, {}), /date_property is required/);
});

test('summariseRows counts by status and recent windows', () => {
	const now = new Date('2026-10-09T12:00:00Z');
	const rows = [
		{ Status: 'Contacted', 'Last Contact': '2026-10-08' },
		{ Status: 'Contacted', 'Last Contact': '2026-09-20' },
		{ Status: 'Won', 'Last Contact': '2026-06-01' },
		{},
	];
	assert.deepEqual(summariseRows(rows, { dateProperty: 'Last Contact', now }), {
		total: 4,
		byStatus: { Contacted: 2, Won: 1, 'No status': 1 },
		last7Days: { Contacted: 1 },
		last30Days: { Contacted: 2 },
	});
});

test('notion tools only expose configured databases and paginate queries', async () => {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, body: init.body && JSON.parse(init.body) });
		if (url.endsWith('/databases/db1')) return json({ properties: { Name: { type: 'title' }, Status: { type: 'select' } } });
		const page = (id) => ({ id, properties: { Name: { type: 'title', title: [{ plain_text: id }] } } });
		const first = !JSON.parse(init.body).start_cursor;
		return json(first ? { results: [page('a')], has_more: true, next_cursor: 'c2' } : { results: [page('b')], has_more: false });
	};
	const tools = notionTools(new NotionClient({ token: 't', fetch }), { pipeline: { key: 'pipeline', id: 'db1' } });
	const read = tools.find((t) => t.name === 'notion_read');
	assert.deepEqual(read.input_schema.properties.database.enum, ['pipeline']);

	const rows = await read.run({ database: 'pipeline', status: 'New' });
	assert.deepEqual(rows.map((r) => r._id), ['a', 'b']);
	assert.deepEqual(calls[1].body.filter, { property: 'Status', select: { equals: 'New' } });

	await assert.rejects(read.run({ database: 'other' }), /Unknown database "other"/);
});

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
