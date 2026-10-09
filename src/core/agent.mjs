/**
 * The agent loop: Claude + tool use.
 *
 * One function, `run`, takes a user turn and loops until Claude stops asking
 * for tools. Tool calls in the same turn run in parallel and their results go
 * back in a single message. The system prompt and tool list are frozen per
 * process, so they're cached across requests; anything volatile (date, chat
 * history, memory) travels in the user turn.
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function createAgent({ client, config, tools, system, log = console }) {
	const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];

	async function call(params) {
		const stream = client.beta.messages.stream({
			model: config.models.default,
			thinking: { type: 'adaptive' },
			betas: [FALLBACK_BETA],
			fallbacks: 'default',
			...params,
		});
		return stream.finalMessage();
	}

	/**
	 * @param {object} opts
	 * @param {string} opts.prompt       the user turn (instruction + context)
	 * @param {'chat'|'longform'} [opts.mode]  picks effort + output budget
	 * @param {boolean} [opts.useTools]  false for pure text jobs (e.g. summaries)
	 */
	async function run({ prompt, mode = 'chat', useTools = true, maxIterations = 12 }) {
		const messages = [{ role: 'user', content: prompt }];
		const effort = config.models.effort[mode] ?? 'medium';
		const max_tokens = mode === 'longform' ? 64000 : 16000;

		for (let i = 1; i <= maxIterations; i++) {
			const response = await call({
				max_tokens,
				output_config: { effort },
				system: systemBlocks,
				...(useTools && tools.names.length ? { tools: tools.definitions } : {}),
				messages,
			});

			if (response.stop_reason === 'refusal') {
				log.warn?.(`Refusal (${response.stop_details?.category ?? 'unknown'})`);
				return { text: "I can't help with that one.", stopReason: 'refusal', iterations: i };
			}

			messages.push({ role: 'assistant', content: response.content });

			if (response.stop_reason === 'pause_turn') continue;

			if (response.stop_reason === 'tool_use') {
				const calls = response.content.filter((b) => b.type === 'tool_use');
				const results = await Promise.all(
					calls.map(async (b) => ({ type: 'tool_result', tool_use_id: b.id, ...(await tools.execute(b.name, b.input)) })),
				);
				messages.push({ role: 'user', content: results });
				continue;
			}

			const text = textOf(response);
			if (response.stop_reason === 'max_tokens') log.warn?.('Response hit max_tokens and may be truncated');
			return { text: text || '(no response)', stopReason: response.stop_reason, iterations: i };
		}

		return {
			text: `I hit my step limit (${maxIterations}) before finishing. Try breaking the request into smaller pieces.`,
			stopReason: 'max_iterations',
			iterations: maxIterations,
		};
	}

	return { run };
}

export function textOf(message) {
	return message.content
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('')
		.trim();
}
