"use strict";
/* Contrato de la PWA de un solo archivo: sintaxis ES5, archivos que usa la página disponibles sin señal (service worker), manifest. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const { RAIZ } = require("./helpers/cargarApp");

const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");
const html = leer("index.html");

function scriptsInline(src) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) out.push({ codigo: m[1], linea: src.slice(0, m.index).split("\n").length });
  return out;
}

test("el script inline de index.html y turno.js son ES5 válido (sin let/const/flechas/plantillas/clases)", () => {
  const inline = scriptsInline(html);
  assert.ok(inline.length >= 1, "no se encontró el <script> inline");
  const fuentes = inline.map((s, i) => ({ nombre: `index.html <script> #${i + 1}`, codigo: s.codigo, desplazamiento: s.linea - 1 }));
  fuentes.push({ nombre: "turno.js", codigo: leer("turno.js"), desplazamiento: 0 });
  fuentes.forEach((f) => {
    try { acorn.parse(f.codigo, { ecmaVersion: 5, sourceType: "script" }); }
    catch (e) {
      const lin = e.loc ? e.loc.line + f.desplazamiento : "?";
      const texto = f.codigo.split("\n")[(e.loc ? e.loc.line : 1) - 1] || "";
      assert.fail(`${f.nombre}: sintaxis no ES5 en la línea ${lin}, col ${e.loc && e.loc.column}: ${e.message}\n    ${texto.trim().slice(0, 160)}`);
    }
  });
});

test("todo archivo local que usa la página existe y está en la lista de caché del service worker (funciona sin señal)", () => {
  const ctx = { self: { addEventListener() {}, clients: {}, skipWaiting() {} }, caches: {}, location: { origin: "http://x" }, URL, fetch() {} };
  vm.createContext(ctx);
  vm.runInContext(leer("sw.js"), ctx);
  const archivos = Array.from(ctx.ARCHIVOS).map((a) => a.replace(/^\.\//, ""));
  assert.ok(archivos.length >= 3, "no se pudo leer ARCHIVOS de sw.js");
  // los logos son opcionales (el repo público no los trae): la página los oculta si faltan y el service worker los guarda solo si existen
  const opcionales = new Set(Array.from(ctx.OPCIONALES || []).map((a) => a.replace(/^\.\//, "")));
  archivos.forEach((a) => assert.ok(opcionales.has(a) || fs.existsSync(path.join(RAIZ, a)), `sw.js lista «${a}» pero el archivo no existe`));
  // lo que la página pide por etiquetas
  const usados = new Set();
  let m;
  const reSrc = /<(?:script|img|link)\b[^>]*?\b(?:src|href)="([^"#?]+)"/gi;
  while ((m = reSrc.exec(html))) if (!/^(?:[a-z]+:|\/\/|data:)/i.test(m[1])) usados.add(m[1].replace(/^\.\//, ""));
  // y por código (logos y librería del reporte)
  [/["'](logo-[a-z]+\.(?:png|jpg))["']/g, /["'](exceljs[\w.-]*\.js)["']/g].forEach((re) => { while ((m = re.exec(html))) usados.add(m[1]); });
  assert.ok(usados.has("turno.js"), "index.html debería cargar turno.js (¿cambió la estructura?)");
  usados.forEach((u) => {
    assert.ok(opcionales.has(u) || fs.existsSync(path.join(RAIZ, u)), `index.html usa «${u}» pero no existe en el repo`);
    assert.ok(archivos.includes(u), `index.html usa «${u}» y NO está en ARCHIVOS de sw.js: sin señal la app no cargaría (agrégalo y sube la versión del caché)`);
  });
  assert.ok(archivos.includes("index.html") && archivos.includes("manifest.webmanifest"));
  assert.match(ctx.CACHE, /^liberaciones-v\d+$/, "nombre de caché con versión");
});

test("manifest.webmanifest es válido y sus íconos existen", () => {
  const mf = JSON.parse(leer("manifest.webmanifest"));
  assert.ok(mf.name && mf.short_name && mf.start_url && mf.display === "standalone");
  assert.ok(fs.existsSync(path.join(RAIZ, mf.start_url.replace(/^\.\//, ""))), "start_url existe");
  assert.ok(mf.icons.length >= 2);
  mf.icons.forEach((i) => assert.ok(fs.existsSync(path.join(RAIZ, i.src)), "ícono " + i.src));
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});

test("el HTML estático no repite ids", () => {
  const ids = [...html.matchAll(/<[a-z]+[^>]*\sid="([^"]+)"/gi)].map((m) => m[1]);
  const rep = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepStrictEqual(rep, [], "ids repetidos en index.html: " + rep.join(", "));
});
