// DOM rendering and input. Bridges game.js + ai.js to the page.

const HUMAN = 0;
const AI = 1;
const AI_DELAY = 600;

let state = null;
let pendingDrag = null;

function start() {
  state = newGame();
  setupPersistentListeners();
  render();
  maybeAITurn();
}

let persistentReady = false;
function setupPersistentListeners() {
  if (persistentReady) return;
  persistentReady = true;
  const tbl = document.getElementById('table');
  tbl.addEventListener('dragover', e => {
    if (!pendingDrag) return;
    const { card } = pendingDrag;
    let ok = false;
    if (state.phase === 'attack' && canAttack(state, HUMAN, card)) ok = true;
    if (state.phase === 'defend' && canTransfer(state, HUMAN, card)) ok = true;
    if (ok) { e.preventDefault(); tbl.classList.add('drop-active'); }
  });
  tbl.addEventListener('dragleave', () => tbl.classList.remove('drop-active'));
  tbl.addEventListener('drop', e => {
    if (!pendingDrag) return;
    e.preventDefault();
    tbl.classList.remove('drop-active');
    const { card } = pendingDrag;
    if (state.phase === 'attack' && canAttack(state, HUMAN, card)) {
      doAttack(card);
    } else if (state.phase === 'defend' && canTransfer(state, HUMAN, card)) {
      doTransfer(card);
    }
  });
}

function render() {
  renderHeader();
  renderOpponent();
  renderTable();
  renderHand();
  renderControls();
  renderStatus();
  renderBanner();
}

function renderHeader() {
  document.getElementById('trump-suit').textContent =
    RANK_LABEL[state.trumpCard.rank] + SUIT_GLYPH[state.trumpSuit];
  document.getElementById('trump-suit').className =
    'suit-' + state.trumpSuit + ' ' + (isRed(state.trumpSuit) ? 'red' : 'black');
  document.getElementById('deck-count').textContent = state.deck.length;
  document.getElementById('discard-count').textContent = state.discard.length;
}

function renderOpponent() {
  const el = document.getElementById('opponent-hand');
  el.innerHTML = '';
  for (let i = 0; i < state.hands[AI].length; i++) {
    const c = document.createElement('div');
    c.className = 'card face-down';
    el.appendChild(c);
  }
}

function renderTable() {
  // Deck area.
  const deckEl = document.getElementById('deck');
  deckEl.innerHTML = '';
  if (state.deck.length > 0) {
    const trump = document.createElement('div');
    trump.className = 'card trump-card ' + (isRed(state.trumpSuit) ? 'red' : 'black');
    trump.appendChild(makeCardFace(state.trumpCard));
    deckEl.appendChild(trump);
    if (state.deck.length > 1) {
      const back = document.createElement('div');
      back.className = 'card face-down';
      deckEl.appendChild(back);
    }
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = 'осталось ' + state.deck.length;
    deckEl.appendChild(count);
  }

  // Discard.
  const discardEl = document.getElementById('discard');
  discardEl.className = 'discard' + (state.discard.length ? ' has-cards' : '');
  discardEl.textContent = state.discard.length ? `бита: ${state.discard.length}` : 'бита';

  // Table slots.
  const tbl = document.getElementById('table');
  tbl.innerHTML = '';
  for (let i = 0; i < state.table.length; i++) {
    const slot = state.table[i];
    const slotEl = document.createElement('div');
    slotEl.className = 'slot';
    slotEl.dataset.slotIndex = i;
    slotEl.appendChild(makeCardEl(slot.attack, false));
    if (slot.defense) {
      const defEl = makeCardEl(slot.defense, false);
      defEl.classList.add('defense');
      slotEl.appendChild(defEl);
    }
    setupSlotDrop(slotEl, i);
    tbl.appendChild(slotEl);
  }
}

function renderHand() {
  const el = document.getElementById('hand');
  el.innerHTML = '';
  const hand = state.hands[HUMAN].slice().sort((a, b) => {
    const at = isTrump(a, state.trumpSuit) ? 1 : 0;
    const bt = isTrump(b, state.trumpSuit) ? 1 : 0;
    if (at !== bt) return at - bt;
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
  });
  for (const c of hand) {
    const ce = makeCardEl(c, true);
    decorateLegality(ce, c);
    el.appendChild(ce);
  }
}

function decorateLegality(el, card) {
  if (state.phase === 'over') return;
  if (state.phase === 'attack' && state.attacker === HUMAN) {
    if (canAttack(state, HUMAN, card)) {
      el.classList.add('legal');
      attachDrag(el, card, 'attack');
      el.onclick = () => doAttack(card);
    } else {
      el.classList.add('illegal');
    }
  } else if (state.phase === 'defend' && state.defender === HUMAN) {
    const transferable = canTransfer(state, HUMAN, card);
    const defendable = state.table.some((_, i) => canDefend(state, HUMAN, card, i));
    if (defendable && transferable) {
      // Prefer 'transferable' marker; click should ask intent.
      el.classList.add('transferable');
      attachDrag(el, card, 'defend-or-transfer');
      el.onclick = () => promptDefendOrTransfer(card);
    } else if (transferable) {
      el.classList.add('transferable');
      attachDrag(el, card, 'transfer');
      el.onclick = () => doTransfer(card);
    } else if (defendable) {
      el.classList.add('legal');
      attachDrag(el, card, 'defend');
      el.onclick = () => doDefendAuto(card);
    } else {
      el.classList.add('illegal');
    }
  } else {
    el.classList.add('illegal');
  }
}

function renderControls() {
  const take = document.getElementById('btn-take');
  const done = document.getElementById('btn-done');
  const pass = document.getElementById('btn-pass');
  const restart = document.getElementById('btn-restart');

  take.disabled = true;
  done.disabled = true;
  pass.disabled = true;

  if (state.phase === 'defend' && state.defender === HUMAN) {
    if (unbeatenSlots(state.table).length > 0) take.disabled = false;
  }
  if (state.phase === 'attack' && state.attacker === HUMAN && state.table.length > 0) {
    if (unbeatenSlots(state.table).length === 0) {
      done.disabled = false;
    }
    if (state.pickup) {
      pass.disabled = false;
    }
  }
  restart.onclick = () => start();
  take.onclick = () => doPickup();
  done.onclick = () => doEndAttack();
  pass.onclick = () => doEndAttack();
}

function renderStatus() {
  const s = document.getElementById('status');
  s.classList.remove('alert');
  if (state.phase === 'over') {
    s.textContent = '';
    return;
  }
  let txt = '';
  if (state.attacker === HUMAN) {
    if (state.phase === 'attack') {
      txt = state.table.length === 0
        ? 'Ваш ход — атакуйте.'
        : (state.pickup ? 'Соперник берёт — подкиньте или пасуйте.' :
           (unbeatenSlots(state.table).length === 0 ? 'Подкиньте карту или нажмите «Бито».' : 'Ждём соперника…'));
    } else {
      txt = 'Соперник отбивается…';
    }
  } else {
    if (state.phase === 'defend') {
      txt = 'Защищайтесь! Побейте каждую карту или берите.';
      s.classList.add('alert');
    } else {
      txt = 'Соперник атакует…';
    }
  }
  s.textContent = txt;
}

function renderBanner() {
  const b = document.getElementById('banner');
  if (state.phase !== 'over') { b.classList.remove('show'); return; }
  const h = document.getElementById('banner-text');
  if (state.winner === 'draw') h.textContent = 'Ничья!';
  else if (state.winner === HUMAN) h.textContent = 'Вы победили!';
  else h.textContent = 'Вы — дурак.';
  b.classList.add('show');
}

// ----- Helpers -----

function isRed(suit) { return suit === 'H' || suit === 'D'; }

function makeCardFace(card) {
  const wrap = document.createElement('div');
  wrap.style.position = 'absolute';
  wrap.style.inset = '0';
  wrap.style.padding = '6px 8px';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.justifyContent = 'space-between';
  wrap.appendChild(corner(card, false));
  const center = document.createElement('div');
  center.className = 'center';
  center.textContent = SUIT_GLYPH[card.suit];
  wrap.appendChild(center);
  wrap.appendChild(corner(card, true));
  return wrap;
}

function corner(card, bottom) {
  const el = document.createElement('div');
  el.className = 'corner' + (bottom ? ' bottom' : '');
  const r = document.createElement('div'); r.className = 'rank'; r.textContent = RANK_LABEL[card.rank];
  const s = document.createElement('div'); s.className = 'suit'; s.textContent = SUIT_GLYPH[card.suit];
  el.appendChild(r); el.appendChild(s);
  return el;
}

function makeCardEl(card, inHand) {
  const el = document.createElement('div');
  el.className = 'card ' + (isRed(card.suit) ? 'red' : 'black');
  if (isTrump(card, state.trumpSuit)) el.classList.add('trump');
  if (inHand) el.classList.add('in-hand');
  el.dataset.cardId = card.id;
  el.appendChild(corner(card, false));
  const center = document.createElement('div');
  center.className = 'center';
  center.textContent = SUIT_GLYPH[card.suit];
  el.appendChild(center);
  el.appendChild(corner(card, true));
  return el;
}

// ----- Drag and drop -----

function attachDrag(el, card, intent) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    pendingDrag = { card, intent };
    el.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    pendingDrag = null;
    document.querySelectorAll('.drop-active, .drop-target').forEach(n =>
      n.classList.remove('drop-active', 'drop-target'));
  });
  attachTouchDrag(el, card, intent);
}

// Touch-based drag fallback (HTML5 DnD doesn't fire on touch).
function attachTouchDrag(el, card, intent) {
  let ghost = null;
  let startX = 0, startY = 0;
  let moved = false;
  const MOVE_THRESHOLD = 6;

  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    moved = false;
    pendingDrag = { card, intent };
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!pendingDrag) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    moved = true;
    e.preventDefault();
    if (!ghost) {
      ghost = el.cloneNode(true);
      ghost.classList.add('touch-drag');
      ghost.style.width = el.offsetWidth + 'px';
      ghost.style.height = el.offsetHeight + 'px';
      document.body.appendChild(ghost);
      el.classList.add('dragging');
    }
    ghost.style.left = (t.clientX - el.offsetWidth / 2) + 'px';
    ghost.style.top = (t.clientY - el.offsetHeight / 2) + 'px';
    highlightTouchTarget(t.clientX, t.clientY);
  }, { passive: false });

  el.addEventListener('touchend', e => {
    if (!pendingDrag) return;
    if (moved) {
      const t = e.changedTouches[0];
      handleTouchDrop(t.clientX, t.clientY);
    }
    cleanupTouchDrag();
  });

  el.addEventListener('touchcancel', () => cleanupTouchDrag());

  function cleanupTouchDrag() {
    if (ghost) { ghost.remove(); ghost = null; }
    el.classList.remove('dragging');
    pendingDrag = null;
    document.querySelectorAll('.drop-active, .drop-target').forEach(n =>
      n.classList.remove('drop-active', 'drop-target'));
  }
}

function elementsAtPoint(x, y) {
  return document.elementsFromPoint(x, y);
}

function highlightTouchTarget(x, y) {
  if (!pendingDrag) return;
  document.querySelectorAll('.drop-active, .drop-target').forEach(n =>
    n.classList.remove('drop-active', 'drop-target'));
  const { card } = pendingDrag;
  const els = elementsAtPoint(x, y);
  for (const el of els) {
    const slot = el.closest('.slot');
    if (slot) {
      const idx = parseInt(slot.dataset.slotIndex, 10);
      if (canDefend(state, HUMAN, card, idx)) {
        slot.classList.add('drop-target');
        return;
      }
    }
    if (el.id === 'table' || el.closest('#table')) {
      const tbl = document.getElementById('table');
      if ((state.phase === 'attack' && canAttack(state, HUMAN, card)) ||
          (state.phase === 'defend' && canTransfer(state, HUMAN, card))) {
        tbl.classList.add('drop-active');
        return;
      }
    }
  }
}

function handleTouchDrop(x, y) {
  if (!pendingDrag) return;
  const { card } = pendingDrag;
  const els = elementsAtPoint(x, y);
  for (const el of els) {
    const slot = el.closest('.slot');
    if (slot) {
      const idx = parseInt(slot.dataset.slotIndex, 10);
      if (canDefend(state, HUMAN, card, idx)) {
        doDefend(card, idx);
        return;
      }
    }
    if (el.id === 'table' || el.closest('#table')) {
      if (state.phase === 'attack' && canAttack(state, HUMAN, card)) {
        doAttack(card);
        return;
      }
      if (state.phase === 'defend' && canTransfer(state, HUMAN, card)) {
        doTransfer(card);
        return;
      }
    }
  }
}

function setupSlotDrop(slotEl, index) {
  slotEl.addEventListener('dragover', e => {
    if (!pendingDrag) return;
    const card = pendingDrag.card;
    if (canDefend(state, HUMAN, card, index)) {
      e.preventDefault();
    }
  });
  slotEl.addEventListener('drop', e => {
    if (!pendingDrag) return;
    e.preventDefault();
    const card = pendingDrag.card;
    if (canDefend(state, HUMAN, card, index)) {
      doDefend(card, index);
    }
  });
}

// ----- Human actions -----

function doAttack(card) {
  if (!canAttack(state, HUMAN, card)) return;
  applyAttack(state, card);
  render();
  // After human attack, AI defends.
  scheduleAI();
}

function doDefend(card, slotIndex) {
  if (!canDefend(state, HUMAN, card, slotIndex)) return;
  applyDefend(state, card, slotIndex);
  render();
  scheduleAI();
}

function doDefendAuto(card) {
  // Pick the first slot this card can beat.
  for (let i = 0; i < state.table.length; i++) {
    if (canDefend(state, HUMAN, card, i)) {
      doDefend(card, i);
      return;
    }
  }
}

function doTransfer(card) {
  if (!canTransfer(state, HUMAN, card)) return;
  applyTransfer(state, card);
  render();
  scheduleAI();
}

function promptDefendOrTransfer(card) {
  const modal = document.getElementById('choice-modal');
  const cardEl = document.getElementById('choice-card');
  const text = document.getElementById('choice-text');
  const defendBtn = document.getElementById('choice-defend');
  const transferBtn = document.getElementById('choice-transfer');
  const cancelBtn = document.getElementById('choice-cancel');

  cardEl.innerHTML = '';
  cardEl.appendChild(makeCardEl(card, false));
  text.textContent = 'Отбить эту карту или перевести атаку?';

  function close() {
    modal.classList.remove('show');
    defendBtn.onclick = null;
    transferBtn.onclick = null;
    cancelBtn.onclick = null;
  }
  defendBtn.onclick = () => { close(); doDefendAuto(card); };
  transferBtn.onclick = () => { close(); doTransfer(card); };
  cancelBtn.onclick = close;
  modal.classList.add('show');
}

function doPickup() {
  if (state.phase !== 'defend' || state.defender !== HUMAN) return;
  applyPickup(state);
  render();
  scheduleAI();
}

function doEndAttack() {
  if (state.phase !== 'attack' || state.attacker !== HUMAN) return;
  if (state.table.length === 0) return;
  applyEndAttack(state);
  render();
  scheduleAI();
}

// ----- AI driver -----

function scheduleAI() { setTimeout(maybeAITurn, AI_DELAY); }

function maybeAITurn() {
  if (state.phase === 'over') return;

  // AI acts when it's their turn to attack or defend.
  let acting = null;
  if (state.phase === 'attack' && state.attacker === AI) acting = AI;
  else if (state.phase === 'defend' && state.defender === AI) acting = AI;
  if (acting === null) return;

  const action = aiDecide(state, AI);

  if (action.type === 'attack') {
    applyAttack(state, action.card);
    render();
    scheduleAI();
  } else if (action.type === 'defend') {
    applyDefend(state, action.card, action.slot);
    render();
    scheduleAI();
  } else if (action.type === 'transfer') {
    applyTransfer(state, action.card);
    render();
    scheduleAI();
  } else if (action.type === 'pickup') {
    applyPickup(state);
    render();
    scheduleAI();
  } else if (action.type === 'end') {
    // AI is the attacker ending its attack -> resolve bout.
    applyEndAttack(state);
    render();
    // After resolution, AI may keep attacking if it kept the turn.
    scheduleAI();
  }
}

window.addEventListener('DOMContentLoaded', start);
