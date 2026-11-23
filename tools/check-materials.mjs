import { pathToFileURL } from 'node:url';
import { checkLinks, loadTables, parseTable } from '../src/tables.mjs';

const folder = new URL('../fixtures/', import.meta.url);

export { checkLinks, parseTable };

export async function checkMaterials(source = folder) {
  const { counts } = await loadTables([source]);
  return counts;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const counts = await checkMaterials();
  console.log(JSON.stringify({ 状态: '资料可读取', 记录数: counts }, null, 2));
}
