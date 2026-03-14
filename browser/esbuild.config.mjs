import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const sharedOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
  minify: !isWatch,
  logLevel: 'info',
  alias: {
    '@shared': '../shared',
  },
};

const entryPoints = [
  { in: 'src/service-worker.ts', out: 'service-worker' },
  { in: 'src/content/index.ts', out: 'content' },
  { in: 'src/popup/popup.ts', out: 'popup' },
  { in: 'src/sidepanel/sidepanel.ts', out: 'sidepanel' },
];

const buildOptions = {
  ...sharedOptions,
  entryPoints: entryPoints.map((ep) => ({ in: ep.in, out: ep.out })),
  outdir: 'dist',
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
