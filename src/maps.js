(function (G) {
  'use strict';

  // Mapas de los enfrentamientos (inspirados en los de los vídeos de referencia, con diseño propio).
  // Cada mapa se describe una vez con primitivas en coordenadas del mundo (suelo, muros, edificios,
  // contenedores, muebles, vehículos, árboles, hierba alta, charcos) y World los aplica chunk a chunk.
  // Los mapas no dependen del modo: cualquier enfrentamiento (asalto o caza) puede tocar en cualquiera.
  //
  // Contenedores de carga: ocupan casillas enteras (2 de ancho, 6 o 12 de largo). Sus costados son aristas
  // CONT (tapan la vista y el paso como una pared) y su techo es transitable (deck): se puede trepar a uno
  // de una altura y, desde arriba, a los de encima. Los abiertos se pueden recorrer por dentro.

  const U = G.Util;
  const MAPS = {};
  const LEVEL_H = 2.6;           // alto de un contenedor

  // ---------- Constructor de primitivas ----------
  function maker() {
    const P = { ground: [], edges: [], blds: [], furn: [], conts: [], obj: [], tall: [], occ: new Map() };
    const key = (x, z) => x + ',' + z;
    const occ = (x0, z0, x1, z1, v) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) P.occ.set(key(x, z), v || 1); };
    const free = (x0, z0, x1, z1) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (P.occ.has(key(x, z))) return false; return true; };
    const api = {
      P, occ, free,
      ground(x0, z0, x1, z1, g) { P.ground.push([x0, z0, x1, z1, g]); },
      // muro a lo largo de x en la línea z (casillas x0..x1-1) o a lo largo de z en la línea x
      wallN(x0, x1, z, e) { for (let x = x0; x < x1; x++) P.edges.push(['N', x, z, e]); },
      wallW(z0, z1, x, e) { for (let z = z0; z < z1; z++) P.edges.push(['W', x, z, e]); },
      edge(o, x, z, e) { P.edges.push([o, x, z, e]); },
      building(id, ox, oz, w, h, front, post) { P.blds.push({ id, ox, oz, front, post }); occ(ox - 1, oz - 1, ox + w + 1, oz + h + 1, 'b'); },
      // mueble centrado en (x, z), con el frente hacia (fx, fz); ex: más campos (col, open...)
      put(type, x, z, fx, fz, ex) {
        const t = G.Furniture.T[type], along = Math.abs(fz) > 0.5;
        const hw = (along ? t.w : t.d) / 2, hd = (along ? t.d : t.w) / 2;
        const f = Object.assign({ type, lv: 0, x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, y: 0, h: t.h, fx, fz, solid: !t.deco, cont: null }, ex || {});
        P.furn.push(f);
        if (!t.flat) occ(Math.floor(f.x0), Math.floor(f.z0), Math.ceil(f.x1), Math.ceil(f.z1), 'f');
        return f;
      },
      // ¿cabe un mueble ahí (con un margen libre alrededor)?
      fits(type, x, z, fx, fz, m) {
        const t = G.Furniture.T[type], along = Math.abs(fz) > 0.5;
        const hw = (along ? t.w : t.d) / 2, hd = (along ? t.d : t.w) / 2;
        m = m == null ? 1 : m;
        return free(Math.floor(x - hw) - m, Math.floor(z - hd) - m, Math.ceil(x + hw) + m, Math.ceil(z + hd) + m);
      },
      // contenedor: esquina (x, z) de su planta, eje 'x' o 'z', largo 6 o 12, pisos apilados (1 a 3)
      // o: { open: true (solo de un piso: puertas abiertas en el extremo final), cols: [colores por piso] }
      cont(x, z, axis, len, levels, o) {
        o = o || {};
        const w = axis === 'x' ? len : 2, d = axis === 'x' ? 2 : len;
        P.conts.push({ x, z, axis, len, levels: o.open ? 1 : levels, open: o.open || false, cols: o.cols || null, w, d, lod: o.lod || 0 });
        occ(x, z, x + w, z + d, 'c');
      },
      tree(x, z, pine) { P.obj.push([x, z, pine ? 2 : 1]); occ(x, z, x + 1, z + 1, 't'); },
      bush(x, z) { P.obj.push([x, z, 4]); },
      pole(x, z) { P.obj.push([x, z, 3]); occ(x, z, x + 1, z + 1, 't'); },
      tall(x0, z0, x1, z1) { P.tall.push(['r', x0, z0, x1, z1]); },
      tallCircle(x, z, r) { P.tall.push(['c', x, z, r]); },
      puddle(x, z, w, d) { P.furn.push({ type: 'charco', lv: 0, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: 0, h: 0.01, fx: 0, fz: 1, solid: false, cont: null }); }
    };
    return api;
  }

  function prims(id) {
    const m = MAPS[id];
    if (!m.P) {
      const api = maker();
      m.build(api, U.mulberry32(m.seed || 7));
      m.P = api.P;
    }
    return m.P;
  }

  // ---------- Aplicar a un chunk ----------
  // phase 'base': suelo, muros, edificios, contenedores (aristas y techos), árboles e hierba alta
  // phase 'props': muebles, vehículos y los modelos de los contenedores (después de amueblar los edificios)
  function apply(id, c, cx, cz, rng, W, phase) {
    const P = prims(id), CS = G.World.CS, E = G.World.E;
    const X0 = cx * CS, Z0 = cz * CS;
    const inC = (x, z) => x >= X0 && z >= Z0 && x < X0 + CS && z < Z0 + CS;
    const li = (x, z) => (z - Z0) * CS + (x - X0);
    if (phase === 'base') {
      for (const [x0, z0, x1, z1, g] of P.ground) {
        for (let z = Math.max(z0, Z0); z < Math.min(z1, Z0 + CS); z++) for (let x = Math.max(x0, X0); x < Math.min(x1, X0 + CS); x++) c.ground[li(x, z)] = g;
      }
      // contenedores: costados (aristas) y techos transitables
      for (const k of P.conts) {
        const x1 = k.x + k.w, z1 = k.z + k.d;
        const deckH = k.open ? 0 : Math.round(k.levels * LEVEL_H * 10);
        for (let z = k.z; z < z1; z++) {
          for (let x = k.x; x < x1; x++) {
            if (!inC(x, z)) continue;
            if (deckH) { if (!c.deck) c.deck = new Uint8Array(CS * CS); c.deck[li(x, z)] = Math.max(c.deck[li(x, z)], deckH); }
            else { if (!c.croof) c.croof = new Uint8Array(CS * CS); c.croof[li(x, z)] = Math.round(LEVEL_H * 10); }   // abierto: techo por dentro
            c.tall[li(x, z)] = 0;
          }
        }
        // abierto: las puertas del extremo final (o de los dos extremos: un túnel que se cruza)
        const endA = k.open === 'both', endB = !!k.open;
        for (let x = k.x; x < x1; x++) {
          if (inC(x, k.z) && !(k.axis === 'z' && endA)) c.eN[li(x, k.z)] = E.CONT;
          if (inC(x, z1) && !(k.axis === 'z' && endB)) c.eN[li(x, z1)] = E.CONT;
        }
        for (let z = k.z; z < z1; z++) {
          if (inC(k.x, z) && !(k.axis === 'x' && endA)) c.eW[li(k.x, z)] = E.CONT;
          if (inC(x1, z) && !(k.axis === 'x' && endB)) c.eW[li(x1, z)] = E.CONT;
        }
      }
      for (const [o, x, z, e] of P.edges) {
        if (!inC(x, z)) continue;
        (o === 'N' ? c.eN : c.eW)[li(x, z)] = e;
      }
      for (const b of P.blds) {
        if (!inC(b.ox, b.oz)) continue;
        const bb = W.placeBuilding(b.id, b.ox - X0, b.oz - Z0, b.front);
        // en los mapas no hay puertas: los huecos quedan abiertos. Salvo en el salón recreativo (jefe final): ahí
        // las puertas están (abiertas al empezar), porque el hongomorfo no cabe por ellas
        const keep = !!(bb.bp && bb.bp.def && bb.bp.def.breakable);
        const to = keep ? E.DOOR_OPEN : E.ARCH;
        for (let z = bb.z0; z <= bb.z0 + bb.h; z++) {
          for (let x = bb.x0; x <= bb.x0 + bb.w; x++) {
            if (!inC(x, z)) continue;
            const i = li(x, z);
            if (c.eN[i] === E.DOOR || c.eN[i] === E.DOOR_OPEN || c.eN[i] === E.DOOR_BROKEN) c.eN[i] = to;
            if (c.eW[i] === E.DOOR || c.eW[i] === E.DOOR_OPEN || c.eW[i] === E.DOOR_BROKEN) c.eW[i] = to;
          }
        }
        if (b.post) b.post(c, bb, (x, z) => li(x, z), E);
      }
      for (const [x, z, o] of P.obj) if (inC(x, z)) { c.obj[li(x, z)] = o; c.tall[li(x, z)] = 0; }
      for (let z = Z0; z < Z0 + CS; z++) {
        for (let x = X0; x < X0 + CS; x++) {
          const i = li(x, z);
          if (c.bld[i] || c.ground[i] === G.World.F.ROAD) continue;
          if (c.deck && c.deck[i]) continue;
          for (const t of P.tall) {
            const hit = t[0] === 'r' ? (x >= t[1] && z >= t[2] && x < t[3] && z < t[4]) : Math.hypot(x + 0.5 - t[1], z + 0.5 - t[2]) < t[3];
            if (hit) { c.tall[i] = 1; break; }
          }
        }
      }
      return;
    }
    // ----- muebles, vehículos y contenedores -----
    for (const f of P.furn) {
      const cxm = (f.x0 + f.x1) / 2, czm = (f.z0 + f.z1) / 2;
      if (!inC(Math.floor(cxm), Math.floor(czm))) continue;
      const g = Object.assign({}, f, { seed: Math.floor(rng() * 1e9) });
      if (G.Furniture.T[f.type].vehicle) g.vehicle = true;
      c.furn.push(g);
    }
    for (const k of P.conts) {
      const cxm = k.x + k.w / 2, czm = k.z + k.d / 2;
      if (!inC(Math.floor(cxm), Math.floor(czm))) continue;
      for (let l = 0; l < k.levels; l++) {
        const type = k.len >= 12 ? 'cont12' : 'cont6';
        const along = k.axis === 'z';          // el largo va en z: el frente mira a x
        c.furn.push({
          type, lv: 0, x0: k.x + 0.03, x1: k.x + k.w - 0.03, z0: k.z + 0.03, z1: k.z + k.d - 0.03, y: l * LEVEL_H, h: LEVEL_H,
          fx: along ? 1 : 0, fz: along ? 0 : 1, solid: false, cont: null, seed: Math.floor(rng() * 1e9),
          col: k.cols ? k.cols[l % k.cols.length] : undefined, open: l === 0 ? k.open : false, lod: k.lod
        });
      }
    }
  }

  // =====================================================================================================
  // Terminal de carga: un patio de contenedores apilados (de uno a tres de alto) con callejones y algún
  // contenedor abierto que se cruza como un túnel. Un solo interior, grande y alto: la nave del taller al
  // noroeste (donde se empieza), con un taller y un almacén al fondo, sin puertas. Montacargas, camionetas,
  // tanques, palés, lonas, barreras de hormigón, charcos y hierba alta. Valla de alambre con espino y, detrás,
  // pilas altas de contenedores y galpones que tapan la vista (como en el vídeo)
  // =====================================================================================================
  MAPS.terminal = {
    name: 'Terminal de carga', min: 6, max: 46, spawn: { x: 16.5, z: 21.5 }, seed: 4242, fence: 'chain',
    board: { x: 14.2, z: 19.15, fx: 0, fz: 1 },        // modo libre: el panel de los mapas (contra la nave)
    // luz: cielo cubierto, gris azulado, con algo de neblina (como en el vídeo)
    mood: { sky: 0x939ea4, fog: 0.8, hemi: [0xc2cace, 0x4c4a40, 0.74], sun: [0xe6ecee, 0.62],
      ground: { 0: [0x5a6a3c, 0x6e7646], 3: [0x5e5444, 0x6a604c], 1: [0x4a4b4c, 0x535352] } },
    skyline: { col: 0x7d888e, h: [8, 26], cranes: [0.7, 1.1, 4.2], towers: [0.25] },
    build(M, rng) {
      const F = G.World.F;
      // Recinto de 40 x 40 m (más recogido: el combate se mantiene cerca). Una calle principal este-oeste
      // delante de la nave, una calle norte-sur y una transversal al sur; entre ellas, patios de contenedores
      M.ground(0, 0, 64, 64, F.DIRT);
      M.ground(6, 6, 28, 20, F.ROAD);          // explanada de la nave
      M.ground(6, 20, 46, 23, F.ROAD);         // calle principal
      M.ground(28, 6, 32, 46, F.ROAD);         // calle norte-sur
      M.ground(6, 34, 46, 37, F.ROAD);         // calle del sur
      for (const [x0, z0, x1, z1] of [[33, 7, 46, 20], [7, 24, 28, 34], [32, 24, 46, 34], [7, 37, 28, 46], [32, 37, 46, 46]]) M.ground(x0, z0, x1, z1, F.GRASS);

      // la nave del taller: grande (20 x 12) y alta (6 m), con dos portones abiertos al sur, uno al este y huecos
      // sin puertas hacia el taller y el almacén del fondo
      M.building('nave_t', 7, 7, 20, 12, 'S', (c, b, li, E2) => {
        for (const x of [9, 10, 11, 12, 16, 17, 18, 19]) c.eN[li(x, 19)] = E2.GATE;
        for (const z of [9, 10, 11]) c.eW[li(27, z)] = E2.GATE;
        for (const z of [8, 9, 10, 14, 15, 16, 17]) c.eW[li(21, z)] = E2.ARCH;
        for (const x of [23, 24]) c.eN[li(x, 13)] = E2.ARCH;
      });
      M.put('persiana', 13.0, 6.92, 0, -1); M.put('persiana', 21.5, 6.92, 0, -1); M.put('persiana', 6.92, 13.5, -1, 0);

      // ----- vehículos (antes que los contenedores: estos no se les echan encima) -----
      M.put('montacargas', 29.5, 21.5, 1, 0);
      M.put('camioneta', 39.5, 21.5, -1, 0);
      M.put('coche', 30.0, 13.5, 0, 1);
      M.put('montacargas', 30.0, 30.5, 0, 1);
      M.put('camioneta', 30.0, 42.0, 0, -1);
      M.put('montacargas', 21.5, 35.5, 1, 0);
      M.put('coche', 40.0, 35.5, -1, 0);
      // barreras de hormigón y tanques junto al inicio (como en la entrada del vídeo)
      M.put('barrera', 9.0, 22.5, 0, 1); M.put('barrera', 11.2, 22.5, 0, 1);
      M.put('ibc', 23.5, 21.5, 0, 1); M.put('ibc', 24.8, 21.5, 0, 1);

      // ----- patios de contenedores -----
      // Cada contenedor va SUELTO: nunca pegado a otro ni por los costados ni por los extremos (al menos 2 m
      // libres alrededor), así se ve entero y por encima no hay rendijas por las que colarse. Se apilan solo
      // en vertical (de uno a tres de alto). Filas separadas por callejones de 3 m
      const pickLv = () => { const r = rng(); return r < 0.45 ? 1 : (r < 0.85 ? 2 : 3); };
      const fill = (x0, z0, x1, z1, ax) => {
        const across0 = ax === 'x' ? z0 : x0, across1 = ax === 'x' ? z1 : x1;
        const along0 = ax === 'x' ? x0 : z0, along1 = ax === 'x' ? x1 : z1;
        for (let r = across0; r + 2 <= across1; r += 5) {
          let a = along0 + Math.floor(rng() * 2);
          while (a + 6 <= along1) {
            if (rng() < 0.1) { a += 3; continue; }                       // hueco más ancho
            const len = along1 - a >= 12 && rng() < 0.35 ? 12 : 6;
            const op = len === 6 && rng() < 0.15 ? (rng() < 0.5 ? 'both' : true) : false;
            const w = ax === 'x' ? len : 2, d = ax === 'x' ? 2 : len;
            const cx = ax === 'x' ? a : r, cz = ax === 'x' ? r : a;
            // 2 casillas libres alrededor
            if (M.free(cx - 2, cz - 2, cx + w + 2, cz + d + 2)) {
              M.cont(cx, cz, ax, len, op ? 1 : pickLv(), { open: op });
              a += len + 2 + (rng() < 0.3 ? 1 : 0);
            } else a += 1;
          }
        }
      };
      fill(33, 7, 46, 20, 'x');
      fill(7, 24, 28, 34, 'x');
      fill(33, 24, 46, 34, 'z');
      fill(7, 37, 28, 46, 'z');
      fill(33, 37, 46, 46, 'x');

      // ----- fuera de la valla: pilas altas de contenedores y galpones que tapan la vista -----
      // (aquí sí van en fila, pegados: no se puede llegar)
      const ring = (x0, z0, x1, z1, ax, lo, hi) => {
        const along0 = ax === 'x' ? x0 : z0, along1 = ax === 'x' ? x1 : z1, r = ax === 'x' ? z0 : x0;
        for (let a = along0; a + 6 <= along1;) {
          const len = along1 - a >= 12 && rng() < 0.5 ? 12 : 6;
          const lv = lo + Math.floor(rng() * (hi - lo + 1));
          if (ax === 'x') M.cont(a, r, 'x', len, lv, { lod: 1 }); else M.cont(r, a, 'z', len, lv, { lod: 1 });
          a += len;
        }
      };
      ring(0, 1, 33, 3, 'x', 3, 4); ring(4, 3, 33, 5, 'x', 2, 3);
      ring(47, 1, 59, 3, 'x', 3, 4);
      M.put('galpon', 40.0, 2.5, 0, 1);
      ring(4, 47, 48, 49, 'x', 2, 3); ring(0, 49, 56, 51, 'x', 3, 4);
      ring(1, 5, 3, 47, 'z', 3, 4); ring(3, 6, 5, 46, 'z', 2, 3);
      ring(49, 3, 51, 49, 'z', 3, 4); ring(47, 6, 49, 46, 'z', 2, 3);

      // ----- dentro de la nave: palés con cajas y bultos en el centro -----
      M.put('palets', 12.5, 12.5, 1, 0); M.put('lona', 15.0, 12.5, 0, 1); M.put('palets', 17.5, 14.5, 0, 1);
      M.put('bidones', 12.5, 15.5, 1, 0);

      // ----- cosas sueltas por el patio (donde quepan) -----
      const scatter = (type, n, m) => {
        for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
          const x = 8 + Math.floor(rng() * 36) + 0.5, z = 8 + Math.floor(rng() * 36) + 0.5;
          const fx = rng() < 0.5 ? 1 : 0, fz = fx ? 0 : 1;
          if (!M.fits(type, x, z, fx, fz, m)) continue;
          M.put(type, x, z, fx, fz);
          k++;
        }
      };
      M.put('lona', 27.4, 18.0, 1, 0);
      scatter('ibc', 5, 1); scatter('palets', 6, 1); scatter('lona', 5, 1); scatter('barrera', 5, 1);
      scatter('bidones', 4, 1); scatter('tubo', 2, 1); scatter('bloques', 3, 1);
      for (let k = 0, tries = 0; k < 11 && tries < 300; tries++) {
        const x = 8 + rng() * 36, z = 8 + rng() * 36;
        if (!M.free(Math.floor(x - 1.5), Math.floor(z - 1), Math.ceil(x + 1.5), Math.ceil(z + 1))) continue;
        M.puddle(x, z, 2 + rng() * 3, 1.5 + rng() * 2); k++;
      }
      for (let k = 0; k < 22; k++) M.tallCircle(8 + rng() * 36, 8 + rng() * 36, 1.8 + rng() * 3.0);
      for (const [x, z] of [[7, 21], [45, 7], [45, 22], [7, 45], [45, 45], [27, 45], [45, 33], [7, 34]]) if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, true);
      for (const [x, z] of [[28, 7], [32, 9], [32, 23], [32, 38], [27, 24]]) if (M.free(x, z, x + 1, z + 1)) M.pole(x, z);
    }
  };

  // =====================================================================================================
  // Salón recreativo (solo para el jefe final): un local de máquinas abandonado. Se empieza en el medio de la
  // sala grande (20 x 12, como el interior de la nave de la terminal). Detrás de la pared norte está la
  // trastienda, la guarida del hongomorfo (siempre sale por ese tramo de pared); en cada una de las otras tres
  // paredes, una habitación con puerta (despacho, depósito y vestíbulo), conectadas también entre sí para dar
  // vueltas. El hongomorfo no cabe por las puertas: derriba las paredes. Moqueta con dibujos de neón comida por el hongo, máquinas volcadas,
  // neones en las paredes (algunos rotos, parpadeando) y escombros
  // =====================================================================================================
  const AX = 8, AZ = 8;          // esquina del edificio
  MAPS.arcade = {
    name: 'Salón recreativo', boss: true, min: 7, max: 35, spawn: { x: AX + 13, z: AZ + 10.6 }, seed: 777, fence: 'chain',
    board: { x: AX + 13, z: AZ + 15.85, fx: 0, fz: -1 }, // modo libre: el panel de los mapas (pared sur)
    // dentro: penumbra morada; la luz la ponen los neones y las pantallas
    mood: { sky: 0x07060b, fog: 0.55, hemi: [0x8a7ab0, 0x2a2232, 0.9], sun: [0xb4a6d8, 0.05], ground: { 3: [0x2a2630, 0x302b36], 1: [0x232227, 0x28272c] } },
    // datos del jefe (coordenadas del mundo): la sala, la guarida, el tramo de pared que se derriba al empezar
    // (aristas N en z = AZ + 4, de x0 a x1 - 1) y por dónde sale el blindado
    arena: { hall: { x0: AX + 3, z0: AZ + 4, x1: AX + 23, z1: AZ + 16 }, lair: { x: AX + 13, z: AZ + 2 },
      breach: { z: AZ + 4, x0: AX + 11, x1: AX + 15 }, nemi: { x: AX + 7, z: AZ + 2 } },
    build(M, rng) {
      const F = G.World.F;
      M.ground(0, 0, 48, 48, F.ROAD);
      M.building('arcade_b', AX, AZ, 26, 20, 'S', (c, b) => {
        // sin luces del techo: alumbran los neones (G.Maps.decor)
        for (const r of b.rooms) r.on = false;
      });
      const X = (x) => AX + x, Z = (z) => AZ + z;
      // ---- sala grande (x 3..23, z 4..16) ----
      // máquinas contra la pared norte (a los lados de la brecha), mirando al sur
      for (const x of [3.6, 4.45, 5.3, 6.15, 7.0]) M.put('maquina', X(x), Z(4.45), 0, 1);
      for (const x of [18.0, 18.85, 19.7, 21.55, 22.4]) M.put('maquina', X(x), Z(4.45), 0, 1);
      // contra la pared oeste, mirando al este (con huecos)
      for (const z of [6.2, 7.05, 7.9, 11.2, 12.05, 12.9]) M.put('maquina', X(3.42), Z(z), 1, 0);
      // pinballs contra la pared este
      for (const z of [6.0, 8.0, 12.6]) M.put('pinball', X(22.2), Z(z), -1, 0);
      // grúas y cambiador contra la pared sur
      M.put('grua', X(4.0), Z(15.45), 0, -1); M.put('grua', X(5.1), Z(15.45), 0, -1);
      M.put('cambio', X(21.8), Z(15.7), 0, -1);
      for (const x of [16.6, 17.45, 18.3]) M.put('maquina', X(x), Z(15.55), 0, -1);
      // dos islas de máquinas espalda con espalda
      for (const x of [6.6, 7.45, 8.3]) { M.put('maquina', X(x), Z(9.1), 0, -1); M.put('maquina', X(x), Z(9.9), 0, 1); }
      for (const x of [17.4, 18.25, 19.1]) { M.put('maquina', X(x), Z(9.1), 0, -1); M.put('maquina', X(x), Z(9.9), 0, 1); }
      // hockey en el centro-sur, máquinas volcadas y un sofá destripado
      M.put('hockey', X(13.0), Z(13.6), 1, 0);
      M.put('maquina_rota', X(10.2), Z(6.6), 1, 0); M.put('maquina_rota', X(15.6), Z(12.6), 0, 1);
      M.put('sofa', X(9.5), Z(15.5), 0, -1);
      // hongos sobre la moqueta y escombros
      for (const [x, z, w, d] of [[13, 5.2, 3.2, 1.6], [5.5, 14.2, 2.4, 1.6], [20.6, 13.6, 2.2, 1.8], [11, 10.5, 1.6, 1.2], [16, 6.8, 1.8, 1.2], [4.2, 9.5, 1.4, 1.6]]) M.put('hongos', X(x), Z(z), 0, 1, { x0: X(x) - w / 2, x1: X(x) + w / 2, z0: Z(z) - d / 2, z1: Z(z) + d / 2 });
      for (const [x, z] of [[20.6, 14.2], [9.8, 13.2], [3.9, 5.2]]) M.put('escombros', X(x), Z(z), 0, 1, { x0: X(x) - 0.8, x1: X(x) + 0.8, z0: Z(z) - 0.6, z1: Z(z) + 0.6 });
      M.put('hongo_pared', X(9.0), Z(4.16), 0, 1);            // la mancha de hongo que delata la guarida
      M.put('hongo_pared', X(3.16), Z(14.6), 1, 0);
      // ---- trastienda (guarida, todo el lado norte): hongo por todas partes ----
      M.put('estante', X(4.2), Z(0.3), 0, 1); M.put('cajas', X(6.0), Z(0.6), 0, 1); M.put('cajas', X(20.8), Z(3.2), 0, 1);
      M.put('estante', X(21.8), Z(0.3), 0, 1); M.put('estante', X(1.0), Z(0.3), 0, 1); M.put('cajas', X(25.0), Z(1.0), 0, 1);
      for (const [x, z] of [[9, 1.5], [13, 2.2], [17.5, 1.4], [5, 2.8], [1.6, 2.6], [24.4, 2.8]]) M.put('hongos', X(x), Z(z), 0, 1, { x0: X(x) - 1.2, x1: X(x) + 1.2, z0: Z(z) - 0.8, z1: Z(z) + 0.8 });
      M.put('hongo_pared', X(13), Z(0.16), 0, 1); M.put('hongo_pared', X(9), Z(0.16), 0, 1); M.put('hongo_pared', X(17), Z(0.16), 0, 1);
      // ---- despacho (oeste, x 0..3): puertas a la sala (z 10) y al vestíbulo (z 18) ----
      M.put('escritorio', X(0.75), Z(5.6), 1, 0); M.put('archivador', X(0.35), Z(7.6), 1, 0);
      M.put('archivador', X(0.35), Z(13.2), 1, 0); M.put('cajas', X(0.6), Z(15.2), 0, 1);
      M.put('escombros', X(1.2), Z(12.0), 0, 1, { x0: X(0.6), x1: X(1.8), z0: Z(11.6), z1: Z(12.4) });
      M.put('hongo_pared', X(0.16), Z(10.5), 1, 0);
      // ---- depósito (este, x 23..26): puertas a la sala (z 10) y al vestíbulo (z 18) ----
      M.put('estante', X(25.7), Z(5.6), -1, 0); M.put('estante', X(25.7), Z(7.6), -1, 0);
      M.put('estante', X(25.7), Z(13.0), -1, 0); M.put('cajas', X(25.4), Z(15.2), 0, 1);
      M.put('hongos', X(24.5), Z(9.0), 0, 1, { x0: X(23.6), x1: X(25.4), z0: Z(8.4), z1: Z(9.6) });
      // ---- vestíbulo (sur, z 16..20): puerta a la sala en x 13; mostrador de premios, máquinas y bancos ----
      M.put('mostrador', X(8.4), Z(18.2), 0, -1); M.put('mostrador', X(6.0), Z(18.2), 0, -1);
      M.put('banco_espera', X(17.5), Z(19.5), 0, -1);
      for (const x of [19.8, 20.65]) M.put('maquina', X(x), Z(16.45), 0, 1);
      M.put('grua', X(21.6), Z(19.4), 0, -1);
      M.put('hongos', X(10.8), Z(17.6), 0, 1, { x0: X(9.8), x1: X(11.8), z0: Z(17), z1: Z(18.2) });
    }
  };

  // ---------- Luces de neón (mapas cerrados) ----------
  // Pantallas de las máquinas, carteles de arriba, tubos de neón por las paredes y el techo y un cartel con el
  // nombre del local; brillan solos (sin luz de escena) y algunos parpadean (están rotos). Tres luces de
  // colores dan el tono a la sala. Se crean al cargar el mapa y se quitan al cambiar
  let decoG = null; const decoLights = [], decoFlick = [], decoMach = [];   // decoMach: lo de cada máquina (para destrozarla)
  const neonMat = (hex, op) => { const m = new THREE.MeshBasicMaterial({ color: hex, transparent: op != null, opacity: op == null ? 1 : op, depthWrite: op == null }); m.toneMapped = false; return m; };
  function signTex(text, col) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const x = cv.getContext('2d');
    x.font = 'italic 900 78px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = col; x.shadowBlur = 26; x.fillStyle = col;
    x.fillText(text, 256, 66); x.shadowBlur = 10; x.fillText(text, 256, 66);
    x.shadowBlur = 0; x.fillStyle = '#fff6fb'; x.globalAlpha = 0.55; x.fillText(text, 256, 66);
    return new THREE.CanvasTexture(cv);
  }
  function decor(scene, id) {
    if (decoG) {
      scene.remove(decoG);
      decoG.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      decoG = null;
    }
    for (const l of decoLights) scene.remove(l);
    decoLights.length = 0; decoFlick.length = 0; decoMach.length = 0;
    if (id !== 'arcade') return null;
    const P = prims(id), wallH = 4.2;
    decoG = new THREE.Group();
    const rng = U.mulberry32(1234);
    const SCR = [0x3fe6ff, 0xff3fa4, 0x7dff6a, 0xffd23f, 0x9b7bff];
    const plane = (w, h, mat, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0, 'YXZ'); decoG.add(m); return m; };
    const tube = (x, y, z, w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); decoG.add(m); return m; };
    // pantallas y carteles de cada máquina (las volcadas, apagadas)
    for (const f of P.furn) {
      if (f.type !== 'maquina' && f.type !== 'pinball') continue;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, ry = Math.atan2(f.fx, f.fz);
      const at = (lz, ly) => [cx + f.fx * lz, ly, cz + f.fz * lz];
      const col = SCR[Math.floor(rng() * SCR.length)];
      const dm = { x: cx, z: cz, parts: [], fl: [] };
      decoMach.push(dm);
      if (f.type === 'maquina') {
        const dead = rng() < 0.22;
        const sm = neonMat(dead ? 0x1a1a24 : col);
        const [sx, sy, sz] = at(0.142, 1.37);
        const s = plane(0.56, 0.44, sm, sx, sy, sz, ry);
        if (!dead) { const fl = { m: sm, base: new THREE.Color(col), k: 0.55 + rng() * 0.35, sp: 2 + rng() * 6, ph: rng() * 9, broken: rng() < 0.15 }; decoFlick.push(fl); dm.fl.push(fl); }
        const [mx, my, mz] = at(0.292, 1.79);
        dm.parts.push(s, plane(0.74, 0.1, neonMat(U.shade(SCR[Math.floor(rng() * SCR.length)], 0.9)), mx, my, mz, ry));
        s.renderOrder = 1;
      } else {
        const [bx, by, bz] = at(-0.515, 1.15);
        dm.parts.push(plane(0.62, 0.32, neonMat(col), bx, by, bz, ry));
      }
    }
    // tubos de neón por las paredes de la sala (con huecos y tramos rotos)
    const a = MAPS.arcade.arena.hall;
    // los neones, separados de la cara de la pared (la pared mide WALL_T: su cara queda a WALL_T / 2 de la línea)
    const IN = G.World.WALL_T / 2 + 0.045;
    const pink = neonMat(0xff3fa4), cyan = neonMat(0x3fe6ff), viol = neonMat(0xa05bff), yel = neonMat(0xffe23f);
    // pared sur (mirando al norte): franja rosa y cartel con el nombre
    tube((a.x0 + a.x1) / 2 - 3, 3.55, a.z1 - IN, 12, 0.05, 0.05, pink);
    tube(a.x0 + 5, 0.35, a.z1 - IN, 8.6, 0.04, 0.04, cyan);       // (cortada por la puerta del vestíbulo)
    tube(a.x1 - 4.5, 0.35, a.z1 - IN, 7.4, 0.04, 0.04, cyan);
    const sign = new THREE.MeshBasicMaterial({ map: signTex('GALAXIA', '#ff4fb0'), transparent: true, depthWrite: false }); sign.toneMapped = false;
    plane(4.6, 1.15, sign, (a.x0 + a.x1) / 2 - 1, 2.85, a.z1 - IN - 0.03, Math.PI);
    decoFlick.push({ m: sign, base: new THREE.Color(0xffffff), k: 1, sp: 1.3, ph: 0, broken: true, sign: true });
    // pared oeste: zigzag cian; pared este: ondas violeta; norte: franja amarilla (cortada por la brecha)
    for (let k = 0; k < 7; k++) { const t = tube(a.x0 + IN, 2.9 + (k % 2 ? 0.25 : -0.25), a.z0 + 1.2 + k * 1.4, 0.04, 0.05, 1.45, cyan); t.rotation.x = k % 2 ? 0.35 : -0.35; }
    for (let k = 0; k < 8; k++) { const t = tube(a.x1 - IN, 3.0 + Math.sin(k) * 0.2, a.z0 + 1 + k * 1.3, 0.04, 0.05, 1.32, k === 5 ? neonMat(0x2a1a3a) : viol); t.rotation.x = Math.cos(k) * 0.3; }
    tube(a.x0 + 3.5, 3.4, a.z0 + IN, 5.5, 0.05, 0.04, yel); tube(a.x1 - 3.5, 3.4, a.z0 + IN, 5.5, 0.05, 0.04, yel);
    // techo: dos tubos largos (uno parpadea)
    const ct1 = neonMat(0xd8b0ff), ct2 = neonMat(0x9fe8ff);
    tube((a.x0 + a.x1) / 2, wallH - 0.12, a.z0 + 4, 13, 0.06, 0.06, ct1);
    tube((a.x0 + a.x1) / 2, wallH - 0.12, a.z1 - 4, 13, 0.06, 0.06, ct2);
    decoFlick.push({ m: ct2, base: new THREE.Color(0x9fe8ff), k: 1, sp: 7, ph: 2, broken: true });
    // luces de color: rosa al oeste, cian al este y violeta en el centro (dan el tono a todo)
    for (const [hex, x, z, I] of [[0xff4fa8, a.x0 + 4, (a.z0 + a.z1) / 2, 3.0], [0x47d8ff, a.x1 - 4, (a.z0 + a.z1) / 2, 3.0], [0x9a6bff, (a.x0 + a.x1) / 2, a.z0 + 5, 2.4]]) {
      const l = new THREE.PointLight(hex, I, 17, 1.3);
      l.position.set(x, 3.2, z);
      scene.add(l); decoLights.push(l);
    }
    // la guarida: un resplandor anaranjado sucio que se cuela cuando se abre la pared
    const lg = new THREE.PointLight(0xff9a50, 0.9, 9, 1.6); lg.position.set(MAPS.arcade.arena.lair.x, 2.5, MAPS.arcade.arena.lair.z);
    scene.add(lg); decoLights.push(lg);
    scene.add(decoG);
    return decoG;
  }
  // una máquina destrozada: se apagan (y quitan) su pantalla y su cartel
  function killDecor(x, z) {
    for (let i = decoMach.length - 1; i >= 0; i--) {
      const d = decoMach[i];
      if (Math.hypot(d.x - x, d.z - z) > 0.5) continue;
      for (const p of d.parts) p.visible = false;
      for (const fl of d.fl) { const k = decoFlick.indexOf(fl); if (k >= 0) decoFlick.splice(k, 1); }
      decoMach.splice(i, 1);
    }
  }
  // parpadeo de las pantallas y de los neones rotos
  let decoT = 0;
  function updateDecor(dt) {
    if (!decoG) return;
    decoT += dt;
    for (const d of decoFlick) {
      let v = d.k + (1 - d.k) * (0.5 + 0.5 * Math.sin(decoT * d.sp + d.ph));
      if (d.broken) { const n = Math.sin(decoT * 23 + d.ph) * Math.sin(decoT * 7.3 + d.ph * 2); if (n > 0.55) v *= 0.12; }
      if (d.sign) d.m.opacity = v; else d.m.color.copy(d.base).multiplyScalar(v);
    }
  }

  // ---------- Horizonte lejano ----------
  // Siluetas de la ciudad (y grúas, torres, árboles) alrededor del mapa, a unos 44 m de la cámara y sin niebla
  // propia: van con la cámara (como un cielo), en tonos que se funden con la neblina del cielo
  let sky = null;
  function skyline(scene, id) {
    if (sky) { scene.remove(sky); sky.geometry.dispose(); sky = null; }
    const m = id && MAPS[id];
    if (!m || !m.skyline) return null;
    const rng = U.mulberry32((m.seed || 7) + 99);
    const M = new G.Mesher();
    const R = 44, base = -6;
    const col = (k) => U.shade(m.skyline.col, k);
    const at = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
    // edificios en la distancia (dos capas: lejos más claros)
    for (const [r, k, n] of [[R + 6, 1.1, 46], [R, 0.95, 34]]) {
      for (let i = 0; i < n; i++) {
        const a = (i + rng() * 0.6) / n * Math.PI * 2;
        const [x, z] = at(a, r);
        const h = m.skyline.h[0] + rng() * (m.skyline.h[1] - m.skyline.h[0]);
        const w = 4 + rng() * 7;
        M.box(x, base + h / 2, z, w, h, 3, col(k * (0.92 + rng() * 0.12)), a);
        if (rng() < 0.35) M.box(x + (rng() - 0.5) * 2, base + h + 1.2, z, 1.2, 2.4, 1.2, col(k * 0.95), a);
      }
    }
    // grúas portuarias y una torre (terminal)
    for (const c of m.skyline.cranes || []) {
      const [x, z] = at(c, R - 2);
      const H = 26;
      for (const s of [-1, 1]) M.box(x + Math.cos(c) * s * 2.5, base + H / 2, z - Math.sin(c) * s * 2.5, 0.6, H, 0.6, col(0.8), c);
      M.box(x, base + H, z, 7, 1.2, 1.2, col(0.8), c);
      M.box(x + Math.sin(c) * -5, base + H + 3, z + Math.cos(c) * -5, 0.6, 0.6, 18, col(0.8), c);
      M.box(x, base + H + 4, z, 0.4, 8, 0.4, col(0.8), c);
    }
    for (const t of m.skyline.towers || []) {
      const [x, z] = at(t, R + 2);
      M.box(x, base + 16, z, 4, 32, 4, col(0.88), t);
      M.box(x, base + 33, z, 2.5, 4, 2.5, col(0.86), t);
      M.box(x, base + 37, z, 1, 6, 1, col(0.86), t);
    }
    // copas de árboles entre los edificios
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, [x, z] = at(a, R - 4);
      M.box(x, base + 6 + rng() * 3, z, 3 + rng() * 3, 6 + rng() * 5, 3, col(0.78), a);
    }
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
    sky = new THREE.Mesh(M.build(), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    return sky;
  }
  function followSky(cam) { if (sky && cam) sky.position.set(cam.position.x, 0, cam.position.z); }

  // ---------- Vista previa (modo libre: el panel de los mapas) ----------
  // Un plano visto desde arriba, dibujado con lo que tiene el mapa (suelo, edificios, contenedores, muebles y
  // árboles). 'libre': el campo de pruebas. Se guarda como imagen (data URL)
  const PREV = {};
  function preview(id) {
    if (PREV[id]) return PREV[id];
    if (typeof document === 'undefined') return '';
    const S = 220, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    const F = G.World.F;
    const GC = { [F.GRASS]: '#56693e', [F.ROAD]: '#4a4b4d', [F.SIDEWALK]: '#8e8a80', [F.DIRT]: '#6b5a44' };
    if (id === 'libre' || !MAPS[id]) {
      x.fillStyle = '#5d7d43'; x.fillRect(0, 0, S, S);
      x.strokeStyle = '#d8cfb8'; x.lineWidth = 3; x.strokeRect(14, 14, S - 28, S - 28);
      x.fillStyle = '#c9b48a'; x.fillRect(40, 150, 30, 12); x.fillRect(150, 150, 30, 12); x.fillRect(96, 152, 28, 8);
      x.fillStyle = '#3f5a2f'; for (const [a, b] of [[50, 60], [160, 70], [110, 40], [70, 110]]) { x.beginPath(); x.arc(a, b, 9, 0, 6.3); x.fill(); }
      x.fillStyle = '#bdb6a8'; x.fillRect(60, 80, 46, 30); x.fillRect(130, 100, 40, 26);
    } else {
      const m = MAPS[id], P = prims(id), A = m.min - 1, B = m.max + 1, k = S / (B - A);
      const R = (x0, z0, w, d) => x.fillRect((x0 - A) * k, (z0 - A) * k, w * k, d * k);
      x.fillStyle = '#121014'; x.fillRect(0, 0, S, S);
      for (const [x0, z0, x1, z1, g] of P.ground) { x.fillStyle = GC[g] || '#4a4b4d'; R(x0, z0, x1 - x0, z1 - z0); }
      for (const bd of P.blds) {
        const def = G.Buildings.DEFS.find((d) => d.id === bd.id); if (!def) continue;
        const rot = bd.front === 'E' || bd.front === 'W';
        const w = rot ? def.h : def.w, d = rot ? def.w : def.h;
        x.fillStyle = id === 'arcade' ? '#3a2f55' : '#8c8f8a'; R(bd.ox, bd.oz, w, d);
        if (def.rooms) {
          x.strokeStyle = 'rgba(20,16,24,0.8)'; x.lineWidth = 1.5;
          for (const r of def.rooms) x.strokeRect((bd.ox + r[0] - A) * k, (bd.oz + r[1] - A) * k, r[2] * k, r[3] * k);
        }
      }
      for (const c of P.conts) {
        if (c.lod) continue;
        x.fillStyle = ['#9a4a32', '#3f6a8a', '#5f7a3a', '#a07a2a'][(c.x * 7 + c.z * 3) % 4];
        R(c.x + 0.1, c.z + 0.1, c.w - 0.2, c.d - 0.2);
      }
      for (const f of P.furn) {
        const t = G.Furniture.T[f.type];
        if (!t || f.type === 'charco') continue;
        x.fillStyle = t.vehicle ? '#c9c2b0' : (f.type === 'hongos' ? '#b8865a' : (f.type === 'maquina' || f.type === 'pinball' ? '#d84fa0' : '#9a8a6a'));
        R(f.x0, f.z0, f.x1 - f.x0, f.z1 - f.z0);
      }
      x.fillStyle = '#2f4a26';
      for (const [ox, oz] of P.obj) { x.beginPath(); x.arc((ox + 0.5 - A) * k, (oz + 0.5 - A) * k, 1.6 * k, 0, 6.3); x.fill(); }
      // el punto de inicio
      x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc((m.spawn.x - A) * k, (m.spawn.z - A) * k, 4, 0, 6.3); x.fill();
    }
    PREV[id] = cv.toDataURL('image/png');
    return PREV[id];
  }

  G.Maps = {
    preview,
    skyline, followSky,
    LEVEL_H,
    get(id) { return MAPS[id] || null; },
    // los mapas de los enfrentamientos normales (sin los exclusivos del jefe) y todos (modo libre)
    list() { return Object.keys(MAPS).filter((k) => !MAPS[k].boss); },
    listAll() { return Object.keys(MAPS); },
    decor, updateDecor, killDecor,
    apply,
    prims
  };
})(window.Game = window.Game || {});
