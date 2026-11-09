// One HTML file with the brief inside it: the same page the web app shows, with its styles and
// script inlined, so it can be saved, emailed or printed with nothing else attached.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './run.ts';
import type { Brief } from './types.ts';

export function standalonePage(brief: Brief): string {
  const web = join(ROOT, 'web');
  const html = readFileSync(join(web, 'index.html'), 'utf8');
  const css = readFileSync(join(web, 'style.css'), 'utf8');
  const js = readFileSync(join(web, 'app.js'), 'utf8');
  // "<" is escaped so nothing inside the brief can close the script tag.
  const data = JSON.stringify(brief).replace(/</g, '\\u003c');
  return html
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="/app.js" defer></script>', () => `<script>window.BRIEF = ${data};</script>\n<script>\n${js}\n</script>`)
    .replace('<body>', '<body class="saved">');
}
