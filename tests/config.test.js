"use strict";
/* Configuración: sanitizeCfg / validateCfg con entradas malformadas, y configuración remota del equipo. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearServidorMock } = require("./helpers/cargarApp");

let app, W;
test.before(async () => { app = await cargarApp(); W = app.window; });
test.after(() => app.cerrar());

/* las entradas se pasan "como si vinieran de JSON" (localStorage, importar archivo, servidor) y del "realm" de la página */
const enPagina = (x) => (x === undefined ? undefined : W.JSON.parse(JSON.stringify(x)));
const defecto = () => app.json("defaultConfig()");

function frenteBueno(extra) {
  return Object.assign({ id: "f1", nombre: "FRENTE UNO", corto: "F1", tipos: ["RELLENO", "EVALUACION"], materiales: [] }, extra || {});
}

const MALFORMADAS = {
  "null": null, "undefined": undefined, "número": 42, "texto": "hola", "true": true, "arreglo vacío": [], "arreglo con basura": [1, "a", null],
  "objeto vacío": {},
  "frentes null": { frentes: null }, "frentes texto": { frentes: "x" }, "frentes objeto": { frentes: {} }, "frentes vacío": { frentes: [] },
  "frentes [null]": { frentes: [null] }, "frentes con primitivos": { frentes: [1, "a", true, null, []] }, "frente vacío": { frentes: [{}] },
  "frente sin tipos": { frentes: [{ id: "a", nombre: "A" }] },
  "frente sin nombre": { frentes: [{ id: "a", tipos: ["RELLENO"] }] },
  "tipos como texto": { frentes: [{ id: "a", nombre: "A", tipos: "RELLENO" }] },
  "tipos inválidos": { frentes: [{ id: "a", nombre: "A", tipos: [null, 5, "NOEXISTE", {}, ["RELLENO"]] }] },
  "tipos repetidos": { frentes: [frenteBueno({ tipos: ["RELLENO", "RELLENO", "EVALUACION"] })] },
  "frentes duplicados (mismo id)": { frentes: [frenteBueno(), frenteBueno({ nombre: "OTRO NOMBRE" })] },
  "frentes duplicados (idénticos)": { frentes: [frenteBueno(), frenteBueno()] },
  "id numérico y objeto": { frentes: [frenteBueno({ id: 7 }), frenteBueno({ id: { x: 1 }, nombre: "B" })] },
  "materiales null": { materiales: null, frentes: [frenteBueno()] },
  "materiales basura": { materiales: [null, 1, "x", {}, { id: 5 }, { nombre: "" }, { nombre: "A" }, { nombre: "A" }, { id: "m-a", nombre: "a" }], frentes: [frenteBueno({ materiales: [null, {}, { mat: "zz" }, { mat: "m-a" }, { mat: "m-a" }] })] },
  "material con campos basura": {
    materiales: [{ id: "m1", nombre: "MAT" }],
    frentes: [frenteBueno({ materiales: [{ mat: "m1", procs: "x", capas: { modo: "RANGO", min: "x", max: null }, esp: "texto", cota: null, ests: [null, 1, { est: "no" }] },
                                          { mat: "m1", capas: 5, esp: { modo: 7 }, cota: { modo: "CALC", base: {}, tabla: "x" }, ests: "x" }] })] },
  "estructuras basura": { estructuras: [null, 5, {}, { nombre: "" }, { nombre: "Z", ubicaciones: "x" }, { id: "e", nombre: "Z", ubicaciones: [null, 1] }], frentes: [frenteBueno()] },
  "supervisores texto": { supervisores: "Juan", frentes: [frenteBueno()] },
  "supervisores basura": { supervisores: [null, 1, "", "  ", {}], frentes: [frenteBueno()] },
  "diámetros basura": { diametros: [null, {}, "abc", "100", "100", "4,5", ""], frentes: [frenteBueno()] },
  "diámetros texto": { diametros: "100", frentes: [frenteBueno()] },
  "líneas basura": { lineas: [], frentes: [frenteBueno()] },
  "líneas valores raros": { lineas: { 100: 5, 300: [null, 1, "A"], x: {} }, frentes: [frenteBueno()] },
  "reporte basura": { reporte: "x", frentes: [frenteBueno()] },
  "reporte con objetos": { reporte: { codigo: {}, numRef: [], cliente: null }, frentes: [frenteBueno()] },
  "tipos de liberación texto": { tipos: "x", frentes: [frenteBueno()] },
  "tipos de liberación null": { tipos: { RELLENO: null, SUBDRENES: { largo: 5 }, COLECCION: { largo: "", corto: "" } }, frentes: [frenteBueno()] },
  "versión rara": { version: "x", frentes: [frenteBueno()] },
  "líneas por frente basura": { frentes: [frenteBueno({ lineas: { RELLENO: { DET: "Z", CAPA: ["S"], NOEXISTE: "S" }, NOEXISTE: 5 } })] },
  "overliner y diams basura": { frentes: [frenteBueno({ overliner: "x", diams: { SUBDRENES: "100", SIST_SUBD: [null, 5], COLECCION: {} } })] },
  "formato anterior (materiales dentro de cada frente)": {
    cotasBase: [{ id: "r1", base: 2800, capaBase: 1, espesor: 0.5 }, null],
    frentes: [{ id: "x", nombre: "X", tipos: ["RELLENO"], procDefault: ["a"],
      materiales: [{ nombre: "Rel", tipo: "ESTANDAR", espesor: "0.5 m", cotaRef: "r1" }, null, { nombre: null }, { nombre: "Rel", tipo: "RARO" }, { nombre: "Apil", tipo: "APILAMIENTO" }] }],
  },
  "formato anterior sin materiales": { frentes: [{ id: "x", nombre: "X", tipos: ["RELLENO"], materiales: "x", cotasBase: 5 }], cotasBase: "x", procDefault: 5 },
  "textos enormes": { frentes: [frenteBueno({ nombre: "N".repeat(100000) })], supervisores: ["S".repeat(100000)] },
  "claves peligrosas": JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"frentes":[{"id":"__proto__","nombre":"P","tipos":["RELLENO"],"__proto__":{"polluted":true}}]}'),
};

test("sanitizeCfg: ninguna entrada malformada lanza excepción y siempre da una configuración utilizable", () => {
  Object.keys(MALFORMADAS).forEach((nombre) => {
    const entrada = enPagina(MALFORMADAS[nombre]);
    let r;
    assert.doesNotThrow(() => { r = W.sanitizeCfg(entrada); }, `sanitizeCfg(${nombre}) lanzó excepción`);
    const c = JSON.parse(JSON.stringify(r));
    assert.ok(c && typeof c === "object" && !Array.isArray(c), nombre + ": debe devolver un objeto");
    assert.ok(Array.isArray(c.frentes) && c.frentes.length >= 1, nombre + ": debe haber al menos un frente");
    c.frentes.forEach((f, i) => {
      assert.ok(typeof f.id === "string" && f.id, `${nombre}: frente ${i} sin id`);
      assert.ok(typeof f.nombre === "string" && f.nombre, `${nombre}: frente ${i} sin nombre`);
      assert.ok(Array.isArray(f.tipos) && f.tipos.length >= 1 && f.tipos.every((t) => W.TIPO_KEYS.includes(t)), `${nombre}: frente ${i} con tipos inválidos`);
      assert.ok(Array.isArray(f.materiales), nombre + ": materiales");
      assert.ok(f.lineas && typeof f.lineas === "object" && f.overliner && f.diams, nombre + ": lineas/overliner/diams");
    });
    ["tipos", "supervisores", "materialesEval", "diametros", "lineas", "reporte", "procedencias", "materiales", "estructuras"].forEach((k) => assert.ok(c[k] != null, `${nombre}: falta ${k}`));
    assert.ok(c.supervisores.length >= 1, nombre + ": al menos un supervisor");
    assert.strictEqual(({}).polluted, undefined, "contaminación de prototipos en " + nombre);
    // validateCfg sobre lo sanitizado tampoco debe lanzar y devuelve lista
    let e;
    assert.doesNotThrow(() => { e = W.validateCfg(r); }, `validateCfg(sanitizeCfg(${nombre})) lanzó excepción`);
    assert.ok(Array.isArray(e), nombre + ": validateCfg debe devolver arreglo");
  });
});

/* defaultConfig() no escribe espModo en las estructuras de cada material ni la lista de líneas vacía del diámetro 450;
   sanitizeCfg los agrega ("MANUAL" y []), que es lo que ya significaba su ausencia. Se comparan sin esas diferencias cosméticas. */
function sinEspModoManual(c) {
  c = JSON.parse(JSON.stringify(c));
  Object.keys(c.lineas).forEach((k) => { if (!c.lineas[k].length) delete c.lineas[k]; });
  c.frentes.forEach((f) => f.materiales.forEach((m) => m.ests.forEach((e) => { if (e.espModo === "MANUAL") delete e.espModo; })));
  return c;
}

test("sanitizeCfg: la configuración de fábrica es estable (sanitizar no cambia nada de fondo) y es idempotente", () => {
  const d = defecto();
  assert.deepStrictEqual(sinEspModoManual(app.json("sanitizeCfg(defaultConfig())")), d,
    "sanitizeCfg(defaultConfig()) debería devolver lo mismo (salvo espModo MANUAL explícito y líneas vacías)");
  assert.deepStrictEqual(app.json("sanitizeCfg(sanitizeCfg(defaultConfig()))"), app.json("sanitizeCfg(defaultConfig())"));
  assert.deepStrictEqual(sinEspModoManual(app.json("sanitizeCfg(null)")), d, "entrada nula → configuración de fábrica");
  assert.deepStrictEqual(sinEspModoManual(app.json("sanitizeCfg({frentes:[]})")), d, "sin frentes válidos → frentes de fábrica");
  assert.deepStrictEqual(app.json("validateCfg(defaultConfig())"), [], "la configuración de fábrica debe ser válida");
  assert.deepStrictEqual(app.json("validateCfg(sanitizeCfg(defaultConfig()))"), []);
});

test("sanitizeCfg: idempotente para todas las entradas malformadas (sanitizar de nuevo no cambia nada)", () => {
  Object.keys(MALFORMADAS).forEach((nombre) => {
    const una = W.sanitizeCfg(enPagina(MALFORMADAS[nombre]));
    const dos = W.sanitizeCfg(W.JSON.parse(W.JSON.stringify(una)));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sinEspModoManual(dos))), JSON.parse(JSON.stringify(sinEspModoManual(una))), nombre + ": no es idempotente");
    const tres = W.sanitizeCfg(W.JSON.parse(W.JSON.stringify(dos)));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(tres)), JSON.parse(JSON.stringify(dos)), nombre + ": la segunda pasada debe ser estable");
  });
});

test("sanitizeCfg: normaliza (mayúsculas, recorte, duplicados de materiales/estructuras/diámetros)", () => {
  const r = JSON.parse(JSON.stringify(W.sanitizeCfg(enPagina({
    supervisores: ["  Ana  ", "", "Beto"], diametros: ["450", "100", "100", "abc", "4,5"],
    materiales: [{ id: "m-a", nombre: " arena " }, { id: "m-a", nombre: "OTRA" }, { nombre: "" }],
    estructuras: [{ nombre: "zanja", ubicaciones: ["a"] }, { nombre: "zanja" }],
    frentes: [frenteBueno({ nombre: "  frente  ", materiales: [{ mat: "m-a", procs: ["x", "X", " y "] }] })],
  }))));
  assert.deepStrictEqual(r.supervisores, ["Ana", "Beto"]);
  assert.deepStrictEqual(r.diametros, ["45", "100", "450"], "diámetros: solo dígitos/punto, sin repetidos, ordenados");
  assert.deepStrictEqual(r.materiales.map((m) => m.nombre), ["ARENA"]);
  assert.strictEqual(r.estructuras.length, 1);
  assert.deepStrictEqual(r.estructuras[0].ubicaciones, ["A"]);
  assert.strictEqual(r.frentes[0].nombre, "frente");
  assert.deepStrictEqual(r.frentes[0].materiales[0].procs, ["X", "Y"]);
});

test("validateCfg: detecta cada tipo de error de configuración sin lanzar excepción", () => {
  const base = () => W.sanitizeCfg(W.JSON.parse(JSON.stringify(W.defaultConfig())));
  const casos = [
    ["sin frentes", (c) => { c.frentes = []; }, /al menos un frente/],
    ["sin supervisores", (c) => { c.supervisores = []; }, /supervisor/],
    ["sin diámetros", (c) => { c.diametros = []; }, /diámetro/],
    ["material repetido", (c) => { c.materiales.push(JSON.parse(JSON.stringify(c.materiales[0]))); c.materiales[c.materiales.length - 1].id = "m-copia"; }, /repetido/],
    ["material sin nombre", (c) => { c.materiales[0].nombre = ""; }, /falta el nombre/],
    ["texto de tipo vacío", (c) => { c.tipos.RELLENO.largo = ""; }, /no pueden quedar vacíos/],
    ["estructura sin nombre", (c) => { c.estructuras[0].nombre = ""; }, /Estructura 1: falta el nombre/],
    ["rango de capas inválido", (c) => { c.frentes[0].materiales[0].capas = { modo: "RANGO", min: "5", max: "2" }; }, /rango de capas/],
    ["rango de capas enorme", (c) => { c.frentes[0].materiales[0].capas = { modo: "RANGO", min: "1", max: "500" }; }, /rango de capas/],
    ["espesor fijo vacío", (c) => { const m = c.frentes[0].materiales[0]; m.ests = []; m.esp = { modo: "FIJO", valor: "", formula: "" }; }, /falta el espesor fijo/],
    ["fórmula de espesor peligrosa", (c) => { const m = c.frentes[0].materiales[0]; m.ests = []; m.esp = { modo: "PATRON", valor: "", formula: "alert(1)" }; }, /fórmula del espesor no es válida/],
    ["fórmula de espesor que da cero", (c) => { const m = c.frentes[0].materiales[0]; m.ests = []; m.esp = { modo: "PATRON", valor: "", formula: "c-c" }; }, /fórmula del espesor no es válida/],
    ["tabla de cotas mal escrita", (c) => { c.frentes[0].materiales[0].cota.tabla = ["esto no vale"]; }, /formato capa = cota/],
    ["cota calculada sin base", (c) => { const m = c.frentes[0].materiales[0]; m.cota = { modo: "CALC", base: "", capaBase: "", paso: "", tabla: [] }; }, /cota base/],
    ["cota calculada sin paso con espesor manual", (c) => { const m = c.frentes[0].materiales[0]; m.esp = { modo: "MANUAL", valor: "", formula: "" }; m.cota = { modo: "CALC", base: "1", capaBase: "1", paso: "", tabla: [] }; }, /cuánto sube por capa/],
    ["overliner sin espesor fijo", (c) => { const f = c.frentes.find((x) => x.tipos.includes("OVERLINER")); f.overliner = { espModo: "FIJO", espesor: "" }; }, /falta el espesor fijo/],
    ["tubería sin diámetro", (c) => { const f = c.frentes.find((x) => x.tipos.includes("SUBDRENES")); f.diams.SUBDRENES = []; }, /al menos un diámetro/],
    ["relleno sin materiales", (c) => { c.frentes[0].materiales = []; }, /necesita al menos un material/],
    ["frente sin tipos", (c) => { c.frentes[0].tipos = []; }, /al menos un tipo/],
    ["frente sin nombre", (c) => { c.frentes[0].nombre = ""; c.frentes[0].corto = ""; }, /falta el nombre completo/],
  ];
  casos.forEach(([nombre, muta, patron]) => {
    const c = base();
    muta(c);
    let errs;
    assert.doesNotThrow(() => { errs = W.validateCfg(c); }, `validateCfg lanzó excepción en «${nombre}»`);
    assert.ok(errs.length >= 1, `validateCfg debería detectar «${nombre}»`);
    assert.ok(errs.some((e) => patron.test(e)), `«${nombre}»: mensajes ${JSON.stringify(Array.from(errs))} no coinciden con ${patron}`);
  });
});

test.todo("(no cubierto) validateCfg(null) / validateCfg sobre una configuración SIN sanitizar: hoy asume que ya pasó por sanitizeCfg (lanza TypeError con null); la app siempre las encadena");

/* ── configuración que llega del servidor / del almacenamiento al arrancar ── */
test("la app arranca con configuración guardada corrupta o malformada y muestra la pantalla principal", async () => {
  const guardados = ["{no es json", "null", "[]", "42", '"texto"', '{"frentes":[null]}', '{"frentes":"x"}', '{"frentes":[{"id":"a","nombre":"A","tipos":["RELLENO"]}]}', ""];
  for (const g of guardados) {
    const a = await cargarApp({ storage: { "genlib.config.v1": g, "genlib.prefs.v1": "{rota", "genlib.cola.v1": "[[", "genlib.recientes.v1": "x" } });
    try {
      assert.deepStrictEqual(a.errores.map(String), [], "config guardada: " + JSON.stringify(g));
      assert.ok(a.document.querySelector(".hdr"), "debe dibujar la pantalla principal con config guardada " + JSON.stringify(g));
      assert.ok(a.json("cfg.frentes.length") >= 1);
      // se puede recorrer cada frente y tipo sin errores
      const frentes = a.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
      for (const f of frentes) { await a.elegirFrente(f.id); for (const t of f.tipos) await a.elegirTipo(t); }
      assert.deepStrictEqual(a.errores.map(String), [], "al recorrer frentes y tipos con config " + JSON.stringify(g));
    } finally { a.cerrar(); }
  }
});

test("configuración del equipo: se aplica, se guarda en el celular y solo se vuelve a aplicar si cambia la versión", async () => {
  const servidor = crearServidorMock();
  const remota = JSON.parse(JSON.stringify(defecto()));
  remota.supervisores = ["Ana Prueba", "Beto Prueba"];
  servidor.config = remota; servidor.version = 5;
  const a = await cargarApp({ servidor });
  try {
    assert.deepStrictEqual(a.json("cfg.supervisores"), ["Ana Prueba", "Beto Prueba"]);
    assert.strictEqual(a.json("cfgMeta.version"), 5);
    assert.deepStrictEqual(JSON.parse(a.ls.getItem("genlib.config.v1")).supervisores, ["Ana Prueba", "Beto Prueba"]);
    // misma versión: no reaplica aunque el contenido cambie
    servidor.config = Object.assign({}, remota, { supervisores: ["Otro"] });
    await a.window.syncConfig(true); await a.vaciar();
    assert.deepStrictEqual(a.json("cfg.supervisores"), ["Ana Prueba", "Beto Prueba"]);
    servidor.version = 6;
    await a.window.syncConfig(true); await a.vaciar();
    assert.deepStrictEqual(a.json("cfg.supervisores"), ["Otro"]);
    assert.deepStrictEqual(a.errores.map(String), []);
  } finally { a.cerrar(); }
});

test("configuración del equipo malformada o que quita el frente en uso: la app no se rompe", async () => {
  const servidor = crearServidorMock();
  const a = await cargarApp({ servidor });
  try {
    await a.elegirFrente("pad2f"); await a.elegirTipo("FUNDACION");
    const sinPad2f = JSON.parse(JSON.stringify(defecto()));
    sinPad2f.frentes = sinPad2f.frentes.filter((f) => f.id !== "pad2f");
    servidor.config = sinPad2f; servidor.version = 10;
    await a.window.syncConfig(true); await a.vaciar();
    assert.strictEqual(a.json("state.estructura"), "", "si el frente en uso desaparece, se limpia la selección");
    assert.strictEqual(a.json("state.tipo"), "");
    assert.ok(a.document.querySelector(".hdr"));
    for (const basura of [{ frentes: [null] }, "texto", 42, { frentes: "x" }, []]) {
      servidor.config = basura; servidor.version++;
      await a.window.syncConfig(true); await a.vaciar();
      assert.ok(a.json("cfg.frentes.length") >= 1, "con config remota " + JSON.stringify(basura));
    }
    assert.deepStrictEqual(a.errores.map(String), []);
  } finally { a.cerrar(); }
});
