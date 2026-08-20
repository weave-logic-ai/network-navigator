#!/usr/bin/env node
// Internal-link checker for the Fumadocs site.
//
// docs/ is a thin Fumadocs wrapper (see docs/src/lib/source.ts) — there is no
// application logic of our own to unit test. The one thing that IS real and
// regresses silently is cross-references between MDX pages: renaming or
// deleting a page leaves any `/docs/...` links pointing at it broken, and
// nothing else in the toolchain (next build, tsc) catches that — MDX content
// isn't statically typed.
//
// This script walks every .mdx file under content/docs and every .tsx file
// under src, extracts `/docs/...` links (markdown `](...)` and JSX
// `href="..."`), and checks each one resolves to a real page — derived from
// the actual file tree, the same way fumadocs-core's `loader()` derives
// routes, not from a hand-maintained list.
//
// Usage: node scripts/check-links.mjs   (run from docs/)
// Exit code 0 = all internal links resolve. Exit code 1 = at least one does not.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const contentDir = join(docsRoot, 'content', 'docs');
const srcDir = join(docsRoot, 'src');

/** Recursively collect file paths under `dir` matching `extensions`. */
function walk(dir, extensions) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Derive the set of valid `/docs/...` routes from the content tree, mirroring
 * how fumadocs-core's `loader({ baseUrl: '/docs' })` resolves slugs:
 * `content/docs/index.mdx` -> `/docs`, `content/docs/foo/index.mdx` ->
 * `/docs/foo`, `content/docs/foo/bar.mdx` -> `/docs/foo/bar`.
 */
function validRoutes() {
  const mdxFiles = walk(contentDir, ['.mdx', '.md']);
  const routes = new Set();
  for (const file of mdxFiles) {
    const rel = relative(contentDir, file).split(sep).join('/');
    const withoutExt = rel.replace(/\.mdx?$/, '');
    const withoutIndex = withoutExt.replace(/(^|\/)index$/, '');
    const route = withoutIndex ? `/docs/${withoutIndex}` : '/docs';
    routes.add(route);
  }
  return routes;
}

/** Extract `/docs/...` link targets (markdown + JSX href) from a file's text. */
function extractLinks(text) {
  const links = [];
  const mdLinkRe = /\]\((\/docs\/[^)\s]+)\)/g;
  const hrefRe = /href=["'](\/docs\/[^"'\s]+)["']/g;
  for (const re of [mdLinkRe, hrefRe]) {
    let m;
    while ((m = re.exec(text))) {
      links.push(m[1]);
    }
  }
  return links;
}

function stripFragmentAndQuery(link) {
  return link.split('#')[0].split('?')[0].replace(/\/$/, '') || '/docs';
}

function main() {
  const routes = validRoutes();
  const sourceFiles = [
    ...walk(contentDir, ['.mdx', '.md']),
    ...walk(srcDir, ['.tsx', '.ts']),
  ];

  const broken = [];
  let checked = 0;

  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    const links = extractLinks(text);
    for (const raw of links) {
      checked += 1;
      const target = stripFragmentAndQuery(raw);
      if (!routes.has(target)) {
        broken.push({ file: relative(docsRoot, file), raw, target });
      }
    }
  }

  if (broken.length > 0) {
    console.error(`Found ${broken.length} broken internal link(s):\n`);
    for (const b of broken) {
      console.error(`  ${b.file}: ${b.raw}  (no page at ${b.target})`);
    }
    console.error(`\n${routes.size} valid page(s) discovered under content/docs.`);
    process.exit(1);
  }

  console.log(
    `OK: ${checked} internal /docs/... link(s) across ${sourceFiles.length} file(s) all resolve (${routes.size} pages).`
  );
}

main();
