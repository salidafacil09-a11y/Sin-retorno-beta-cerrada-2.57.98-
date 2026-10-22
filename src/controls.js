(function (G) {
  'use strict';

  // Controles a medida: qué tecla (o botón del ratón) y qué botón del mando hace cada cosa. Se cambian en
  // Opciones > Controles y se guardan en este navegador. Los sticks del mando (moverse y mirar) no se cambian,
  // y la cruceta queda reservada para moverse por el menú de armas.
  // Teclas: el código de la tecla (KeyW, Space, ShiftLeft...) o Mouse0 / Mouse1 / Mouse2 (botones del ratón).
  // Mando: el número del botón en el mando estándar (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Select,
  // 9 Start, 10 L3, 11 R3); -1 = sin asignar

  const KEY = 'ceniza.controles';
  // [acción, nombre, solo teclado (no tiene botón en el mando), solo teclas (no admite el ratón)]
  const LIST = [
    ['forward', 'Avanzar', true], ['back', 'Retroceder', true], ['left', 'Izquierda', true], ['right', 'Derecha', true],
    ['run', 'Correr'], ['aim', 'Apuntar'], ['attack', 'Atacar / disparar'], ['reload', 'Recargar'], ['dodge', 'Esquivar'],
    ['jump', 'Saltar / empujar'], ['use', 'Usar (puertas, ventanas, trepar)'], ['loot', 'Recoger (mantener: todo)'],
    ['crouch', 'Agacharse'], ['prone', 'Pecho a tierra'],
    ['quick', 'Cambio rápido / menú de armas', false, true], ['cycle', 'Siguiente arma'], ['grip', 'Accesorio (silenciador o mira)'],
    ['throw', 'Arrojable a la mano'], ['bandage', 'Venda a la mano'], ['pack', 'Mochila'],
    ['slot1', 'Arma 1'], ['slot2', 'Arma 2'], ['slot3', 'Arma 3'], ['slot4', 'Arma 4'], ['pause', 'Pausa']
  ];
  const KB_DEF = {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', run: 'ShiftLeft', aim: 'Mouse2', attack: 'Mouse0', reload: 'KeyR',
    dodge: 'KeyF', jump: 'Space', use: 'KeyE', loot: 'KeyT', crouch: 'KeyC', prone: 'KeyZ', quick: 'KeyQ', cycle: 'Tab', grip: 'KeyV',
    throw: 'KeyG', bandage: 'KeyB', pack: 'KeyI', slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', pause: 'KeyP'
  };
  const PAD_DEF = {
    run: 10, aim: 6, attack: 7, reload: 2, dodge: 5, jump: -1, use: 0, loot: -1, crouch: 11, prone: 1, quick: -1, cycle: 3, grip: 4,
    throw: -1, bandage: -1, pack: 8, slot1: -1, slot2: -1, slot3: -1, slot4: -1, pause: 9
  };
  const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3 (stick izq.)', 'R3 (stick der.)', 'Cruceta ↑', 'Cruceta ↓', 'Cruceta ←', 'Cruceta →', 'Guía'];
  const PAD_RESERVED = { 12: 1, 13: 1, 14: 1, 15: 1 };       // la cruceta: menú de armas

  let kb = Object.assign({}, KB_DEF), pad = Object.assign({}, PAD_DEF);
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      for (const k in s.kb || {}) if (k in KB_DEF && typeof s.kb[k] === 'string') kb[k] = s.kb[k];
      for (const k in s.pad || {}) if (k in PAD_DEF && typeof s.pad[k] === 'number') pad[k] = s.pad[k];
    }
  } catch (e) { /* sin guardado */ }
  let byKey = {};
  const rebuild = () => { byKey = {}; for (const a in kb) if (kb[a]) byKey[kb[a]] = a; };
  rebuild();
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ kb, pad })); } catch (e) { /* nada */ } }

  function keyName(code) {
    if (!code) return '—';
    const M = { Mouse0: 'Clic izquierdo', Mouse1: 'Clic central', Mouse2: 'Clic derecho', Mouse3: 'Ratón 4', Mouse4: 'Ratón 5', Space: 'Espacio', ShiftLeft: 'Mayús izq.', ShiftRight: 'Mayús der.',
      ControlLeft: 'Ctrl izq.', ControlRight: 'Ctrl der.', AltLeft: 'Alt', AltRight: 'Alt Gr', Tab: 'Tab', Enter: 'Intro', Backquote: 'º', CapsLock: 'Bloq Mayús',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: 'Ñ', Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<' };
    if (M[code]) return M[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }
  const padName = (i) => (i == null || i < 0 ? '—' : (PAD_NAMES[i] || 'Botón ' + i));

  const Controls = {
    LIST, PAD_RESERVED,
    // acción de una tecla o botón del ratón (o undefined)
    kbAction(code) { return byKey[code]; },
    key(act) { return kb[act] || ''; },
    padBtn(act) { return pad[act] == null ? -1 : pad[act]; },
    get pad() { return pad; },
    get(dev, act) { return dev === 'pad' ? this.padBtn(act) : this.key(act); },
    def(dev, act) { return dev === 'pad' ? (PAD_DEF[act] == null ? -1 : PAD_DEF[act]) : (KB_DEF[act] || ''); },
    label(dev, v) { return dev === 'pad' ? padName(v) : keyName(v); },
    // asigna; si otra acción tenía esa tecla o botón, se intercambian (nada se queda repetido)
    set(dev, act, v) {
      const M = dev === 'pad' ? pad : kb;
      if (!(act in M)) return;
      const empty = dev === 'pad' ? -1 : '';
      if (v !== empty && v != null) {
        for (const a in M) if (a !== act && M[a] === v) M[a] = M[act];
      }
      M[act] = v == null ? empty : v;
      rebuild(); save();
    },
    reset(dev) {
      if (dev !== 'pad') kb = Object.assign({}, KB_DEF);
      if (dev !== 'kb') pad = Object.assign({}, PAD_DEF);
      rebuild(); save();
    },
    // mientras se espera la tecla o el botón nuevo (y un momento después) el resto del juego no hace caso
    capturing: false,
    capUntil: 0,
    get busy() { return this.capturing || performance.now() < this.capUntil; }
  };

  G.Controls = Controls;
})(window.Game = window.Game || {});
