import { oversizedPagesAssets } from './lib/pages-assets.mjs';
const failures = await oversizedPagesAssets('dist');
if (failures.length) throw new Error(`Pages assets exceed 25 MiB:\n${failures.join('\n')}`);
console.log('[pages-assets] All files are within the 25 MiB Pages limit');
