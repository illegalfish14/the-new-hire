/**
 * Notion integration: a small schema-aware client plus agent tools.
 *
 * The agent works with plain key/value objects. This module translates those
 * to and from Notion's property format, using each database's live schema, so
 * any database layout works without code changes.
 */

const NOTION_VERSION = '2022-06-28';
const RICH_TEXT_LIMIT = 1900;

export class NotionClient {
	#schemas = new Map();

	constructor({ token, fetch = globalThis.fetch }) {
		this.token = token;
		this.fetch = fetch;
	}

	async #request(path, { method = 'GET', body } = {}) {
		const res = await this.fetch(`https://api.notion.com/v1${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.token}`,
				'Notion-Version': NOTION_VERSION,
				'Content-Type': 'application/json',
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 300)}`);
		return res.json();
	}

	/** { propertyName: type } — cached per process. */
	async schema(dbId) {
		if (!this.#schemas.has(dbId)) {
			const db = await this.#request(`/databases/${dbId}`);
			this.#schemas.set(dbId, Object.fromEntries(Object.entries(db.properties).map(([n, p]) => [n, p.type])));
		}
		return this.#schemas.get(dbId);
	}

	/** Query all pages (auto-paginates). Returns simplified rows. */
	async query(dbId, { filter, sorts, limit = Infinity } = {}) {
		const rows = [];
		let cursor;
		do {
			const data = await this.#request(`/databases/${dbId}/query`, {
				method: 'POST',
				body: { page_size: 100, filter, sorts, start_cursor: cursor },
			});
			rows.push(...data.results.map(simplifyPage));
			cursor = data.has_more ? data.next_cursor : undefined;
		} while (cursor && rows.length < limit);
		return rows.slice(0, limit);
	}

	async create(dbId, values) {
		const properties = buildProperties(values, await this.schema(dbId));
		const page = await this.#request('/pages', { method: 'POST', body: { parent: { database_id: dbId }, properties } });
		return page.id;
	}

	async update(pageId, dbId, values) {
		const properties = buildProperties(values, await this.schema(dbId));
		await this.#request(`/pages/${pageId}`, { method: 'PATCH', body: { properties } });
		return pageId;
	}
}

// ─── Pure helpers (unit tested) ───────────────────────────────────────────────

const plain = (rich) => rich.map((t) => t.plain_text).join('') || null;

const READERS = {
	title: (p) => plain(p.title),
	rich_text: (p) => plain(p.rich_text),
	select: (p) => p.select?.name ?? null,
	status: (p) => p.status?.name ?? null,
	multi_select: (p) => p.multi_select.map((o) => o.name),
	date: (p) => p.date?.start ?? null,
	number: (p) => p.number,
	checkbox: (p) => p.checkbox,
	url: (p) => p.url ?? null,
	email: (p) => p.email ?? null,
	phone_number: (p) => p.phone_number ?? null,
	created_time: (p) => p.created_time,
	last_edited_time: (p) => p.last_edited_time,
};

export function simplifyPage(page) {
	const row = { _id: page.id };
	for (const [name, prop] of Object.entries(page.properties)) {
		const read = READERS[prop.type];
		if (read) row[name] = read(prop);
		if (prop.type === 'title') row._title = row[name];
	}
	return row;
}

export function richText(content) {
	const s = String(content);
	const blocks = [];
	for (let i = 0; i < s.length; i += RICH_TEXT_LIMIT) blocks.push({ text: { content: s.slice(i, i + RICH_TEXT_LIMIT) } });
	return blocks;
}

const WRITERS = {
	title: (v) => ({ title: richText(v) }),
	rich_text: (v) => ({ rich_text: richText(v) }),
	select: (v) => ({ select: { name: String(v) } }),
	status: (v) => ({ status: { name: String(v) } }),
	multi_select: (v) => ({ multi_select: (Array.isArray(v) ? v : String(v).split(',')).map((o) => ({ name: String(o).trim() })) }),
	date: (v) => ({ date: { start: String(v) } }),
	number: (v) => ({ number: Number(v) }),
	checkbox: (v) => ({ checkbox: v === true || v === 'true' }),
	url: (v) => ({ url: String(v) }),
	email: (v) => ({ email: String(v) }),
	phone_number: (v) => ({ phone_number: String(v) }),
};

/** Convert { Name: value } to Notion properties. Unknown/empty fields are reported, not sent. */
export function buildProperties(values, schema) {
	const properties = {};
	for (const [name, value] of Object.entries(values ?? {})) {
		if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
		const write = WRITERS[schema[name]];
		if (!write) {
			const known = Object.keys(schema).join(', ');
			throw new Error(`Unknown or read-only property "${name}". Writable properties: ${known}`);
		}
		properties[name] = write(value);
	}
	return properties;
}

/** Build a Notion filter from simple options, using the schema to pick filter types. */
export function buildFilter({ status, dateProperty, dateAfter, dateBefore }, schema) {
	const filters = [];
	if (status) {
		const type = schema.Status === 'select' ? 'select' : 'status';
		filters.push({ property: 'Status', [type]: { equals: status } });
	}
	if ((dateAfter || dateBefore) && !dateProperty) throw new Error('date_property is required with date_after / date_before');
	if (dateAfter) filters.push({ property: dateProperty, date: { on_or_after: dateAfter } });
	if (dateBefore) filters.push({ property: dateProperty, date: { on_or_before: dateBefore } });
	if (filters.length === 0) return undefined;
	return filters.length === 1 ? filters[0] : { and: filters };
}

/** Counts by Status overall and within recent windows of a date property. */
export function summariseRows(rows, { dateProperty, now = new Date() } = {}) {
	const day = 86_400_000;
	const d7 = new Date(now - 7 * day).toISOString().slice(0, 10);
	const d30 = new Date(now - 30 * day).toISOString().slice(0, 10);
	const all = {}, last7 = {}, last30 = {};
	for (const row of rows) {
		const s = row.Status ?? 'No status';
		all[s] = (all[s] ?? 0) + 1;
		const d = dateProperty ? row[dateProperty] : null;
		if (d && d >= d7) last7[s] = (last7[s] ?? 0) + 1;
		if (d && d >= d30) last30[s] = (last30[s] ?? 0) + 1;
	}
	return { total: rows.length, byStatus: all, ...(dateProperty ? { last7Days: last7, last30Days: last30 } : {}) };
}

// ─── Agent tools ──────────────────────────────────────────────────────────────

const MAX_ROWS = 50;

export function notionTools(notion, databases) {
	const keys = Object.keys(databases);
	if (!keys.length) return [];
	const dbId = (key) => {
		const db = databases[key];
		if (!db) throw new Error(`Unknown database "${key}". Available: ${keys.join(', ')}`);
		return db.id;
	};
	const database = { type: 'string', enum: keys };

	return [
		{
			name: 'notion_read',
			description: `Read rows from a Notion database, newest first (max ${MAX_ROWS}). Returns each row's _id and properties. Filter by Status and/or a date property range.`,
			input_schema: {
				type: 'object',
				properties: {
					database,
					status: { type: 'string', description: 'Only rows with this Status value' },
					date_property: { type: 'string', description: 'Date property to filter on, e.g. "Last Contact"' },
					date_after: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
					date_before: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
					limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
				},
				required: ['database'],
			},
			async run({ database, status, date_property, date_after, date_before, limit = 20 }) {
				const id = dbId(database);
				const filter = buildFilter({ status, dateProperty: date_property, dateAfter: date_after, dateBefore: date_before }, await notion.schema(id));
				const rows = await notion.query(id, {
					filter,
					sorts: [{ timestamp: 'created_time', direction: 'descending' }],
					limit: Math.min(limit, MAX_ROWS),
				});
				return rows.length ? rows : 'No matching rows.';
			},
		},
		{
			name: 'notion_schema',
			description: 'List a database\'s property names and types. Use before writing to a database for the first time.',
			input_schema: { type: 'object', properties: { database }, required: ['database'] },
			run: async ({ database }) => notion.schema(dbId(database)),
		},
		{
			name: 'notion_stats',
			description: 'Count all rows in a database by Status, plus 7- and 30-day counts on a date property. Use for any "how many" or pipeline-health question instead of reading rows.',
			input_schema: {
				type: 'object',
				properties: { database, date_property: { type: 'string', description: 'Optional date property for recent-activity windows' } },
				required: ['database'],
			},
			async run({ database, date_property }) {
				const rows = await notion.query(dbId(database));
				return summariseRows(rows, { dateProperty: date_property });
			},
		},
		{
			name: 'notion_create',
			description: 'Create a row. `properties` maps exact property names to plain values (strings, numbers, arrays for multi-select).',
			input_schema: {
				type: 'object',
				properties: { database, properties: { type: 'object' } },
				required: ['database', 'properties'],
			},
			run: async ({ database, properties }) => `Created ${await notion.create(dbId(database), properties)}`,
		},
		{
			name: 'notion_update',
			description: 'Update only the given properties of an existing row (use the _id from notion_read).',
			input_schema: {
				type: 'object',
				properties: { database, page_id: { type: 'string' }, properties: { type: 'object' } },
				required: ['database', 'page_id', 'properties'],
			},
			run: async ({ database, page_id, properties }) => `Updated ${await notion.update(page_id, dbId(database), properties)}`,
		},
	];
}
