/**
 * Discord adapter. Everything Discord-specific lives here; agents and jobs
 * only see the small `chat` interface below, so another chat platform
 * (Slack, Teams) can be added as a sibling file.
 *
 *   chat.post(channelName, text, { approval }) -> { id }
 *   chat.channelNames()                        -> string[]
 *   chat.recentMessages(channelName, opts)     -> [{ author, text, at }]
 */

import { Client, Events, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { chunkText } from '../core/text.mjs';
import { APPROVE, RETRY, REJECT } from '../core/approvals.mjs';

export function createDiscordChat({ token, log = console }) {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildMessageReactions,
		],
		partials: [Partials.Message, Partials.Channel, Partials.Reaction],
	});
	client.on(Events.Error, (err) => log.error(`Discord error: ${err.message}`));

	const textChannels = () =>
		[...client.guilds.cache.values()].flatMap((g) =>
			[...g.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText && c.viewable),
		);

	const findChannel = (name) => {
		const channel = textChannels().find((c) => c.name === name);
		if (!channel) throw new Error(`Channel #${name} not found (or the bot can't see it)`);
		return channel;
	};

	async function send(channel, text) {
		let first;
		for (const chunk of chunkText(text)) {
			const msg = await channel.send(chunk);
			first ??= msg;
		}
		return first;
	}

	const clean = (m) => m.content.replace(/<@!?\d+>/g, '').trim();

	async function fetchRecent(channel, { sinceMs = 86_400_000, before, limit = 100, includeBots = true } = {}) {
		const fetched = await channel.messages.fetch({ limit, before });
		const cutoff = Date.now() - sinceMs;
		return [...fetched.values()]
			.filter((m) => m.createdTimestamp > cutoff && (includeBots || !m.author.bot) && clean(m))
			.reverse()
			.map((m) => ({ author: m.author.bot ? `[bot] ${m.author.username}` : m.author.username, text: clean(m), at: m.createdAt }));
	}

	const chat = {
		async post(channelName, text, { approval = false } = {}) {
			const msg = await send(findChannel(channelName), text);
			if (approval) for (const e of [APPROVE, RETRY, REJECT]) await msg.react(e);
			return { id: msg.id };
		},
		channelNames: () => textChannels().map((c) => c.name),
		recentMessages: (channelName, opts) => fetchRecent(findChannel(channelName), opts),
	};

	/**
	 * handlers:
	 *   onMention({ text, author, channelName, history, reply })
	 *   onReply({ referencedId, text, author }) -> boolean (handled?)
	 *   onReaction({ messageId, emoji, author })
	 */
	async function start(handlers) {
		const startedAt = Date.now();

		client.on(Events.MessageCreate, async (message) => {
			if (message.author.bot || message.createdTimestamp < startedAt) return;

			if (message.reference?.messageId) {
				const handled = await handlers.onReply({ referencedId: message.reference.messageId, text: clean(message), author: message.author.username });
				if (handled) return void message.react('👍').catch(() => {});
			}

			if (!message.mentions.has(client.user)) return;
			const text = clean(message);
			if (!text) return;

			await message.channel.sendTyping();
			const placeholder = await message.reply('On it…');
			const reply = async (out) => {
				const [first, ...rest] = chunkText(out);
				await placeholder.edit(first ?? '(empty response)');
				for (const chunk of rest) await message.channel.send(chunk);
			};

			try {
				const history = await fetchRecent(message.channel, { before: message.id, limit: 30 });
				await handlers.onMention({ text, author: message.author.username, channelName: message.channel.name, history, reply });
			} catch (err) {
				log.error(`Handler error: ${err.stack ?? err.message}`);
				await placeholder.edit('Something went wrong. Check the logs.').catch(() => {});
			}
		});

		client.on(Events.MessageReactionAdd, async (reaction, user) => {
			if (user.bot) return;
			if (reaction.partial) await reaction.fetch().catch(() => null);
			await handlers.onReaction({ messageId: reaction.message.id, emoji: reaction.emoji.name, author: user.username });
		});

		await new Promise((resolve, reject) => {
			client.once(Events.ClientReady, resolve);
			client.login(token).catch(reject);
		});
		log.info(`Discord connected as ${client.user.tag}`);
	}

	return { chat, start, stop: () => client.destroy() };
}
