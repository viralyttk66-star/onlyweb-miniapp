// Build Vercel : recopie la section « Nos réalisations » du site ONLYWEB (Lovable) dans la mini app.
// Le site est la source : on récupère son HTML, son CSS et son script, on les adapte à Telegram,
// et on écrit dist/ (index.html + rd.js + rd.css + polices). Si le site change de structure,
// la mini app garde son ancienne section (fallback inclus dans index.html) au lieu de casser.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const SITE = "https://onlyweb-telegram-atelier.lovable.app";
const OUT = "dist";

async function texte(url) {
  const r = await fetch(url, { headers: { "user-agent": "onlyweb-miniapp-build" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

// Bloc entre accolades qui commence à `i` (index de « { »), renvoie l'index après « } ».
function finBloc(s, i) {
  let p = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "{") p++;
    else if (s[k] === "}" && --p === 0) return k + 1;
  }
  return -1;
}

// Classes utilisées par la section (lues dans son script), pour savoir où s'arrête son CSS.
export function classesDe(code) {
  const set = new Set();
  for (const m of code.matchAll(/class=\\?"([^"\\$]+)/g)) m[1].split(/\s+/).forEach(c => c && set.add(c));
  return set;
}

export function extraireCss(css, classes) {
  const debut = css.indexOf(".rd{isolation");
  if (debut < 0) throw new Error("css : .rd introuvable");
  const utilise = sel => [...sel.matchAll(/\.([\w-]+)/g)].some(m => classes.has(m[1]) || /^rd(-|$)/.test(m[1]));
  let i = debut, out = "";
  while (i < css.length) {
    const ouv = css.indexOf("{", i);
    if (ouv < 0) break;
    const sel = css.slice(i, ouv);
    const fin = finBloc(css, ouv);
    const bloc = css.slice(i, fin);
    const garde = /^@(keyframes|property)/.test(sel) ||(sel.startsWith("@") ? utilise(bloc) : utilise(sel));
    if (!garde) break;
    out += bloc;
    i = fin;
  }
  // Les @keyframes utilisés par la section, où qu'ils soient dans le fichier.
  const noms = new Set([...out.matchAll(/animation(?:-name)?:([^;}]+)/g)].flatMap(m => m[1].split(",").map(x => x.trim().split(/\s+/)).flat()));
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    if (noms.has(m[1]) && !out.includes(`@keyframes ${m[1]}{`) && !out.includes(`@keyframes ${m[1]} {`)) {
      out += css.slice(m.index, finBloc(css, m.index + m[0].length - 1));
    }
  }
  return out;
}

export function extraireJs(js) {
  const sec = js.indexOf('id="realisations"');
  if (sec < 0) throw new Error("js : section introuvable");
  const f = /function (\w+)\(e\)\{let t=e\.querySelector\(`#realisations`\)/.exec(js);
  if (!f) throw new Error("js : fonction introuvable");
  const nomFn = f[1];
  const enveloppe = new RegExp(`function \\w+\\(\\)\\{let \\w+=\\(0,\\w+\\.useRef\\)\\(null\\);return\\(0,\\w+\\.useEffect\\)\\(\\(\\)=>\\{if\\(\\w+\\.current\\)return ${nomFn}\\(\\w+\\.current\\)\\},\\[\\]\\),\\(0,\\w+\\.jsx\\)\\(\`div\`,\\{ref:\\w+,dangerouslySetInnerHTML:\\{__html:(\\w+)\\}\\}\\)\\}`).exec(js);
  if (!enveloppe) throw new Error("js : composant introuvable");
  const nomHtml = enveloppe[1];
  const fin = enveloppe.index;
  const avant = js.lastIndexOf("dangerouslySetInnerHTML:{__html:", sec);
  const debut = js.indexOf("var ", avant);
  if (avant < 0 || debut < 0 || debut > sec) throw new Error("js : début introuvable");
  return { code: js.slice(debut, fin), nomFn, nomHtml };
}

export function adapterHtml(nomHtml) {
  // Ajustements Telegram, appliqués sur le HTML final avant l'insertion.
  return `var __rdHtml=${nomHtml}
  .replace('class="rd-link nx-go" href="#contact"', 'class="rd-link nx-go" href="#" data-aller="brief"')
  .replace(/<a class="rd-link" href="(https:[^"]+)"/g, '<a class="rd-link" href="$1" data-externe')`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let index = await readFile("index.html", "utf8");
  try {
    const page = await texte(SITE + "/");
    const fichiers = new Set([...page.matchAll(/\/assets\/[\w.-]+\.(?:js|css)/g)].map(m => m[0]));
    const contenus = {};
    const lire = async u => (contenus[u] ??= await texte(SITE + u));
    for (const u of [...fichiers]) {
      const t = await lire(u);
      if (u.endsWith(".js")) for (const m of t.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)) fichiers.add("/" + m[0]);
    }
    let js = null, css = null;
    for (const u of fichiers) {
      const t = await lire(u);
      if (!js && u.endsWith(".js") && t.includes('id="realisations"') && t.includes("rd-live")) js = t;
      if (!css && u.endsWith(".css") && t.includes(".rd-shell")) css = t;
    }
    if (!js || !css) throw new Error("fichiers du site introuvables");
    const { code, nomFn, nomHtml } = extraireJs(js);
    let rdCss = extraireCss(css, classesDe(code));

    // Polices Amsi Pro du site, copiées dans la mini app (même origine, pas de souci CORS).
    await mkdir(`${OUT}/fonts`, { recursive: true });
    const tousCss = (await Promise.all([...fichiers].filter(u => u.endsWith(".css")).map(lire))).join("\n") + page;
    const faces = [...new Set([...tousCss.matchAll(/@font-face\s*\{[^}]*Amsi[^}]*\}/g)].map(m => m[0]))];
    for (const face of faces) {
      for (const m of face.matchAll(/url\((["']?)(\/fonts\/[\w.-]+)\1\)/g)) {
        const r = await fetch(SITE + m[2]);
        if (r.ok) await writeFile(OUT + m[2], Buffer.from(await r.arrayBuffer()));
      }
    }
    const reglages = `
#rd-host .rd{width:auto;margin-left:calc(-1*max(16px,env(safe-area-inset-left,0px)));margin-right:calc(-1*max(16px,env(safe-area-inset-right,0px)));margin-top:44px}
`;
    // Base équivalente au reset du site (Tailwind), limitée à la section et placée avant son CSS.
    const base = `
.rd{font-size:16px;font-weight:400;line-height:1.5;letter-spacing:normal;text-align:left}
.rd :where(*,::before,::after){border:0 solid;box-sizing:border-box}
.rd :where(h1,h2,h3,h4,h5,h6,p,ul,ol,figure,blockquote){margin:0}
.rd :where(ul,ol){list-style:none;padding:0}
.rd :where(h1,h2,h3,h4,h5,h6){font-size:inherit;font-weight:inherit;line-height:inherit;letter-spacing:inherit;text-transform:none;font-family:inherit;text-wrap:wrap}
.rd :where(img,svg,video,iframe){display:block;vertical-align:middle}
.rd :where(img,video){max-width:100%;height:auto}
.rd :where(b,strong){font-weight:bolder}
.rd :where(a){color:inherit;text-decoration:inherit}
`;
    rdCss = faces.join("\n") + "\n" + base + rdCss + reglages;
    const rdJs = `/* Section « Nos réalisations » reprise du site ONLYWEB au build. */
(function(){try{
${code}
${adapterHtml(nomHtml)};
var h=document.getElementById("rd-host");if(!h)return;
h.innerHTML=__rdHtml;
${nomFn}(h);
}catch(err){console.warn("rd",err)}})();
`;
    await writeFile(`${OUT}/rd.css`, rdCss);
    await writeFile(`${OUT}/rd.js`, rdJs);
    index = index.replace("<!--RD-->", '<link rel="stylesheet" href="/rd.css"><script src="/rd.js" defer></script>');
    console.log(`Réalisations : js ${rdJs.length} o, css ${rdCss.length} o, ${faces.length} polices`);
  } catch (e) {
    console.warn("Réalisations du site non reprises, on garde la version de secours :", e.message);
  }
  await writeFile(`${OUT}/index.html`, index);
}

main().catch(e => { console.error(e); process.exit(1); });
