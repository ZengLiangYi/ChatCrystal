import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateExperienceGateSamples,
  formatExperienceGateEvalReport,
  loadExperienceGateEvalSamples,
} from '../src/services/experience/evaluation.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultSamplesPath = resolve(
  scriptDir,
  '../src/services/experience/eval-samples.json',
);
const samplesPath = process.argv[2] ?? defaultSamplesPath;

try {
  const samples = loadExperienceGateEvalSamples(samplesPath);
  const summary = evaluateExperienceGateSamples(samples);
  console.log(formatExperienceGateEvalReport(summary));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Experience gate evaluation failed',
  );
  process.exitCode = 1;
}
