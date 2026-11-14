"use strict";
/* Verificaciones sobre el texto generado por computeTexto(): sin basura, con las líneas esperadas
 * (según el estado S/O/N de cada línea configurada) y con formato de valor razonable. */
const assert = require("node:assert");

const JS_BANDERAS = `JSON.stringify((function(){
  var ctx = buildCtx(), d = ctx.d, tipo = state.tipo, o = {L:{},on:{},d:{}};
  (LINEAS[tipo]||[]).forEach(function(x){ o.L[x[0]] = d.L(x[0]); o.on[x[0]] = d.on(x[0]); });
  ["esSoloFund","esOverCol","esDoble","showProgRell","fundCotas","gravaLabel"].forEach(function(k){ o.d[k] = d[k]; });
  o.d.procFinal = d.procFinal || ""; o.sup = d.sup || "";
  o.tipo = tipo; o.frente = getFrente(state.estructura).nombre; o.largo = cfg.tipos[tipo].largo;
  o.supervisores = cfg.supervisores.map(function(s){ return s.toUpperCase(); });
  return o; })())`;

/* secuencia esperada de etiquetas (en el orden de SCHEMAS[tipo].output) */
function etiquetasEsperadas(tipo, b) {
  const L = b.L, on = b.on, d = b.d, out = [];
  const add = (cond, et) => { if (cond) out.push(et); };
  switch (tipo) {
    case "RELLENO":
      add(L.MAT !== "N", "MATERIAL"); add(on.PROC && !!d.procFinal, "PROCEDENCIA"); add(on.CAPA, "CAPA"); add(on.ESP, "ESPESOR");
      add(on.AREA, "ÁREA"); add(on.COTA, "COTA"); add(d.showProgRell, "PROGRESIVA"); add(L.ENS !== "N", "ENSAYO");
      add(on.NENS, "N° ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    case "SUBDRENES":
      add(!d.esSoloFund && L.LONG !== "N", "LONG. TUB"); add(on.AREA, "ÁREA"); add(on.LINEA, "LÍNEA"); add(L.COTA !== "N", "COTA");
      add(on.PROG, "PROGRESIVA"); add(L.ENS !== "N", "ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    case "SIST_SUBD":
      add(d.esSoloFund && on.AREA, "ÁREA"); add(!d.esSoloFund && on.LONG, "LONG. TUB"); add(d.esDoble && !d.esSoloFund && on.LONG, "LONG. TUB");
      add(!d.esSoloFund && on.GRAVA, d.gravaLabel); add(L.COTA !== "N", "COTA"); add(on.PROG, "PROGRESIVA");
      add(L.ENS !== "N", "ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    case "COLECCION":
      add(L.LONG !== "N", "LONG. TUB"); add(d.esOverCol && on.AREA, "ÁREA"); add(L.COTA !== "N", "COTA"); add(on.PROG, "PROGRESIVA");
      add(L.ENS !== "N", "ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    case "OVERLINER":
      add(L.MAT !== "N", "MATERIAL"); add(L.ESP !== "N", "ESPESOR"); add(on.AREA, "ÁREA"); add(L.COTA !== "N", "COTA");
      add(L.ENS !== "N", "ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    case "FUNDACION":
      add(on.AREA, "ÁREA"); add(L.COTA !== "N" && d.fundCotas, "COTA SUP."); add(L.COTA !== "N" && !d.fundCotas, "COTA");
      add(d.fundCotas, "COTA INF."); add(on.PROG, "PROGRESIVA"); add(L.ENS !== "N", "ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    case "EVALUACION":
      add(L.MAT !== "N", "MATERIAL"); add(on.AREA, "ÁREA"); add(on.PROG, "PROGRESIVA"); add(L.ENS !== "N", "ENSAYO"); add(L.PROT !== "N", "PROTOCOLO"); break;
    default: assert.fail("Tipo de liberación sin tabla de líneas esperadas en el arnés: " + tipo + " (¿se agregó un tipo nuevo? actualizar tests/helpers/textoEsperado.js)");
  }
  out.push("SUPERVISOR CQC");
  return out;
}

const NUM = "\\d+(?:\\.\\d+)?";
const FORMATO_VALOR = {
  "ÁREA": new RegExp("^" + NUM + " m²$"),
  "LONG. TUB": new RegExp("^" + NUM + " m$"),
  "COTA": new RegExp("^(?:" + NUM + " msnm|VARIABLE)$"),
  "COTA SUP.": new RegExp("^" + NUM + "$"),
  "COTA INF.": new RegExp("^" + NUM + "$"),
  "PROGRESIVA": new RegExp("^" + NUM.replace("\\d+", "\\d+\\+\\d+") + " - " + NUM.replace("\\d+", "\\d+\\+\\d+") + "$"),
  "ENSAYO": /^(?:SÍ|NO)$/,
  "PROTOCOLO": /^(?:SÍ|NO)$/,
  "GRAVA Y GEOTEXTIL": new RegExp("^" + NUM + " m²$"),
  "FUNDACIÓN": new RegExp("^" + NUM + " m²$"),
};

const BASURA = /undefined|NaN|\bnull\b|Infinity|\[object|\bNULL\b/;

/** Revisa un texto generado. Lanza AssertionError con el texto completo para depurar. */
function verificarTexto(app, texto, contexto) {
  const ctx = contexto ? "\n" + contexto : "";
  const dump = "\n----- texto -----\n" + texto + "\n-----------------" + ctx;
  assert.strictEqual(typeof texto, "string", "computeTexto() debe devolver string cuando el formulario está completo" + ctx);
  assert.ok(!BASURA.test(texto), "El texto contiene undefined/NaN/null/Infinity/[object" + dump);
  const lineas = texto.split("\n");
  const b = JSON.parse(app.run(JS_BANDERAS));

  assert.ok(lineas[0].startsWith("TIPO DE LIBERACIÓN: " + b.largo), "Primera línea debe empezar con el tipo configurado «" + b.largo + "»" + dump);
  assert.strictEqual(lineas[1], "ESTRUCTURA: " + b.frente, "Segunda línea debe ser la estructura (nombre completo del frente)" + dump);
  lineas.forEach((l, i) => {
    assert.ok(/^[^:]+: \S.*\S$|^[^:]+: \S$/.test(l), `Línea ${i + 1} sin «ETIQUETA: valor» o con valor vacío/espacios: «${l}»` + dump);
    assert.ok(!/\s{2,}/.test(l), `Línea ${i + 1} con espacios dobles: «${l}»` + dump);
    assert.ok(!/\(\s*\)/.test(l), `Línea ${i + 1} con paréntesis vacíos: «${l}»` + dump);
    assert.ok(!/ - \)|\( - /.test(l), `Línea ${i + 1} con separador huérfano: «${l}»` + dump);
  });
  const normaliza = (et) => et.replace(/\s*\(.*\)\s*$/, "");
  const obtenidas = lineas.slice(2).map((l) => normaliza(l.slice(0, l.indexOf(": "))));
  const esperadas = etiquetasEsperadas(b.tipo, b);
  assert.deepStrictEqual(obtenidas, esperadas, "Líneas del texto distintas de las esperadas según la configuración de líneas" + dump);

  lineas.slice(2).forEach((l) => {
    const et = normaliza(l.slice(0, l.indexOf(": ")));
    const v = l.slice(l.indexOf(": ") + 2);
    if (et === "SUPERVISOR CQC") assert.ok(b.supervisores.includes(v), `Supervisor «${v}» no está en la configuración` + dump);
    else if (FORMATO_VALOR[et]) assert.ok(FORMATO_VALOR[et].test(v), `Formato inesperado en ${et}: «${v}»` + dump);
    if (et === "ENSAYO" && b.tipo === "FUNDACION") assert.strictEqual(v, "NO", "En fundación el ensayo siempre es NO" + dump);
  });
  return lineas;
}

module.exports = { verificarTexto, etiquetasEsperadas, JS_BANDERAS, BASURA };
