import assert from 'node:assert';
import { toHtml } from './markdown.js';
const html = toHtml('a <img src=x onerror=alert(1)> [l](javascript:alert(1)) [ok](https://x.dev) ![i](https://x/y.png) **b**\n\n<script>alert(1)</script>');
assert(!/<img|<script|javascript:/.test(html));
assert(html.includes('<strong>b</strong>') && html.includes('href="https://x.dev"'));
console.log('ok');
