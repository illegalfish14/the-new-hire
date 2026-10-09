/**
 * Tool registry. Integrations contribute tools as:
 *   { name, description, input_schema, run: async (input) => string }
 *
 * Definitions are sorted by name so the tool block is byte-stable between
 * requests, which keeps the prompt cache warm.
 */
export class ToolRegistry {
	#tools = new Map();

	constructor(log = console) {
		this.log = log;
	}

	register(...tools) {
		for (const tool of tools.flat().filter(Boolean)) {
			if (this.#tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
			if (typeof tool.run !== 'function') throw new Error(`Tool ${tool.name} has no run()`);
			this.#tools.set(tool.name, tool);
		}
		return this;
	}

	get names() {
		return [...this.#tools.keys()].sort();
	}

	get definitions() {
		return this.names.map((name) => {
			const { description, input_schema } = this.#tools.get(name);
			return { name, description, input_schema };
		});
	}

	/** Returns a tool_result body: { content, is_error? }. Never throws. */
	async execute(name, input) {
		const tool = this.#tools.get(name);
		if (!tool) return { content: `Unknown tool: ${name}`, is_error: true };
		try {
			this.log.info?.(`→ ${name} ${JSON.stringify(input).slice(0, 160)}`);
			const out = await tool.run(input ?? {});
			const content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
			this.log.info?.(`← ${name} ${content.slice(0, 160)}`);
			return { content };
		} catch (err) {
			this.log.error?.(`✗ ${name}: ${err.message}`);
			return { content: `${name} failed: ${err.message}`, is_error: true };
		}
	}
}
