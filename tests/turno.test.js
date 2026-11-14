const test = require("node:test");
const assert = require("node:assert");
const T = require("../turno.js");

// instante a partir de una hora de Lima (UTC-5)
const lima = (iso) => Date.parse(iso + "-05:00");

test("bordes del turno día/noche", () => {
  const casos = [
    ["2026-11-13T06:59:00", "NOCHE", "2026-11-12"],
    ["2026-11-13T07:00:00", "DÍA",   "2026-11-13"],
    ["2026-11-13T18:59:59", "DÍA",   "2026-11-13"],
    ["2026-11-13T19:00:00", "NOCHE", "2026-11-13"],
    ["2026-11-13T23:59:59", "NOCHE", "2026-11-13"],
    ["2026-11-14T00:00:00", "NOCHE", "2026-11-13"],
    ["2026-11-14T04:00:00", "NOCHE", "2026-11-13"], // caso del usuario: 4 am del 14 cuenta para el 13
  ];
  for (const [iso, turno, fecha] of casos) {
    const r = T.detectar(lima(iso));
    assert.strictEqual(r.turno, turno, iso);
    assert.strictEqual(r.fecha, fecha, iso);
  }
});

test("no depende de la zona horaria del celular (se calcula con UTC-5)", () => {
  // 2026-11-14 09:00 UTC = 04:00 en Lima → NOCHE del 13
  const r = T.detectar(Date.UTC(2026, 10, 14, 9, 0, 0));
  assert.deepStrictEqual([r.turno, r.fecha, r.hora], ["NOCHE", "2026-11-13", "04:00"]);
});

test("cambio de mes y de año", () => {
  assert.strictEqual(T.detectar(lima("2026-12-01T03:00:00")).fecha, "2026-11-30");
  assert.strictEqual(T.detectar(lima("2027-01-01T00:30:00")).fecha, "2026-12-31");
  assert.strictEqual(T.detectar(lima("2028-03-01T02:00:00")).fecha, "2028-02-29"); // bisiesto
});

test("fechaPara: elección manual de turno distinto al detectado", () => {
  assert.strictEqual(T.fechaPara("NOCHE", lima("2026-11-13T10:00:00")), "2026-11-12"); // noche de ayer
  assert.strictEqual(T.fechaPara("DÍA",   lima("2026-11-13T10:00:00")), "2026-11-13");
  assert.strictEqual(T.fechaPara("DÍA",   lima("2026-11-14T04:00:00")), "2026-11-13"); // día que acaba de terminar
  assert.strictEqual(T.fechaPara("NOCHE", lima("2026-11-14T04:00:00")), "2026-11-13");
  assert.strictEqual(T.fechaPara("DÍA",   lima("2026-11-13T20:00:00")), "2026-11-13");
  assert.strictEqual(T.fechaPara("NOCHE", lima("2026-11-13T20:00:00")), "2026-11-13");
});

test("filas antiguas (fecha calendario + hora) → día de trabajo", () => {
  assert.deepStrictEqual(T.desdeFechaHora("2026-11-06", "04:33"), {turno: "NOCHE", fecha: "2026-11-05"});
  assert.deepStrictEqual(T.desdeFechaHora("2026-10-20", "05:58"), {turno: "NOCHE", fecha: "2026-10-19"});
  assert.deepStrictEqual(T.desdeFechaHora("2026-10-20", "10:27"), {turno: "DÍA", fecha: "2026-10-20"});
  assert.deepStrictEqual(T.desdeFechaHora("2026-10-22", "18:07"), {turno: "DÍA", fecha: "2026-10-22"});
  assert.strictEqual(T.desdeFechaHora("basura", "10:00"), null);
});

test("validación y utilidades de fecha", () => {
  assert.ok(T.esFecha("2026-02-28"));
  assert.ok(!T.esFecha("2026-02-30"));
  assert.ok(!T.esFecha("2026-2-3"));
  assert.ok(!T.esFecha(null));
  assert.strictEqual(T.sumarDias("2026-03-01", -1), "2026-02-28");
  assert.strictEqual(T.diasEntre("2026-10-19", "2026-11-13"), 25);
  assert.strictEqual(T.rotulo("NOCHE", "2026-11-13"), "NOCHE · Vie 13/11");
});
