// Controlli comuni alle pagine dell'area agenzie.

/** Dove si va dopo l'accesso: solo percorsi interni del sito (mai indirizzi esterni). */
export const safeNext = (n) => (typeof n === 'string' && /^\/[a-z]{2}\/[^/]/.test(n) && !n.startsWith('//') ? n : '');

export const toLogin = (req, res) => res.redirect(`/${req.lang}/b2b/login?next=${encodeURIComponent(req.originalUrl)}`);

/** Serve un account approvato: chi non ha fatto il login va al modulo (e poi torna qui), chi è ancora in attesa alla pagina di stato. */
export const needPartner = (req, res, next) => {
  if (!req.acct) return toLogin(req, res);
  if (req.acct.status !== 'approved') return res.redirect(303, `/${req.lang}/b2b/account`);
  next();
};
