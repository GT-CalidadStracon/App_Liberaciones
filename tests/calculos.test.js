"use strict";
/* Cálculos conocidos: cota por capa, espesor por capa, longitud de progresivas, fórmulas de espesor, filtros numéricos. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearRng } = require("./helpers/cargarApp");
const { numFilterRef } = require("./helpers/llenar");

let app, W;
test.before(async () => { app = await cargarApp(); W = app.window; });
test.after(() => app.cerrar());

/* material tal como se usa en un frente (el que reciben cotaParaCapa / espesorDeCapa) */
const mat = (frenteId, nombre) => {
  const m = W.eval(`getMat(getFrente(${JSON.stringify(frenteId)}),${JSON.stringify(nombre)})`);
  assert.ok(m, `No existe el material «${nombre}» en el frente ${frenteId} de la configuración de fábrica`);
  return m;
};

test("configuración de fábrica: referencias de cota por frente/material", () => {
  const ref = (fr, n) => { const c = mat(fr, n).cota; return [c.modo, c.base, c.capaBase, c.paso]; };
  assert.deepStrictEqual(ref("tajo", "RELLENO CONTROLADO"), ["CALC", "2773", "26", "1"]);
  assert.deepStrictEqual(ref("pad2e", "RELLENO ESTRUCTURAL"), ["CALC", "2810.5", "15", "0.5"]);
  assert.deepStrictEqual(ref("pad2d", "RELLENO ESTRUCTURAL"), ["CALC", "2810.5", "15", "0.5"]);
  assert.deepStrictEqual(ref("pad2en", "RELLENO ESTRUCTURAL"), ["CALC", "2810.5", "15", "0.5"]);
  assert.deepStrictEqual(ref("compensacion", "RELLENO DE RIPIOS"), ["CALC", "2573", "9", "1"]);
  assert.deepStrictEqual(ref("tajo", "RELLENO MASIVO DE APILAMIENTO"), ["CALC", "2773", "6", ""]);
  assert.strictEqual(mat("pad2e", "SUELO DE BAJA PERMEABILIDAD").cota.modo, "VARIABLE");
  // pad 2F: relleno estructural sin cota automática
  assert.strictEqual(mat("pad2f", "RELLENO ESTRUCTURAL").cota.modo, "MANUAL");
});

test("cota por capa: relleno controlado del Tajo (capa 26 → 2773, 27 → 2774)", () => {
  const m = mat("tajo", "RELLENO CONTROLADO");
  assert.strictEqual(W.cotaParaCapa(m, "26"), "2773");
  assert.strictEqual(W.cotaParaCapa(m, "27"), "2774");
  assert.strictEqual(W.cotaParaCapa(m, "30"), "2777");
  assert.strictEqual(W.cotaParaCapa(m, "25"), "2772");
  assert.strictEqual(W.cotaParaCapa(m, 26), "2773", "también acepta número");
  assert.strictEqual(W.espesorDeCapa(m, 27), 1);
});

test("cota por capa: relleno estructural 2E (capa base 15 = 2810.5, espesor 0.5 m)", () => {
  const m = mat("pad2e", "RELLENO ESTRUCTURAL");
  assert.strictEqual(W.espesorDeCapa(m, 15), 0.5);
  assert.strictEqual(W.espesorDeCapa(m, 99), 0.5);
  const esperado = { 15: "2810.5", 16: "2811", 17: "2811.5", 14: "2810", 9: "2807.5", 20: "2813", 1: "2803.5" };
  Object.keys(esperado).forEach((capa) => assert.strictEqual(W.cotaParaCapa(m, capa), esperado[capa], "capa " + capa));
});

test("cota por capa: ripios de compensación y apilamiento (espesor por fórmula)", () => {
  const rip = mat("compensacion", "RELLENO DE RIPIOS");
  assert.strictEqual(W.cotaParaCapa(rip, "9"), "2573");
  assert.strictEqual(W.cotaParaCapa(rip, "12"), "2576");
  const ap = mat("tajo", "RELLENO MASIVO DE APILAMIENTO");
  // espesor: (c-6)%3==2 ? 4 : 3  → capas 8, 11, 14… miden 4 m; las demás 3 m
  assert.deepStrictEqual([6, 7, 8, 9, 10, 11].map((c) => W.espesorDeCapa(ap, c)), [3, 3, 4, 3, 3, 4]);
  const cotas = { 6: "2773", 7: "2776", 8: "2780", 9: "2783", 10: "2786", 11: "2790", 5: "2770", 4: "2767", 3: "2764" };
  // hacia arriba suma el espesor de cada capa nueva; hacia abajo resta el de cada capa que se quita
  Object.keys(cotas).forEach((capa) => assert.strictEqual(W.cotaParaCapa(ap, capa), cotas[capa], "capa " + capa));
});

test("cota por capa: casos límite (variable, texto, vacío, tabla, redondeo)", () => {
  const vble = mat("pad2e", "SUELO DE BAJA PERMEABILIDAD");
  assert.strictEqual(W.cotaParaCapa(vble, "3"), null, "cota VARIABLE: no toca la cota escrita");
  assert.strictEqual(W.cotaParaCapa(null, "3"), null);
  const m = mat("tajo", "RELLENO CONTROLADO");
  assert.strictEqual(W.cotaParaCapa(m, "26", true), "", "capa escrita como texto (OTRO): sin cota automática");
  assert.strictEqual(W.cotaParaCapa(m, ""), "");
  assert.strictEqual(W.cotaParaCapa(m, "abc"), "");
  assert.strictEqual(W.cotaParaCapa(mat("pad2f", "RELLENO ESTRUCTURAL"), "5"), null, "cota manual: no toca");
  // redondeo a 3 decimales (0.2 × 3 + 100.1 no debe dar 100.69999999999999)
  const raro = W.eval(`({cota:{modo:"CALC",base:"100.1",capaBase:"1",paso:"0.2",tabla:[]},esp:{modo:"MANUAL",valor:"",formula:""}})`);
  assert.strictEqual(W.cotaParaCapa(raro, "4"), "100.7");
  // la tabla "capa = cota" manda sobre el cálculo; admite coma decimal y capas de texto sin distinguir mayúsculas
  const conTabla = W.eval(`({cota:{modo:"CALC",base:"2773",capaBase:"26",paso:"1",tabla:["27 = 2800","NIVELANTE 01: 2705,5","3;2701"]},esp:{modo:"FIJO",valor:"1 m",formula:""}})`);
  assert.strictEqual(W.cotaParaCapa(conTabla, "27"), "2800");
  assert.strictEqual(W.cotaParaCapa(conTabla, "27.0"), "2800");
  assert.strictEqual(W.cotaParaCapa(conTabla, "nivelante 01", true), "2705.5");
  assert.strictEqual(W.cotaParaCapa(conTabla, "3"), "2701");
  assert.strictEqual(W.cotaParaCapa(conTabla, "28"), "2775", "fuera de la tabla se calcula (2773 + 2 capas de 1 m)");
  const soloTabla = W.eval(`({cota:{modo:"MANUAL",base:"",capaBase:"",paso:"",tabla:["1=10"]},esp:{modo:"MANUAL"}})`);
  assert.strictEqual(W.cotaParaCapa(soloTabla, "1"), "10");
  assert.strictEqual(W.cotaParaCapa(soloTabla, "2"), "", "hay tabla pero esa capa no está: se limpia la cota");
});

test("espesor por capa: fijo, manual, patrón y entradas inválidas", () => {
  const f = (modo, valor, formula) => W.eval(`({esp:{modo:${JSON.stringify(modo)},valor:${JSON.stringify(valor || "")},formula:${JSON.stringify(formula || "")}}})`);
  assert.strictEqual(W.espesorDeCapa(f("FIJO", "0.5 m"), 3), 0.5);
  assert.strictEqual(W.espesorDeCapa(f("FIJO", "1,5 m"), 3), 1.5);
  assert.ok(Number.isNaN(W.espesorDeCapa(f("FIJO", ""), 3)));
  assert.ok(Number.isNaN(W.espesorDeCapa(f("MANUAL", "0.3 m"), 3)), "manual: se escribe al liberar");
  assert.strictEqual(W.espesorDeCapa(f("PATRON", "", "c*2"), 4), 8);
  assert.ok(Number.isNaN(W.espesorDeCapa(f("PATRON", "", "alert(1)"), 4)));
  assert.ok(Number.isNaN(W.espesorDeCapa(null, 1)));
  assert.ok(Number.isNaN(W.espesorDeCapa({}, 1)));
});

test("progLongitud: longitud entre progresivas", () => {
  const casos = [
    ["0+135.80 - 0+244.00", "108.20"],
    ["0+000 - 0+100", "100.00"],
    ["1+000 - 0+500", "500.00", "valor absoluto: no importa el orden"],
    ["0+100 - 1+250.5", "1150.50"],
    ["2+412.22 - 2+937.77", "525.55"],
    ["0+100 - 0+100", "0.00"],
    ["", ""],
    [null, ""],
    ["0+100", "", "falta el segundo extremo"],
    ["0+100 - ", ""],
    ["abc - def", ""],
    ["0+100 - 0+200 - 0+300", "", "tres extremos no es un tramo"],
  ];
  casos.forEach(([entrada, esperado, nota]) => assert.strictEqual(W.progLongitud(entrada), esperado, `progLongitud(${JSON.stringify(entrada)}) ${nota || ""}`));
});

test("evalFormula: acepta fórmulas de espesor y rechaza expresiones peligrosas", () => {
  assert.strictEqual(W.evalFormula("(c-6)%3==2 ? 4 : 3", 8), 4);
  assert.strictEqual(W.evalFormula("(c-6)%3==2 ? 4 : 3", 7), 3);
  assert.strictEqual(W.evalFormula("(c-6)%3==2 ? 4 : 3", 11), 4);
  assert.strictEqual(W.evalFormula("0.5", 1), 0.5);
  assert.strictEqual(W.evalFormula("c * 2 + 1", 3), 7);
  assert.strictEqual(W.evalFormula("c>10 ? 1 : 0.5", 11), 1);
  const rechazadas = [
    "alert(1)", "window", "this", "process.exit()", "constructor", "c.constructor", "c['constructor']", "cc", "c()",
    "1;2", "__proto__", "while(1){}", "eval('1')", "Function('return 1')()", "globalThis", "document.cookie", "`1`", "'1'", "\"1\"",
    "1,2", "{}", "[]", "c.toString()", "new Date()", "x", "", null, undefined,
    "1/0", "0/0", "c/0", "1//2", "(", "c c", "1 +", "!", "c ? : 1",
  ];
  rechazadas.forEach((fx) => {
    let v;
    assert.doesNotThrow(() => { v = W.evalFormula(fx, 3); }, `evalFormula(${JSON.stringify(fx)}) no debe lanzar excepción`);
    assert.ok(Number.isNaN(v), `evalFormula(${JSON.stringify(fx)}) debe dar NaN y dio ${v}`);
  });
  assert.strictEqual(W.__pwned, undefined, "ninguna expresión debe haber ejecutado código");
  // la lista blanca de caracteres admite funciones flecha con la sola variable c: inofensivas, pero no deben colgar ni lanzar
  assert.doesNotThrow(() => W.evalFormula("(c=>c(c))(c=>c(c))", 3), "recursión infinita debe quedar contenida");
  assert.ok(Number.isNaN(W.evalFormula("(c=>c(c))(c=>c(c))", 3)));
  // fuzz: cadenas arbitrarias con letras nunca se evalúan
  const rng = crearRng(2026);
  const letras = "abdefghijklmnopqrstuvwxyz_$.[]{};,'\"`\\@#~^";
  for (let i = 0; i < 300; i++) {
    let s = "";
    const n = rng.int(1, 12);
    for (let j = 0; j < n; j++) s += rng() < 0.4 ? letras[rng.int(0, letras.length - 1)] : "c0123456789+-*/%()<>=!?:&| ."[rng.int(0, 27)];
    let v;
    assert.doesNotThrow(() => { v = W.evalFormula(s, 5); }, JSON.stringify(s));
    assert.ok(typeof v === "number", JSON.stringify(s));
    if (/[abdefghijklmnopqrstuvwxyz_$\[\]{};,'"`\\@#~^]/.test(s)) assert.ok(Number.isNaN(v), "Con caracteres no permitidos debe dar NaN: " + JSON.stringify(s));
  }
});

test("numFilter / numM / fmtM", () => {
  const casos = [["12a.5.3", "12.53"], ["", ""], ["abc", ""], ["1,5", "15"], ["..5", ".5"], ["5.", "5."], ["0.30", "0.30"], ["1 2 3", "123"], ["-4", "4"], ["1e5", "15"]];
  casos.forEach(([e, s]) => assert.strictEqual(W.numFilter(e), s, JSON.stringify(e)));
  const rng = crearRng(5);
  for (let i = 0; i < 200; i++) {
    let s = ""; const n = rng.int(0, 10);
    for (let j = 0; j < n; j++) s += "0123456789.,-+ abc"[rng.int(0, 17)];
    assert.strictEqual(W.numFilter(s), numFilterRef(s), JSON.stringify(s));
  }
  assert.strictEqual(W.numM("0.5 m"), 0.5);
  assert.strictEqual(W.numM("1,5 m"), 1.5);
  assert.ok(Number.isNaN(W.numM("")));
  assert.ok(Number.isNaN(W.numM(null)));
  assert.strictEqual(W.fmtM(0.5), "0.5 m");
  assert.strictEqual(W.fmtM(1), "1 m");
  assert.strictEqual(W.fmtM(0.30000000000000004), "0.3 m");
});

/* ── a través de la interfaz: la cota se calcula al escribir la capa ── */
test("UI: al escribir la capa, la cota se calcula y sale en el texto (Tajo capa 26/27; 2E capa 15/16)", async () => {
  const a = await cargarApp({ semilla: 3 });
  try {
    const capa = () => a.document.querySelector('[data-fk="capa"]');
    const cotaVisible = () => a.document.querySelector('[data-fk="cota"]').value;
    await a.elegirFrente("tajo"); await a.elegirTipo("RELLENO");
    await a.clickTexto("RELLENO CONTROLADO");
    await a.clickTexto("TAJO 5E"); // al elegir la procedencia aparecen los campos siguientes (cota, área…)
    await a.escribir(capa(), "26");
    assert.strictEqual(a.json("state.form.cota"), "2773");
    assert.strictEqual(cotaVisible(), "2773");
    await a.escribir(capa(), "27");
    assert.strictEqual(a.json("state.form.cota"), "2774");
    assert.strictEqual(cotaVisible(), "2774");

    await a.elegirFrente("pad2e"); await a.elegirTipo("RELLENO");
    await a.clickTexto("RELLENO ESTRUCTURAL");
    await a.clickTexto("PROPIO");
    await a.escribir(capa(), "15");
    assert.strictEqual(a.json("state.form.cota"), "2810.5");
    assert.strictEqual(cotaVisible(), "2810.5");
    await a.escribir(capa(), "16");
    assert.strictEqual(a.json("state.form.cota"), "2811");
    // "OTRO" (capa de texto): la cota ya no se calcula sola
    await a.clickTexto("OTRO");
    assert.strictEqual(a.json("state.form.cota"), "");
    assert.deepStrictEqual(a.errores.map(String), []);
  } finally { a.cerrar(); }
});

test("UI: suelo de baja permeabilidad ofrece N° de capas según la estructura (zanja 1–3, berma 1–4, banqueta única)", async () => {
  const a = await cargarApp({ semilla: 4 });
  try {
    await a.elegirFrente("pad2e"); await a.elegirTipo("RELLENO");
    await a.clickTexto("SUELO DE BAJA PERMEABILIDAD");
    await a.clickTexto("ZANJA DE ANCLAJE");
    assert.deepStrictEqual(a.json("buildCtx().d.capasBPOpts"), ["1", "2", "3"]);
    await a.clickTexto("BERMA PERIMETRAL");
    assert.deepStrictEqual(a.json("buildCtx().d.capasBPOpts"), ["1", "2", "3", "4"]);
    await a.clickTexto("BANQUETA");
    assert.strictEqual(a.json("buildCtx().d.capaFija"), true, "banqueta: capa única");
    assert.deepStrictEqual(a.json("buildCtx().d.capaFinal"), "UNICA");
  } finally { a.cerrar(); }
});
