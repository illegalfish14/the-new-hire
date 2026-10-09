import analyst from './analyst.mjs';
import writer from './writer.mjs';
import social from './social.mjs';
import pipeline from './pipeline.mjs';
import digest from './digest.mjs';
import memory from './memory.mjs';

/** Order here is the order agent instructions appear in the system prompt. */
export const ALL_AGENTS = [analyst, writer, social, pipeline, digest, memory];
