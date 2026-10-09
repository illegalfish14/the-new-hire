/**
 * GitHub integration: recent commits, so the agent can write "what shipped"
 * updates without anyone having to summarise the week by hand.
 */

export function createGitHub({ token, repo }, { fetch = globalThis.fetch } = {}) {
	return {
		repo,
		async recentCommits(days = 7) {
			const since = new Date(Date.now() - days * 86_400_000).toISOString();
			const res = await fetch(`https://api.github.com/repos/${repo}/commits?since=${since}&per_page=100`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github+json',
					'User-Agent': 'the-new-hire',
				},
			});
			if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
			return formatCommits(await res.json());
		},
	};
}

export function formatCommits(commits) {
	if (!commits.length) return 'No commits in this period.';
	return commits
		.filter((c) => !/^Merge (pull request|branch)/.test(c.commit.message))
		.map((c) => `- ${c.commit.author.date.slice(0, 10)} ${c.commit.message.split('\n')[0]} (${c.commit.author.name})`)
		.join('\n');
}

export function githubTools(github) {
	if (!github) return [];
	return [
		{
			name: 'github_commits',
			description: `List commits to ${github.repo} over the last N days (merge commits excluded). Use for product updates and "what shipped" questions.`,
			input_schema: {
				type: 'object',
				properties: { days: { type: 'integer', minimum: 1, maximum: 90 } },
			},
			run: ({ days = 7 }) => github.recentCommits(days),
		},
	];
}
