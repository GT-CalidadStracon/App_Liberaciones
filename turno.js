/* Turno y día de trabajo — regla única de la app (y de los reportes).
   Zona horaria fija: Lima (UTC-5, sin horario de verano). No depende de la zona del celular.
     DÍA   07:00–18:59  → fecha de hoy
     NOCHE 19:00–23:59  → fecha de hoy
     NOCHE 00:00–06:59  → fecha de AYER (el turno noche pertenece al día en que empezó)
   Funciona en el navegador (window.Turno) y en Node (module.exports) para las pruebas. */
(function(root){
  "use strict";
  var OFFSET_H = -5;          // Lima
  var INICIO_DIA = 7;         // 07:00
  var INICIO_NOCHE = 19;      // 19:00
  var DIAS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

  function p2(n){ return (n<10?"0":"")+n; }
  function ymd(y,m,d){ return y+"-"+p2(m)+"-"+p2(d); }

  /* partes de la hora de Lima para un instante (ms desde 1970) */
  function partes(ms){
    var d = new Date(ms + OFFSET_H*3600000);
    return {y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), h:d.getUTCHours(), mi:d.getUTCMinutes(), dow:d.getUTCDay()};
  }
  function esFecha(s){
    if(typeof s!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var a = s.split("-"), d = new Date(Date.UTC(+a[0],+a[1]-1,+a[2]));
    return d.getUTCFullYear()===+a[0] && d.getUTCMonth()===+a[1]-1 && d.getUTCDate()===+a[2];
  }
  function sumarDias(fecha,n){
    var a = fecha.split("-"), d = new Date(Date.UTC(+a[0],+a[1]-1,+a[2]+n));
    return ymd(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
  }
  function diasEntre(a,b){   // b - a en días
    var x = a.split("-"), y = b.split("-");
    return Math.round((Date.UTC(+y[0],+y[1]-1,+y[2]) - Date.UTC(+x[0],+x[1]-1,+x[2]))/86400000);
  }
  /* fecha calendario de Lima (off = días de desplazamiento) */
  function hoy(ms,off){
    var p = partes(ms==null?Date.now():ms), f = ymd(p.y,p.m,p.d);
    return off ? sumarDias(f,off) : f;
  }
  function hora(ms){ var p = partes(ms==null?Date.now():ms); return p2(p.h)+":"+p2(p.mi); }

  /* turno que corresponde a una hora del reloj (0–23) */
  function turnoDeHora(h){ return (h>=INICIO_DIA && h<INICIO_NOCHE) ? "DÍA" : "NOCHE"; }

  /* turno y fecha que corresponden a un instante */
  function detectar(ms){
    ms = ms==null ? Date.now() : ms;
    var p = partes(ms), hoyF = ymd(p.y,p.m,p.d);
    var t = turnoDeHora(p.h);
    var f = p.h<INICIO_DIA ? sumarDias(hoyF,-1) : hoyF;
    return {turno:t, fecha:f, hora:p2(p.h)+":"+p2(p.mi)};
  }

  /* fecha del día de trabajo si el usuario elige a mano un turno distinto al detectado:
     un turno no puede estar en el futuro, así que NOCHE de día (07–18) es la de ayer y
     DÍA de madrugada (00–06) es el de ayer. */
  function fechaPara(turno,ms){
    ms = ms==null ? Date.now() : ms;
    var p = partes(ms), hoyF = ymd(p.y,p.m,p.d);
    if(p.h<INICIO_DIA) return sumarDias(hoyF,-1);
    if(p.h<INICIO_NOCHE) return turno==="NOCHE" ? sumarDias(hoyF,-1) : hoyF;
    return hoyF;
  }

  /* turno/fecha de una fila antigua que solo tiene FECHA calendario y HORA ("2026-11-06","04:33") */
  function desdeFechaHora(fecha,hhmm){
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm||"");
    if(!esFecha(fecha) || !m) return null;
    var h = +m[1], t = turnoDeHora(h);
    return {turno:t, fecha: h<INICIO_DIA ? sumarDias(fecha,-1) : fecha};
  }

  function rotulo(turno,fecha){
    var a = fecha.split("-"), d = new Date(Date.UTC(+a[0],+a[1]-1,+a[2]));
    return (turno==="NOCHE"?"NOCHE":"DÍA")+" · "+DIAS[d.getUTCDay()]+" "+a[2]+"/"+a[1];
  }
  function fechaCorta(fecha){
    var a = fecha.split("-"), d = new Date(Date.UTC(+a[0],+a[1]-1,+a[2]));
    return DIAS[d.getUTCDay()]+" "+a[2]+"/"+a[1]+"/"+a[0];
  }

  var api = {INICIO_DIA:INICIO_DIA, INICIO_NOCHE:INICIO_NOCHE, partes:partes, esFecha:esFecha, sumarDias:sumarDias,
    diasEntre:diasEntre, hoy:hoy, hora:hora, turnoDeHora:turnoDeHora, detectar:detectar, fechaPara:fechaPara,
    desdeFechaHora:desdeFechaHora, rotulo:rotulo, fechaCorta:fechaCorta};
  if(typeof module!=="undefined" && module.exports) module.exports = api; else root.Turno = api;
})(typeof window!=="undefined" ? window : this);
