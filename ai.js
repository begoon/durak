// Simple heuristic AI for Durak.
// Exposes one function: aiDecide(state, player) -> action

if (typeof module !== 'undefined' && typeof window === 'undefined') {
  // Node test harness: pull symbols from game.js into module scope.
  const G = require('./game.js');
  for (const k of Object.keys(G)) global[k] = G[k];
}

function aiDecide(state, player) {
  if (state.phase === 'over') return { type: 'none' };

  if (player === state.attacker && state.phase === 'attack') {
    return aiAttack(state, player);
  }
  if (player === state.defender && state.phase === 'defend') {
    return aiDefend(state, player);
  }
  return { type: 'none' };
}

function aiAttack(state, player) {
  const hand = state.hands[player].slice();
  const trump = state.trumpSuit;
  const sorted = hand.slice().sort((a, b) => trumpRank(a, trump) - trumpRank(b, trump));

  // Defender about to pick up: pile on cheap same-rank cards.
  if (state.pickup) {
    const ranksOnTable = tableRanks(state.table);
    const room = attackRoomLeft(state);
    if (room <= 0) return { type: 'end' };
    const dump = sorted.find(c => ranksOnTable.has(c.rank) && !isTrump(c, trump))
              || sorted.find(c => ranksOnTable.has(c.rank));
    if (dump) return { type: 'attack', card: dump };
    return { type: 'end' };
  }

  // Fresh attack.
  if (state.table.length === 0) {
    // Lead lowest non-trump if possible.
    const nonTrump = sorted.find(c => !isTrump(c, trump));
    const lead = nonTrump || sorted[0];
    return { type: 'attack', card: lead };
  }

  // Pile-on: only add if it's the lowest non-trump matching a table rank
  // and the opponent's hand looks weak. Be conservative.
  const ranksOnTable = tableRanks(state.table);
  const room = attackRoomLeft(state);
  if (room > 0) {
    const oppHand = state.hands[1 - player].length;
    const cheap = sorted.find(c => ranksOnTable.has(c.rank) && !isTrump(c, trump)
      && RANK_VALUE[c.rank] <= RANK_VALUE['10']);
    // Throw extra only if opponent has more cards (they can be drained)
    // or if hand is heavy.
    if (cheap && (oppHand >= 3 || hand.length > HAND_SIZE)) {
      return { type: 'attack', card: cheap };
    }
  }
  return { type: 'end' };
}

function aiDefend(state, player) {
  if (state.pickup) return { type: 'pickup' };
  const trump = state.trumpSuit;
  const hand = state.hands[player];
  const slots = state.table.map((s, i) => ({ s, i })).filter(x => !x.s.defense);

  // Consider transfer first if all attacks share rank and we hold it.
  if (canTransferable(state, player)) {
    const rank = state.table[0].attack.rank;
    const candidate = hand
      .filter(c => c.rank === rank)
      .sort((a, b) => trumpRank(a, trump) - trumpRank(b, trump))[0];
    if (candidate) {
      // Transfer only if non-trump or the opponent looks vulnerable.
      const oppHand = state.hands[1 - player].length;
      if (!isTrump(candidate, trump) && oppHand <= hand.length) {
        return { type: 'transfer', card: candidate };
      }
    }
  }

  // Cost estimate of taking vs beating.
  // For each unbeaten slot, find lowest beater. If any slot has no beater,
  // we must take. Otherwise, if pile is small and beaters are heavy, take.
  let beaters = [];
  let usedIds = new Set();
  for (const { s } of slots) {
    let best = null;
    for (const c of hand) {
      if (usedIds.has(c.id)) continue;
      if (!beats(s.attack, c, trump)) continue;
      if (!best || trumpRank(c, trump) < trumpRank(best, trump)) best = c;
    }
    if (!best) { beaters = null; break; }
    beaters.push(best);
    usedIds.add(best.id);
  }

  if (!beaters) {
    return { type: 'pickup' };
  }

  // If we'd burn a high trump on a low non-trump pile, consider taking.
  const pileSize = state.table.length;
  const usesTrump = beaters.some(c => isTrump(c, trump));
  const heavyTrump = beaters.some(c => isTrump(c, trump) && RANK_VALUE[c.rank] >= RANK_VALUE['J']);
  const deckLeft = state.deck.length;
  if (heavyTrump && pileSize <= 1 && deckLeft >= 4) {
    return { type: 'pickup' };
  }
  if (usesTrump && pileSize === 1 && !isTrump(state.table[0].attack, trump)
      && RANK_VALUE[state.table[0].attack.rank] <= RANK_VALUE['9'] && deckLeft >= 6) {
    return { type: 'pickup' };
  }

  // Defend the first unbeaten slot with its assigned beater.
  const target = slots[0];
  // Recompute beater for that slot (independent best).
  const card = lowestBeater(hand, target.s.attack, trump);
  if (!card) return { type: 'pickup' };
  return { type: 'defend', card, slot: target.i };
}

function canTransferable(state, player) {
  if (state.table.length === 0) return false;
  if (state.table.some(s => s.defense)) return false;
  const rank = state.table[0].attack.rank;
  if (state.table.some(s => s.attack.rank !== rank)) return false;
  if (state.hands[1 - player].length < state.table.length + 1) return false;
  return state.hands[player].some(c => c.rank === rank);
}

if (typeof module !== 'undefined') {
  module.exports = { aiDecide };
}
