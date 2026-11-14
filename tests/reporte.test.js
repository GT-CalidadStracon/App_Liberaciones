"use strict";
/* Reporte diario en Excel de punta a punta: se suben liberaciones (como las sube el equipo), la app arma el .xlsx
 * con ExcelJS dentro de la página y aquí se abre con ExcelJS para comprobar su contenido. */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { cargarApp, crearServidorMock, crearRng, RAIZ } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");
const { BASURA } = require("./helpers/textoEsperado");
const ExcelJS = require(path.join(RAIZ, "exceljs.min.js"));

const AHORA = Date.parse("2026-11-14T10:00:00-05:00");
const FECHA = "2026-11-14";

/* una liberación de cada tipo/categoría de reporte */
const PLAN = [
  ["pad2d", "RELLENO", 1], ["pad2e", "RELLENO", 2], ["pad2en", "RELLENO", 3], ["tajo", "RELLENO", 4], ["compensacion", "RELLENO", 5],
  ["pad2d", "SUBDRENES", 6], ["tajo", "SIST_SUBD", 7], ["pad2d", "COLECCION", 8], ["pad2f", "FUNDACION", 9], ["pad2f", "EVALUACION", 10], ["pad2f", "OVERLINER", 11],
];

async function subirPlan(app, plan, conFoto) {
  const textos = [];
  for (const [fr, tp, sem] of plan) {
    await app.run("abrirRegistro()"); await app.vaciar();   // tras subir, la app vuelve a Inicio
    await app.elegirFrente(fr);
    if (app.json("state.tipo") !== tp) await app.elegirTipo(tp);
    app.run("prefs.supervisor = ''; resetForm(); render();");
    const r = await llenarFormulario(app, { rng: crearRng(sem * 31), revisiones: 0 });
    if (conFoto && sem % 4 === 0) await app.adjuntarFoto();
    await app.subir();
    textos.push(r.texto);
  }
  return textos;
}

async function pedirReporte(app, fecha, turno) {
  const blobs = [], nombres = [];
  app.window.URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
  app.document.addEventListener("click", (e) => { if (e.target && e.target.download) nombres.push(e.target.download); }, true);
  const btn = app.document.createElement("button");
  app.document.body.appendChild(btn);
  app.window.generarReporte(fecha, btn, turno);
  // ExcelJS usa temporizadores: con el reloj falso hay que hacerlos avanzar
  for (let i = 0; i < 600 && !blobs.length && !/⚠/.test(btn.textContent); i++) { await new Promise((r) => setTimeout(r, 10)); await app.avanzar(20); }
  assert.ok(blobs.length, "el reporte no se generó: botón dice «" + btn.textContent + "»");
  const buf = Buffer.from(await blobs[0].arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { wb, nombre: nombres[0], boton: btn.textContent };
}
const celdas = (ws) => {
  const v = [];
  ws.eachRow((row) => row.eachCell((c) => {
    if (c.value != null && c.value !== "") v.push(String(c.value && c.value.richText ? c.value.richText.map((t) => t.text).join("") : c.value));
  }));
  return v;
};

test("el reporte diario trae todas las liberaciones del día con descripción, área y frente correctos", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, ahora: AHORA });
  try {
    const textos = await subirPlan(app, PLAN, true);
    assert.strictEqual(servidor.guardados.length, PLAN.length);
    const { wb, nombre } = await pedirReporte(app, FECHA);
    assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ["R.D.", "P. FOTOG."]);
    assert.match(nombre, /^RD-ST\.QC-PAD2-F2EE2SN-529_2026-11-14.*\.xlsx$/, "nombre del archivo (N° 503 al 19/10 → 529 al 14/11)");
    const rd = celdas(wb.getWorksheet("R.D."));
    const todo = rd.join("\n");
    assert.ok(!BASURA.test(todo), "el reporte contiene undefined/NaN/null:\n" + rd.filter((x) => BASURA.test(x)).join("\n"));
    // cada liberación: su descripción aparece, y el frente
    const interp = textos.map((t) => app.json(`interpretarLib(${JSON.stringify({ id: "x", texto: t, hora: "10:00", turno: "DÍA", fecha: FECHA })})`));
    interp.forEach((r, i) => {
      assert.ok(rd.includes(r.desc), `Falta la descripción «${r.desc}» en la hoja R.D. (${PLAN[i].slice(0, 2).join("/")})`);
      assert.ok(rd.some((c) => c.includes(r.frente.nombre)), "Falta el frente " + r.frente.nombre);
    });
    // las descripciones iguales deben aparecer tantas veces como liberaciones iguales
    const cuenta = (d) => rd.filter((c) => c === d).length;
    interp.forEach((r) => assert.ok(cuenta(r.desc) >= interp.filter((x) => x.desc === r.desc).length, "descripción repetida mal contada: " + r.desc));
    // áreas
    // (el área de «instalación de subdrenes» no sale en el reporte: ver tests/conocidos/reporte.test.js)
    interp.filter((r) => typeof r.area === "number" && r.cat !== "SSUB").forEach((r) =>
      assert.ok(rd.some((c) => Math.abs(parseFloat(c) - r.area) < 0.005), `Falta el área ${r.area} de «${r.desc}»`));
    // encabezado del reporte
    ["REPORTE DIARIO DE CONTROL DE CALIDAD", "CONTRATISTA: STRACON PERU S.A.", "CLIENTE: PAN AMERICAN SILVER PERU S.A.C.", "SUPERVISIÓN CQA: ANDDES"]
      .forEach((x) => assert.ok(rd.some((c) => c.includes(x)), "Falta «" + x + "»"));
    assert.ok(rd.some((c) => /FECHA: 14\/11\/26/.test(c)));
    // fotos: una por cada liberación con foto
    const conFoto = PLAN.filter((p) => p[2] % 4 === 0).length;
    assert.strictEqual(wb.getWorksheet("P. FOTOG.").getImages().length, conFoto, "imágenes en la hoja de fotografías");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("el reporte por turno solo incluye las liberaciones de ese turno", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, ahora: AHORA });
  try {
    await subirPlan(app, [["pad2f", "FUNDACION", 21]]);                 // turno DÍA
    app.reloj.fijar(Date.parse("2026-11-14T21:00:00-05:00"));
    await app.avanzar(40000);
    await subirPlan(app, [["pad2f", "EVALUACION", 22]]);                // turno NOCHE
    assert.deepStrictEqual(servidor.guardados.map((g) => g.turno), ["DÍA", "NOCHE"]);
    const dia = celdas((await pedirReporte(app, FECHA, "DÍA")).wb.getWorksheet("R.D.")).join("\n");
    assert.match(dia, /terreno de fundación/);
    assert.doesNotMatch(dia, /evaluación de material/);
    const noche = celdas((await pedirReporte(app, FECHA, "NOCHE")).wb.getWorksheet("R.D.")).join("\n");
    assert.match(noche, /evaluación de material/);
    assert.doesNotMatch(noche, /terreno de fundación/);
  } finally { app.cerrar(); }
});

test("sin liberaciones ese día el botón avisa y no genera archivo", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, ahora: AHORA });
  try {
    const blobs = [];
    app.window.URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
    const btn = app.document.createElement("button"); app.document.body.appendChild(btn);
    app.window.generarReporte("2026-11-01", btn);
    for (let i = 0; i < 300 && !/⚠/.test(btn.textContent); i++) { await new Promise((r) => setTimeout(r, 10)); await app.avanzar(20); }
    assert.match(btn.textContent, /No hay liberaciones ese día/);
    assert.strictEqual(blobs.length, 0);
  } finally { app.cerrar(); }
});
