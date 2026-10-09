/**
 * Human-in-the-loop approvals for chat.
 *
 * A job posts a proposal message and registers handlers against its ID.
 * Teammates then react ✅ (approve) / 🔄 (retry) / ❌ (reject), or reply to
 * the message with a different direction. Requests left alone expire. They
 * are cancelled, never auto-approved.
 */

export const APPROVE = '✅';
export const RETRY = '🔄';
export const REJECT = '❌';

export class Approvals {
	#pending = new Map();

	constructor({ timeoutMs = 24 * 60 * 60 * 1000 } = {}) {
		this.timeoutMs = timeoutMs;
	}

	/** handlers: { onApprove(user, direction?), onRetry?(user), onReject?(user), onExpire?() } */
	request(messageId, handlers) {
		const timer = setTimeout(() => {
			if (this.#pending.delete(messageId)) handlers.onExpire?.();
		}, this.timeoutMs);
		timer.unref?.();
		this.#pending.set(messageId, { handlers, timer });
	}

	has(messageId) {
		return this.#pending.has(messageId);
	}

	/** Returns true if the reaction resolved a pending request. */
	async react(messageId, emoji, user) {
		const handler = { [APPROVE]: 'onApprove', [RETRY]: 'onRetry', [REJECT]: 'onReject' }[emoji];
		if (!handler) return false;
		const entry = this.#take(messageId);
		if (!entry) return false;
		await entry.handlers[handler]?.(user);
		return true;
	}

	/** A text reply to a proposal: "cancel"-like words reject, anything else approves with direction. */
	async reply(messageId, text, user) {
		const entry = this.#take(messageId);
		if (!entry) return false;
		if (/^(cancel|stop|no\b|abort|don'?t)/i.test(text.trim())) await entry.handlers.onReject?.(user);
		else await entry.handlers.onApprove?.(user, text.trim());
		return true;
	}

	#take(messageId) {
		const entry = this.#pending.get(messageId);
		if (!entry) return null;
		clearTimeout(entry.timer);
		this.#pending.delete(messageId);
		return entry;
	}
}
