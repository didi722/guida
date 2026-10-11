// Illustrazioni SVG segnaposto (stile "carta e inchiostro", nella palette del sito).
// Servono finché non ci sono foto vere: ogni tour/articolo può indicare `image:` per sostituirle.
import { raw } from './html.js';

const WAVES = `
  <path class="a-water" d="M0 372 H800 V500 H0Z"/>
  <g class="a-wave" fill="none" stroke-width="2" stroke-linecap="round">
    <path d="M40 400 q20 -10 40 0 t40 0 t40 0 t40 0"/><path d="M300 430 q20 -10 40 0 t40 0 t40 0"/>
    <path d="M520 395 q20 -10 40 0 t40 0 t40 0 t40 0"/><path d="M130 455 q20 -10 40 0 t40 0 t40 0 t40 0"/>
    <path d="M590 462 q20 -10 40 0 t40 0 t40 0"/>
  </g>`;

const SUN = `<circle class="a-sun" cx="610" cy="150" r="64"/>`;

const SCENES = {
  // San Marco: campanile, cupole, facciata con archi
  dome: `${SUN}
    <g class="a-ink">
      <rect x="120" y="120" width="42" height="252"/><path d="M114 120 h54 l-27 -50z"/><rect x="127" y="150" width="28" height="30" class="a-cut"/>
      <rect x="230" y="270" width="470" height="102"/>
      <path d="M270 270 q40 -80 80 0z"/><path d="M370 270 q50 -100 100 0z"/><path d="M490 270 q40 -80 80 0z"/><path d="M590 270 q30 -60 60 0z"/>
      <rect x="318" y="196" width="6" height="30"/><rect x="418" y="160" width="6" height="40"/><rect x="528" y="196" width="6" height="30"/>
    </g>
    <g class="a-cut">${[250, 300, 350, 400, 450, 500, 550, 600, 650].map((x) => `<path d="M${x} 372 v-48 a14 14 0 0 1 28 0 v48z"/>`).join('')}</g>
    ${WAVES}`,
  // Rialto: arco del ponte con case
  bridge: `${SUN}
    <g class="a-ink">
      <path d="M60 330 Q400 150 740 330 V372 H60Z"/>
      <rect x="150" y="296" width="500" height="20" class="a-cut"/>
      <path d="M130 372 h540 v-18 H130z"/>
    </g>
    <path class="a-cut" d="M250 372 Q400 250 550 372z"/>
    <g class="a-ink"><rect x="40" y="250" width="90" height="122"/><rect x="670" y="236" width="90" height="136"/><path d="M40 250 l45 -30 45 30z"/><path d="M670 236 l45 -30 45 30z"/></g>
    <g class="a-cut">${[60, 90, 690, 720].map((x) => `<rect x="${x}" y="280" width="16" height="26"/>`).join('')}</g>
    ${WAVES}`,
  // Ghetto: case alte e strette, finestre, altane
  ghetto: `<circle class="a-sun" cx="150" cy="140" r="54"/>
    <g class="a-ink">
      <rect x="90" y="190" width="120" height="182"/><rect x="220" y="140" width="110" height="232"/><rect x="340" y="170" width="130" height="202"/><rect x="480" y="110" width="110" height="262"/><rect x="600" y="180" width="120" height="192"/>
      <rect x="520" y="82" width="30" height="28"/><rect x="250" y="116" width="26" height="24"/>
    </g>
    <g class="a-cut">${[[110, 215], [150, 215], [110, 275], [150, 275], [240, 170], [280, 170], [240, 235], [280, 235], [240, 300], [280, 300], [360, 200], [410, 200], [360, 265], [410, 265], [500, 140], [545, 140], [500, 210], [545, 210], [500, 280], [545, 280], [620, 210], [670, 210], [620, 280], [670, 280]].map(([x, y]) => `<rect x="${x}" y="${y}" width="22" height="34" rx="11"/>`).join('')}</g>
    ${WAVES}`,
  // Arsenale: portale e torri merlate
  arsenal: `${SUN}
    <g class="a-ink"><rect x="130" y="180" width="110" height="192"/><rect x="560" y="180" width="110" height="192"/><rect x="240" y="250" width="320" height="122"/>
      ${[130, 160, 190, 220].map((x) => `<rect x="${x}" y="164" width="20" height="16"/>`).join('')}${[560, 590, 620, 650].map((x) => `<rect x="${x}" y="164" width="20" height="16"/>`).join('')}
      <path d="M300 250 L400 170 L500 250z"/></g>
    <path class="a-cut" d="M350 372 v-70 a50 50 0 0 1 100 0 v70z"/>
    ${WAVES}`,
  // Oriente/Occidente: archi ogivali, mezzaluna e croce
  eastwest: `<circle class="a-sun" cx="400" cy="150" r="70"/>
    <g class="a-ink"><rect x="120" y="230" width="560" height="142"/>
      <path d="M120 230 h560 v-14 H120z"/>
      <rect x="395" y="80" width="10" height="60"/><rect x="380" y="96" width="40" height="8"/>
      <path d="M180 216 q30 -50 60 0z"/><path d="M560 216 q30 -50 60 0z"/></g>
    <g class="a-cut">${[150, 230, 310, 390, 470, 550].map((x) => `<path d="M${x} 372 v-60 q0 -40 30 -50 q30 10 30 50 v60z"/>`).join('')}</g>
    <path class="a-ink" d="M262 50 a22 22 0 1 0 18 38 a18 18 0 1 1 -18 -38z" transform="translate(-130 40)"/>
    ${WAVES}`,
  // Isole: case colorate, campanile
  islands: `${SUN}
    <g class="a-ink">
      <rect x="60" y="300" width="80" height="72"/><rect x="150" y="280" width="90" height="92"/><rect x="250" y="310" width="70" height="62"/>
      <rect x="520" y="130" width="46" height="242"/><path d="M514 130 h58 l-29 -44z"/>
      <rect x="360" y="290" width="130" height="82"/><rect x="580" y="300" width="100" height="72"/><rect x="690" y="320" width="70" height="52"/>
      <path d="M60 300 l40 -26 40 26z"/><path d="M150 280 l45 -28 45 28z"/><path d="M360 290 l65 -34 65 34z"/>
    </g>
    <g class="a-cut">${[[80, 320], [105, 320], [170, 305], [205, 305], [270, 330], [385, 310], [430, 310], [600, 320], [635, 320], [708, 338]].map(([x, y]) => `<rect x="${x}" y="${y}" width="16" height="22" rx="2"/>`).join('')}</g>
    ${WAVES}`,
  // Passeggiata: ombrello/calle con persone
  walk: `<circle class="a-sun" cx="650" cy="130" r="56"/>
    <g class="a-ink"><rect x="50" y="170" width="190" height="202"/><rect x="560" y="190" width="190" height="182"/><path d="M240 372 V200 l160 -60 160 60 V372z" class="a-cut"/></g>
    <g class="a-ink"><circle cx="360" cy="296" r="10"/><path d="M350 308 h20 l6 52 h-32z"/><circle cx="410" cy="300" r="9"/><path d="M401 311 h18 l5 49 h-28z"/><path d="M432 300 q22 -34 44 0z" /><rect x="453" y="300" width="2" height="60"/></g>
    <g class="a-cut">${[[80, 200], [140, 200], [80, 270], [140, 270], [600, 220], [660, 220], [600, 290], [660, 290]].map(([x, y]) => `<rect x="${x}" y="${y}" width="28" height="44" rx="14"/>`).join('')}</g>
    ${WAVES}`,
  // Pali: tronchi nel fango
  piles: `${SUN}
    <g class="a-ink">${Array.from({ length: 22 }, (_, i) => `<rect x="${60 + i * 32}" y="${230 + ((i * 37) % 40)}" width="14" height="${142 - ((i * 37) % 40)}" rx="3"/>`).join('')}</g>
    <path class="a-ink" d="M0 372 H800 V500 H0Z"/>
    <g class="a-cut">${Array.from({ length: 12 }, (_, i) => `<rect x="${40 + i * 66}" y="${400 + ((i * 29) % 70)}" width="40" height="5" rx="2"/>`).join('')}</g>`,
  // Bacaro: facciata con porta ad arco, lanterna e bancone con calici
  bacaro: `<circle class="a-sun" cx="650" cy="130" r="54"/>
    <g class="a-ink">
      <rect x="50" y="140" width="330" height="232"/><rect x="40" y="128" width="350" height="18"/>
      <rect x="395" y="300" width="350" height="72"/><rect x="0" y="372" width="800" height="128"/>
      <rect x="392" y="168" width="8" height="64"/><rect x="392" y="168" width="52" height="6"/>
      ${[470, 560, 650].map((x) => `<path d="M${x} 300 l-4 -34 h28 l-4 34z"/><rect x="${x + 6}" y="300" width="4" height="22"/>`).join('')}
    </g>
    <g class="a-cut">
      <path d="M95 372 v-120 a45 45 0 0 1 90 0 v120z"/><path d="M225 270 v-56 a32 32 0 0 1 64 0 v56z"/><path d="M310 270 v-56 a32 32 0 0 1 60 0 v56z"/>
      <path d="M432 174 h24 l-4 38 h-16z"/>
      ${[470, 560, 650].map((x) => `<path d="M${x - 1} 278 l-2 -12 h22 l-2 12z" opacity=".7"/>`).join('')}
    </g>
    <path class="a-wave" d="M60 420 q20 -10 40 0 t40 0 t40 0 M420 430 q20 -10 40 0 t40 0 t40 0 t40 0" fill="none" stroke-width="2" stroke-linecap="round"/>`,
};

export const ART_KEYS = Object.keys(SCENES);

/** SVG a tutta larghezza, ritagliato (slice) come un'immagine di copertina. */
export function art(key, { label = '' } = {}) {
  const scene = SCENES[key] ?? SCENES.dome;
  return raw(
    `<svg class="art art-${key in SCENES ? key : 'dome'}" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label.replace(/"/g, '&quot;')}" xmlns="http://www.w3.org/2000/svg"><rect class="a-sky" width="800" height="500"/>${scene}</svg>`,
  );
}
