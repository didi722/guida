import { html } from '../html.js';
import { fmtDate } from '../time.js';
import { page } from './layout.js';
import { reviewLinks } from '../emails.js';

export function feedbackPage(ctx, b, { existing = null, done = false, error = '' } = {}) {
  const { t, lang, app } = ctx;
  const ti = app.content.tour(b.tour_slug).i18n[lang];
  const links = reviewLinks(app, lang);
  const body = done
    ? html`<section class="page-head"><div class="wrap narrow">
  <div class="status status-ok"><span class="status-dot" aria-hidden="true"></span><div><h1>${t('fb.thanksTitle')}</h1><p class="lead">${t('fb.thanksText')}</p></div></div>
</div></section>
${links.length
  ? html`<section class="section tight"><div class="wrap narrow"><div class="card pad"><h2>${t('fb.publicTitle')}</h2><p class="muted">${t('fb.publicText')}</p>
  <p class="btn-row">${links.map(([url, label], i) => html`<a class="btn ${i === 0 ? 'btn-gold' : 'btn-outline'}" href="${url}" rel="noopener" target="_blank">${label}</a>`)}</p></div></div></section>`
  : ''}`
    : html`<section class="page-head"><div class="wrap narrow"><h1>${t('fb.title')}</h1><p class="lead">${t('fb.lead')}</p><p class="muted">${ti.title} · ${fmtDate(b.date, lang)}</p></div></section>
<section class="section tight"><div class="wrap narrow">
  <form class="card pad form" method="post" action="/${lang}/feedback/${b.ref}">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    ${existing ? html`<div class="notice notice-ok">${t('fb.already')}</div>` : ''}
    <input type="hidden" name="t" value="${b.token}">
    <fieldset class="stars"><legend class="label">${t('fb.rating')}</legend>
      <div class="star-row">${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" id="star${n}" name="rating" value="${n}" ${existing?.rating === n ? 'checked' : ''} required><label for="star${n}" title="${t('fb.star', { n })}"><span class="sr-only">${t('fb.star', { n })}</span>★</label>`)}</div>
    </fieldset>
    <label class="field"><span class="label">${t('fb.comment')} <em>${t('f.optional')}</em></span><textarea name="comment" rows="5" maxlength="1500" placeholder="${t('fb.commentHint')}">${existing?.comment ?? ''}</textarea></label>
    <label class="check"><input type="checkbox" name="may_publish" value="1" ${existing?.may_publish ? 'checked' : ''}> ${t('fb.publish')}</label>
    <button class="btn btn-gold" type="submit">${t('fb.send')}</button>
  </form>
</div></section>`;
  return page(ctx, { title: t('fb.title'), path: `/${lang}/feedback/${b.ref}`, body, noindex: true });
}
