/**
 * Split text into chunks no longer than `max`, preferring line boundaries.
 * Lines longer than `max` are hard-split so nothing is ever dropped.
 */
export function chunkText(text, max = 1900) {
	const chunks = [];
	let current = '';
	for (const line of String(text).split('\n')) {
		const pieces = line.length > max ? line.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [line];
		for (const piece of pieces) {
			const candidate = current ? `${current}\n${piece}` : piece;
			if (candidate.length > max) {
				if (current.trim()) chunks.push(current);
				current = piece;
			} else {
				current = candidate;
			}
		}
	}
	if (current.trim()) chunks.push(current);
	return chunks;
}

/** Render a context section for the user turn, or '' when there's nothing to show. */
export function section(title, body) {
	if (!body || !String(body).trim()) return '';
	return `\n\n<${title}>\n${String(body).trim()}\n</${title}>`;
}

export function isoDate(d = new Date(), timeZone = 'UTC') {
	return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
