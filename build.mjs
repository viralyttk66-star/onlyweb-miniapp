// Build Vercel : recopie deux sections du site ONLYWEB (Lovable) dans la mini app.
//  - « Nos réalisations » (rd.js + rd.css)
//  - « Parlons de ton projet » : la ville en 3D (ct.js + ct.css, avec three.js empaqueté)
// Le site est la source : on récupère son HTML, son CSS et son script, on les adapte à Telegram,
// et on écrit dist/. Si le site change de structure, la mini app garde sa version de secours
// (incluse dans index.html) au lieu de casser.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const SITE = "https://onlyweb-telegram-atelier.lovable.app";
const OUT = "dist";
const BOT = "https://t.me/onlyweb_demo_bot";

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

// Classes utilisées par une section (lues dans son script), pour savoir où s'arrête son CSS.
export function classesDe(code) {
  const set = new Set();
  for (const m of code.matchAll(/class=\\?"([^"\\$]+)/g)) m[1].split(/\s+/).forEach(c => c && set.add(c));
  return set;
}

export function extraireCss(css, classes, racine) {
  const debut = css.indexOf(`.${racine}{isolation`);
  if (debut < 0) throw new Error(`css : .${racine} introuvable`);
  const prefixe = new RegExp(`^${racine}(-|$)`);
  const utilise = sel => [...sel.matchAll(/\.([\w-]+)/g)].some(m => classes.has(m[1]) || prefixe.test(m[1]));
  let i = debut, out = "";
  while (i < css.length) {
    const ouv = css.indexOf("{", i);
    if (ouv < 0) break;
    const sel = css.slice(i, ouv);
    const fin = finBloc(css, ouv);
    const bloc = css.slice(i, fin);
    const garde = /^@(keyframes|property)/.test(sel) || (sel.startsWith("@") ? utilise(bloc) : utilise(sel));
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

const reEnveloppe = (nomFn, appel) => new RegExp(`function \\w+\\(\\)\\{let \\w+=\\(0,\\w+\\.useRef\\)\\(null\\);return\\(0,\\w+\\.useEffect\\)\\(\\(\\)=>\\{if\\(\\w+\\.current\\)return ${appel}`);

export function extraireRd(js) {
  const sec = js.indexOf('id="realisations"');
  if (sec < 0) throw new Error("rd : section introuvable");
  const f = /function (\w+)\(e\)\{let t=e\.querySelector\(`#realisations`\)/.exec(js);
  if (!f) throw new Error("rd : fonction introuvable");
  const nomFn = f[1];
  const env = new RegExp(`function \\w+\\(\\)\\{let \\w+=\\(0,\\w+\\.useRef\\)\\(null\\);return\\(0,\\w+\\.useEffect\\)\\(\\(\\)=>\\{if\\(\\w+\\.current\\)return ${nomFn}\\(\\w+\\.current\\)\\},\\[\\]\\),\\(0,\\w+\\.jsx\\)\\(\`div\`,\\{ref:\\w+,dangerouslySetInnerHTML:\\{__html:(\\w+)\\}\\}\\)\\}`).exec(js);
  if (!env) throw new Error("rd : composant introuvable");
  const avant = js.lastIndexOf("dangerouslySetInnerHTML:{__html:", sec);
  const debut = js.indexOf("var ", avant);
  if (avant < 0 || debut < 0 || debut > sec) throw new Error("rd : début introuvable");
  return { code: js.slice(debut, env.index), nomFn, nomHtml: env[1] };
}

export function extraireCt(js) {
  const liens = /,(\w+)=`#CANAL`,(\w+)=`#BOT`,/.exec(js);
  if (!liens) throw new Error("ct : liens introuvables");
  const f = /function (\w+)\(e,t,n=\{\}\)\{let r=e\.querySelector\(`#contact`\)/.exec(js);
  if (!f) throw new Error("ct : fonction introuvable");
  const nomFn = f[1];
  const env = reEnveloppe(nomFn, `\\w+\\.current\\.querySelector\\(\`\\.ct-link\`\\)\\|\\|\\(\\w+\\.current\\.innerHTML=(\\w+)\\),${nomFn}\\(`).exec(js);
  if (!env) throw new Error("ct : composant introuvable");
  // Adaptations mini app : vrais liens Telegram, offres actuelles (Empire n'existe plus).
  const code = ("var " + js.slice(liens.index + 1, env.index))
    .replace(/=`#CANAL`/, "=`" + BOT + "`")
    .replace(/=`#BOT`/, "=`" + BOT + "`")
    .replace("Lancement, Automatique ou Empire", "Lancement ou Automatique");
  return { code, nomFn, nomHtml: env[1] };
}

// Base équivalente au reset du site (Tailwind), limitée à une section et placée avant son CSS.
const base = r => `
.${r}{font-size:16px;font-weight:400;line-height:1.5;letter-spacing:normal;text-align:left}
.${r} :where(*,::before,::after){border:0 solid;box-sizing:border-box}
.${r} :where(h1,h2,h3,h4,h5,h6,p,ul,ol,figure,blockquote){margin:0}
.${r} :where(ul,ol){list-style:none;padding:0}
.${r} :where(h1,h2,h3,h4,h5,h6){font-size:inherit;font-weight:inherit;line-height:inherit;letter-spacing:inherit;text-transform:none;font-family:inherit;text-wrap:wrap}
.${r} :where(img,svg,video,iframe,canvas){display:block;vertical-align:middle}
.${r} :where(img,video){max-width:100%;height:auto}
.${r} :where(b,strong){font-weight:bolder}
.${r} :where(a){color:inherit;text-decoration:inherit}
`;
// Pleine largeur dans la mini app (le site utilise 100vw, la mini app a une colonne centrée).
const pleineLargeur = (hote, r) => `
#${hote} .${r}{width:auto;margin-left:calc(-1*max(16px,env(safe-area-inset-left,0px)));margin-right:calc(-1*max(16px,env(safe-area-inset-right,0px)));margin-top:44px}
`;

async function main() {
  await mkdir(OUT, { recursive: true });
  let index = await readFile("index.html", "utf8");
  let tete = "";
  let page, fichiers, lire, js, css;
  try {
    page = await texte(SITE + "/");
    fichiers = new Set([...page.matchAll(/\/assets\/[\w.-]+\.(?:js|css)/g)].map(m => m[0]));
    const contenus = {};
    lire = async u => (contenus[u] ??= await texte(SITE + u));
    for (const u of [...fichiers]) {
      const t = await lire(u);
      if (u.endsWith(".js")) for (const m of t.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)) fichiers.add("/" + m[0]);
    }
    for (const u of fichiers) {
      const t = await lire(u);
      if (!js && u.endsWith(".js") && t.includes('id="realisations"') && t.includes("rd-live")) js = t;
      if (!css && u.endsWith(".css") && t.includes(".rd-shell")) css = t;
    }
    if (!js || !css) throw new Error("fichiers du site introuvables");

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
    await writeFile(`${OUT}/polices.css`, faces.join("\n"));
    tete += '<link rel="stylesheet" href="/polices.css">';
  } catch (e) {
    console.warn("Site ONLYWEB inaccessible, on garde les versions de secours :", e.message);
  }

  // ---------- Nos réalisations ----------
  if (js) try {
    const { code, nomFn, nomHtml } = extraireRd(js);
    const rdCss = base("rd") + extraireCss(css, classesDe(code), "rd") + pleineLargeur("rd-host", "rd");
    const rdJs = `/* Section « Nos réalisations » reprise du site ONLYWEB au build. */
(function(){try{
${code}
var __rdHtml=${nomHtml}
  .replace('class="rd-link nx-go" href="#contact"', 'class="rd-link nx-go" href="#" data-aller="brief"')
  .replace(/<a class="rd-link" href="(https:[^"]+)"/g, '<a class="rd-link" href="$1" data-externe');
var h=document.getElementById("rd-host");if(!h)return;
h.innerHTML=__rdHtml;
${nomFn}(h);
}catch(err){console.warn("rd",err)}})();
`;
    await writeFile(`${OUT}/rd.css`, rdCss);
    await writeFile(`${OUT}/rd.js`, rdJs);
    tete += '<link rel="stylesheet" href="/rd.css"><script src="/rd.js" defer></script>';
    console.log(`Réalisations : js ${rdJs.length} o, css ${rdCss.length} o`);
  } catch (e) {
    console.warn("Réalisations non reprises :", e.message);
  }

  // ---------- Parlons de ton projet (ville 3D) ----------
  if (js) try {
    const { code, nomFn, nomHtml } = extraireCt(js);
    const ctCss = base("ct") + extraireCss(css, classesDe(code), "ct") + pleineLargeur("ct-host", "ct");
    await mkdir(".ct-build", { recursive: true });
    await writeFile(".ct-build/entree.mjs", `import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
${code}
{
const h = document.getElementById("ct-host");
if (h) {
  h.innerHTML = ${nomHtml};
  // Liens adaptés à Telegram : packs/contact ouvrent l'onglet de la mini app, t.me s'ouvre dans Telegram.
  h.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const u = a.getAttribute("href");
    const onglets = { "#packs": "offres", "#contact": "contact", "#brief": "brief" };
    if (onglets[u]) {
      e.preventDefault();
      const b = document.querySelector('.nav [data-aller="' + onglets[u] + '"]');
      if (b) b.click();
      return;
    }
    const tg = window.Telegram && window.Telegram.WebApp;
    if (/^https:\\/\\/t\\.me\\//.test(u) && tg && tg.openTelegramLink) { e.preventDefault(); tg.openTelegramLink(u); }
  }, true);
  try {
    ${nomFn}(h, THREE, { RoundedBoxGeometry, mergeGeometries, EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
  } catch (err) { console.warn("ct", err); }
}
}
`);
    const esbuild = await import("esbuild");
    await esbuild.build({ entryPoints: [".ct-build/entree.mjs"], bundle: true, minify: true, format: "iife", target: "es2020", outfile: `${OUT}/ct.js`, logLevel: "warning" });
    await writeFile(`${OUT}/ct.css`, ctCss);
    // three.js est lourd : la ville n'est chargée que quand on approche du bas de l'accueil.
    tete += `<link rel="stylesheet" href="/ct.css"><script>
(function(){function go(){var s=document.createElement("script");s.src="/ct.js";s.async=true;document.head.appendChild(s)}
function init(){var h=document.getElementById("ct-host");if(!h)return;if(!("IntersectionObserver" in window))return go();
var o=new IntersectionObserver(function(es){if(es.some(function(x){return x.isIntersecting})){o.disconnect();go()}},{rootMargin:"900px 0px"});o.observe(h)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init()})();
</script>`;
    console.log(`Ville 3D : css ${ctCss.length} o`);
  } catch (e) {
    console.warn("Ville 3D non reprise :", e.message);
  }

  index = index.replace("<!--RD-->", tete);
  await writeFile(`${OUT}/index.html`, index);
}

main().catch(e => { console.error(e); process.exit(1); });
