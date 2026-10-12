// Cron schedules shared by the Worker configuration and its scheduled handler, which tells the jobs
// apart by the firing schedule. cloudflare.config.ts repeats them as literals (its loader cannot
// import application modules); tests/discover-declared-level.test.ts checks they match.

/** Catalogue acquisition, metadata refresh, analysis verification and metrics. */
export const CATALOGUE_CRON = '*/15 * * * *';
/**
 * Nightly difficulty analysis of catalogue videos without a level. Workers AI's free daily
 * allocation resets at 00:00 UTC, so this spends what learners left unused in the last four hours
 * of the UTC day. Offset from the catalogue run so the two never start together.
 */
export const ANALYSIS_CRON = '7,22,37,52 20-23 * * *';
