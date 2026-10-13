import { html, raw } from '../html.js';
import { adminLayout } from './admin.js';

export function guidePage(ctx, { html: content }) {
  const body = html`<div class="guide prose">${raw(content)}</div><a class="guide-top" href="#indice">↑ Indice</a>`;
  return adminLayout(ctx, { title: 'Guida all’uso del sito', active: '/admin/guide', body });
}
