import { loadTables } from '../src/tables.mjs';
import { buildModel } from '../src/model.mjs';
import { linkingEvidence } from '../src/comparability.mjs';

export const FIXTURES = new URL('../fixtures/', import.meta.url);

export async function fixtureModel() {
  const { tables } = await loadTables([FIXTURES]);
  return buildModel(tables);
}

export function fixtureEvidence(model, knownCutoff = 4) {
  return linkingEvidence(model, knownCutoff);
}
