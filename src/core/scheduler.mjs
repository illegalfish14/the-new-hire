import cron from 'node-cron';

/**
 * Collects `jobs` from every enabled agent into a flat registry keyed
 * "agent.job", and wires the config's schedule entries to them.
 */
export function collectJobs(agents) {
	const jobs = new Map();
	for (const agent of agents) {
		for (const [name, fn] of Object.entries(agent.jobs ?? {})) jobs.set(`${agent.name}.${name}`, fn);
	}
	return jobs;
}

/** Returns a list of problems with the schedule (unknown jobs, bad cron syntax). */
export function checkSchedule(schedule, jobs) {
	const problems = [];
	for (const entry of schedule) {
		if (!jobs.has(entry.job)) problems.push(`Unknown job "${entry.job}" (is that agent enabled?)`);
		if (!cron.validate(entry.cron)) problems.push(`Invalid cron "${entry.cron}" for ${entry.job}`);
	}
	return problems;
}

export function startSchedule({ schedule, jobs, timezone, runJob, log = console }) {
	const tasks = [];
	for (const entry of schedule) {
		if (!jobs.has(entry.job) || !cron.validate(entry.cron)) continue;
		tasks.push(cron.schedule(entry.cron, () => runJob(entry.job, 'schedule'), { timezone, name: entry.job }));
		log.info?.(`Scheduled ${entry.job} @ "${entry.cron}" (${timezone})`);
	}
	return () => tasks.forEach((t) => t.stop());
}
