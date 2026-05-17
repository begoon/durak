// Durak game engine. Pure state + rules, no DOM.
// 2 players, 36-card deck, Perevodnoy (transfer) enabled.

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_LABEL = { '6':'6','7':'7','8':'8','9':'9','10':'10','J':'В','Q':'Д','K':'К','A':'Т' };
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const HAND_SIZE = 6;

function makeCard(rank, suit) {
  return { rank, suit, id: rank + suit };
}

function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(makeCard(r, s));
  return d;
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isTrump(card, trumpSuit) {
  return card.suit === trumpSuit;
}

// Does `def` beat `att` given trump suit?
function beats(att, def, trumpSuit) {
  if (isTrump(def, trumpSuit) && !isTrump(att, trumpSuit)) return true;
  if (def.suit === att.suit) return RANK_VALUE[def.rank] > RANK_VALUE[att.rank];
  return false;
}

function newGame(rng = Math.random) {
  const deck = shuffle(newDeck(), rng);
  // Trump is the bottom card; it's drawn last.
  const trumpCard = deck[0];
  const trumpSuit = trumpCard.suit;
  const hands = [[], []];
  // Deal 6 from the top (end of array).
  for (let i = 0; i < HAND_SIZE; i++) {
    hands[0].push(deck.pop());
    hands[1].push(deck.pop());
  }
  // Decide first attacker: lowest trump.
  const firstAttacker = decideFirstAttacker(hands, trumpSuit);
  return {
    deck,                    // remaining draw pile; deck[0] is the trump (last drawn)
    trumpCard,
    trumpSuit,
    discard: [],             // bita
    hands,                   // [p0, p1]
    table: [],               // [{attack, defense?}]
    attacker: firstAttacker,
    defender: 1 - firstAttacker,
    phase: 'attack',         // 'attack' | 'defend' | 'over'
    pickup: false,           // defender chose to take
    winner: null,            // null | 0 | 1 | 'draw'
    durak: null,
    log: [],
  };
}

function decideFirstAttacker(hands, trumpSuit) {
  let best = { p: 0, v: Infinity };
  for (let p = 0; p < 2; p++) {
    for (const c of hands[p]) {
      if (c.suit === trumpSuit && RANK_VALUE[c.rank] < best.v) {
        best = { p, v: RANK_VALUE[c.rank] };
      }
    }
  }
  if (best.v === Infinity) return 0;
  return best.p;
}

function tableRanks(table) {
  const s = new Set();
  for (const slot of table) {
    s.add(slot.attack.rank);
    if (slot.defense) s.add(slot.defense.rank);
  }
  return s;
}

function unbeatenSlots(table) {
  return table.filter(s => !s.defense);
}

// How many more attack cards can be added to the table?
function attackRoomLeft(state) {
  const defenderHand = state.hands[state.defender].length;
  const unbeaten = unbeatenSlots(state.table).length;
  // Defender must still be able to cover all unbeaten attacks.
  // Cap by HAND_SIZE total cards on table during one bout.
  const cap = Math.min(HAND_SIZE, defenderHand + state.table.filter(s => s.defense).length);
  return Math.max(0, cap - state.table.length);
}

// ----- Legal-move predicates -----

function canAttack(state, player, card) {
  if (state.phase !== 'attack') return false;
  if (player !== state.attacker) return false;
  if (!state.hands[player].some(c => c.id === card.id)) return false;
  if (attackRoomLeft(state) <= 0) return false;
  if (state.table.length === 0) return true;
  return tableRanks(state.table).has(card.rank);
}

function canDefend(state, player, card, slotIndex) {
  if (state.phase !== 'defend') return false;
  if (player !== state.defender) return false;
  if (state.pickup) return false;
  const slot = state.table[slotIndex];
  if (!slot || slot.defense) return false;
  if (!state.hands[player].some(c => c.id === card.id)) return false;
  return beats(slot.attack, card, state.trumpSuit);
}

// Transfer (Perevodnoy): defender plays a card whose rank matches all
// unbeaten attack cards on the table, flipping roles.
function canTransfer(state, player, card) {
  if (state.phase !== 'defend') return false;
  if (player !== state.defender) return false;
  if (state.pickup) return false;
  if (state.table.length === 0) return false;
  // All cards on the table must be unbeaten attacks of the same rank.
  if (state.table.some(s => s.defense)) return false;
  const rank = state.table[0].attack.rank;
  if (state.table.some(s => s.attack.rank !== rank)) return false;
  if (card.rank !== rank) return false;
  if (!state.hands[player].some(c => c.id === card.id)) return false;
  // New defender (current attacker) must be able to face the pile.
  const newDefenderHand = state.hands[state.attacker].length;
  if (newDefenderHand < state.table.length + 1) return false;
  return true;
}

// ----- Move application -----

function removeFromHand(hand, card) {
  const i = hand.findIndex(c => c.id === card.id);
  if (i >= 0) hand.splice(i, 1);
}

function applyAttack(state, card) {
  removeFromHand(state.hands[state.attacker], card);
  state.table.push({ attack: card, defense: null });
  // If defender has chosen to pick up, attacker can keep piling on without
  // re-engaging the defender. Phase stays 'attack' until the bout ends.
  if (!state.pickup) state.phase = 'defend';
  state.log.push(`P${state.attacker} attacks with ${cardLabel(card)}`);
}

function applyDefend(state, card, slotIndex) {
  removeFromHand(state.hands[state.defender], card);
  state.table[slotIndex].defense = card;
  state.log.push(`P${state.defender} beats with ${cardLabel(card)}`);
  // After defending, return to 'attack' so attacker can pile on or end.
  if (unbeatenSlots(state.table).length === 0) {
    state.phase = 'attack';
  }
}

function applyTransfer(state, card) {
  removeFromHand(state.hands[state.defender], card);
  state.table.push({ attack: card, defense: null });
  state.log.push(`P${state.defender} transfers with ${cardLabel(card)}`);
  // Flip roles.
  const oldAtt = state.attacker;
  state.attacker = state.defender;
  state.defender = oldAtt;
  state.phase = 'defend';
}

// Attacker ends their attack with no further cards. If all are beaten,
// the bout ends (cards go to bita and roles swap).
function applyEndAttack(state) {
  if (state.phase !== 'attack') return;
  if (state.table.length === 0) return;
  endBout(state, false);
}

// Defender chooses to pick up. Attacker may still throw matching-rank
// cards (up to defender hand limit) before bout ends.
function applyPickup(state) {
  if (state.phase !== 'defend') return;
  state.pickup = true;
  state.phase = 'attack';
  state.log.push(`P${state.defender} will pick up`);
}

// Finish a bout: either defender successfully defended (cards to bita)
// or defender took the cards (added to defender hand).
function endBout(state, forceTake = null) {
  const tookUp = forceTake !== null ? forceTake : state.pickup;
  const cards = [];
  for (const slot of state.table) {
    cards.push(slot.attack);
    if (slot.defense) cards.push(slot.defense);
  }
  if (tookUp) {
    state.hands[state.defender].push(...cards);
    state.log.push(`P${state.defender} picks up ${cards.length}`);
  } else {
    state.discard.push(...cards);
    state.log.push(`Bout cleared (${cards.length} to bita)`);
  }
  state.table = [];
  state.pickup = false;

  // Refill: attacker first, then defender, up to HAND_SIZE.
  refill(state, state.attacker);
  refill(state, state.defender);

  // Decide next attacker.
  if (tookUp) {
    // Same attacker keeps the turn.
  } else {
    // Defender becomes new attacker.
    const newAtt = state.defender;
    state.defender = state.attacker;
    state.attacker = newAtt;
  }
  state.phase = 'attack';
  checkEnd(state);
}

function refill(state, player) {
  while (state.hands[player].length < HAND_SIZE && state.deck.length > 0) {
    // Draw from the top (end). The bottom card (index 0) is the trump,
    // taken last.
    state.hands[player].push(state.deck.pop());
  }
}

function checkEnd(state) {
  if (state.deck.length > 0) return;
  const empties = state.hands.map(h => h.length === 0);
  if (empties[0] && empties[1]) {
    state.phase = 'over';
    state.winner = 'draw';
    state.durak = null;
    state.log.push('Draw');
    return;
  }
  if (empties[0]) {
    state.phase = 'over';
    state.winner = 0;
    state.durak = 1;
    state.log.push('P0 wins, P1 is Durak');
  } else if (empties[1]) {
    state.phase = 'over';
    state.winner = 1;
    state.durak = 0;
    state.log.push('P1 wins, P0 is Durak');
  }
}

function cardLabel(c) {
  return RANK_LABEL[c.rank] + SUIT_GLYPH[c.suit];
}

// Defender's lowest legal beater for a given attack, or null.
function lowestBeater(hand, attack, trumpSuit) {
  let best = null;
  for (const c of hand) {
    if (!beats(attack, c, trumpSuit)) continue;
    if (
      best === null ||
      trumpRank(c, trumpSuit) < trumpRank(best, trumpSuit)
    ) best = c;
  }
  return best;
}

// Sort key: non-trumps by rank, then trumps by rank (always heavier).
function trumpRank(c, trumpSuit) {
  return (isTrump(c, trumpSuit) ? 100 : 0) + RANK_VALUE[c.rank];
}

if (typeof module !== 'undefined') {
  module.exports = {
    SUITS, SUIT_GLYPH, RANKS, RANK_LABEL, RANK_VALUE, HAND_SIZE,
    newGame, beats, isTrump, trumpRank, lowestBeater,
    canAttack, canDefend, canTransfer,
    applyAttack, applyDefend, applyTransfer,
    applyEndAttack, applyPickup, endBout,
    unbeatenSlots, tableRanks, attackRoomLeft, cardLabel,
  };
}
