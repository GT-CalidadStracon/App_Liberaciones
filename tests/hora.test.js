"use strict";
/* Turno (día/noche) y fecha de la liberación vistos desde la app, con reloj falso.
 * La regla (hora de Lima, UTC-5): DÍA 07:00–18:59 · NOCHE 19:00–06:59 (de 00:00 a 06:59 cuenta para el día anterior).
 * Las reglas puras de turno.js se prueban en tests/turno.test.js. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearServidorMock, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");

const lima = (iso) => Date.parse(iso + "-05:00");
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const rotuloFecha = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`; };
const txtTurno = (app) => app.document.querySelector("button.turno span").textContent.trim();
const txtFecha = (app) => app.document.querySelector(".fechabtn span").textContent.trim();

const CASOS = [
  ["2026-11-14T06:59:00", "noche", "2026-11-13"],
  ["2026-11-14T07:00:00", "día", "2026-11-14"],
  ["2026-11-14T12:00:00", "día", "2026-11-14"],
  ["2026-11-14T18:59:59", "día", "2026-11-14"],
  ["2026-11-14T19:00:00", "noche", "2026-11-14"],
  ["2026-11-14T23:59:59", "noche", "2026-11-14"],
  ["2026-11-15T00:00:00", "noche", "2026-11-14"],
  ["2026-11-15T04:00:00", "noche", "2026-11-14"],
  ["2026-12-01T03:00:00", "noche", "2026-11-30"],   // cambio de mes
  ["2027-01-01T02:00:00", "noche", "2026-12-31"],   // cambio de año
  ["2028-03-01T05:00:00", "noche", "2028-02-29"],   // año bisiesto
];

test("al abrir la app, el turno y la fecha salen de la hora de Lima", async () => {
  for (const [iso, turno, fecha] of CASOS) {
    const app = await cargarApp({ ahora: lima(iso) });
    try {
      assert.strictEqual(txtTurno(app), "Turno " + turno, iso);
      assert.strictEqual(txtFecha(app), rotuloFecha(fecha), iso);
      assert.deepStrictEqual(app.errores.map(String), [], iso);
    } finally { app.cerrar(); }
  }
});

test("no depende de la zona horaria del celular", async () => {
  const antes = process.env.TZ;
  try {
    for (const tz of ["America/Lima", "Asia/Tokyo", "Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = tz;
      for (const [iso, turno, fecha] of [CASOS[0], CASOS[4], CASOS[7], CASOS[9]]) {
        const app = await cargarApp({ ahora: lima(iso) });
        try {
          assert.strictEqual(txtTurno(app), "Turno " + turno, `${iso} con TZ=${tz}`);
          assert.strictEqual(txtFecha(app), rotuloFecha(fecha), `${iso} con TZ=${tz}`);
        } finally { app.cerrar(); }
      }
    }
  } finally { if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes; }
});

test("con la app abierta, el turno cambia solo a las 19:00 y a las 07:00 (y la fecha al pasar de noche a día)", async () => {
  const app = await cargarApp({ ahora: lima("2026-11-14T18:59:40") });
  try {
    assert.strictEqual(txtTurno(app), "Turno día");
    await app.avanzar(61000);
    assert.strictEqual(txtTurno(app), "Turno noche", "pasadas las 19:00 debe pasar a noche sin tocar nada");
    assert.strictEqual(txtFecha(app), rotuloFecha("2026-11-14"));
    await app.avanzar(5 * 3600000 + 59 * 60000);        // 00:59 del 15
    assert.strictEqual(txtTurno(app), "Turno noche");
    assert.strictEqual(txtFecha(app), rotuloFecha("2026-11-14"), "de madrugada la noche sigue siendo del día anterior");
    app.reloj.fijar(lima("2026-11-15T06:59:40"));
    await app.avanzar(60000);                           // 07:00:40
    assert.strictEqual(txtTurno(app), "Turno día");
    assert.strictEqual(txtFecha(app), rotuloFecha("2026-11-15"), "al amanecer cambia el día de trabajo");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

async function liberacionLista(app) {
  await app.elegirFrente("pad2f"); await app.elegirTipo("FUNDACION");
  app.run("prefs.supervisor = ''; resetForm(); render();");
  return (await llenarFormulario(app, { rng: crearRng(11), revisiones: 0 })).texto;
}

test("la liberación sube con el turno y la día de trabajo de la hora de Lima", async () => {
  for (const [iso, turno, fecha] of [CASOS[0], CASOS[1], CASOS[4], CASOS[7], CASOS[8]]) {
    const servidor = crearServidorMock();
    const app = await cargarApp({ servidor, ahora: lima(iso) });
    try {
      await liberacionLista(app);
      await app.subir();
      assert.strictEqual(servidor.guardados.length, 1, iso);
      const g = servidor.guardados[0];
      assert.strictEqual(g.turno, turno === "día" ? "DÍA" : "NOCHE", iso);
      assert.strictEqual(g.fecha, fecha, iso);
      assert.strictEqual(g.turnoAuto, g.turno, "sin ajuste manual el turno automático coincide");
      assert.strictEqual(g.fechaAuto, g.fecha);
      assert.strictEqual(g.ajusteManual, false);
      assert.ok(g.creado > 0);
    } finally { app.cerrar(); }
  }
});

test("antes de subir pide confirmar turno y día: Cancelar no envía nada, «Sí, registrar» envía", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, ahora: lima("2026-11-14T04:00:00") });
  try {
    await liberacionLista(app);
    const subir = () => app.click(app.botones(/Subir liberación/, app.document.getElementById("outbox"))[0]);
    await subir();
    const ov = app.document.getElementById("ovTurno");
    assert.ok(ov, "debe aparecer el cuadro de confirmación");
    assert.match(ov.textContent, /Turno y día correctos|¿Turno y día correctos\?/);
    assert.match(ov.textContent, /noche/i);
    assert.match(ov.textContent, /13\/11/, "de madrugada del 14 la noche cuenta para el 13");
    const antes = servidor.contarAcciones("addLib");
    await app.clickTexto("Cancelar", ov);
    assert.strictEqual(app.document.getElementById("ovTurno"), null);
    assert.strictEqual(servidor.contarAcciones("addLib"), antes, "cancelar no envía");
    assert.strictEqual(app.cola.length, 0);
    await subir();
    await app.clickTexto(/^Sí, registrar$/, app.document.getElementById("ovTurno"));
    await app.vaciar();
    assert.strictEqual(servidor.guardados.length, 1);
  } finally { app.cerrar(); }
});

test("cambio manual de turno: sube con lo elegido, marca ajuste manual y a las 2 h vuelve a automático", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, ahora: lima("2026-11-14T10:00:00") });
  try {
    await liberacionLista(app);
    assert.strictEqual(txtTurno(app), "Turno día");
    await app.click(app.document.querySelector("button.turno"));
    assert.strictEqual(txtTurno(app), "Turno noche");
    assert.strictEqual(txtFecha(app), rotuloFecha("2026-11-13"), "una noche elegida a las 10:00 solo puede ser la de ayer");
    await app.subir();
    assert.strictEqual(servidor.guardados.length, 1);
    const g = servidor.guardados[0];
    assert.strictEqual(g.turno, "NOCHE");
    assert.strictEqual(g.fecha, "2026-11-13");
    assert.strictEqual(g.turnoAuto, "DÍA");
    assert.strictEqual(g.fechaAuto, "2026-11-14");
    assert.strictEqual(g.ajusteManual, true);
    // vigencia del ajuste manual: 2 h
    await app.avanzar(2 * 3600000 + 60000);
    await app.elegirFrente("pad2e");     // cualquier redibujado
    assert.strictEqual(txtTurno(app), "Turno día", "pasadas 2 h el turno vuelve a ser el automático");
  } finally { app.cerrar(); }
});

test("el cuadro de confirmación rechaza fechas futuras y avisa de fechas antiguas", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, ahora: lima("2026-11-14T10:00:00") });
  try {
    await liberacionLista(app);
    await app.click(app.botones(/Subir liberación/, app.document.getElementById("outbox"))[0]);
    const fecha = () => app.document.getElementById("ovFecha");
    const cambiar = async (v) => { fecha().value = v; fecha().dispatchEvent(new app.window.Event("change", { bubbles: true })); await app.vaciar(); };
    await cambiar("2026-11-12");
    assert.match(app.document.getElementById("ovTurno").textContent, /hace 2 días/);
    await cambiar("2026-11-20");           // futura
    await app.clickTexto(/^Sí, registrar$/, app.document.getElementById("ovTurno"));
    await app.vaciar();
    assert.ok(app.document.getElementById("ovTurno"), "con fecha futura el cuadro no se cierra");
    assert.strictEqual(servidor.contarAcciones("addLib"), 0, "no debe enviarse con fecha futura");
    await cambiar("2026-11-13");
    await app.clickTexto(/^Sí, registrar$/, app.document.getElementById("ovTurno"));
    await app.vaciar();
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(servidor.guardados[0].fecha, "2026-11-13");
    assert.strictEqual(servidor.guardados[0].ajusteManual, true);
  } finally { app.cerrar(); }
});
