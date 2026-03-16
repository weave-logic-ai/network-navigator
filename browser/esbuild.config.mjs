import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const sharedOptions = {
  bundle: true,
  target: 'chrome120',
  sourcemap: true,
  minify: !isWatch,
  logLevel: 'info',
};

// Service worker must be ESM (manifest declares "type": "module")
const swBuild = {
  ...sharedOptions,
  entryPoints: [{ in: 'src/service-worker.ts', out: 'service-worker' }],
  outdir: 'dist',
  format: 'esm',
};

// Popup, content script, and sidepanel use IIFE (no module import needed)
const pageBuild = {
  ...sharedOptions,
  entryPoints: [
    { in: 'src/content/index.ts', out: 'content' },
    { in: 'src/popup/popup.ts', out: 'popup' },
    { in: 'src/sidepanel/sidepanel.ts', out: 'sidepanel' },
  ],
  outdir: 'dist',
  format: 'iife',
};

if (isWatch) {
  const ctx1 = await esbuild.context(swBuild);
  const ctx2 = await esbuild.context(pageBuild);
  await Promise.all([ctx1.watch(), ctx2.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(swBuild),
    esbuild.build(pageBuild),
  ]);
}
