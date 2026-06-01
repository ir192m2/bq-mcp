/**
 * Graph traversal: BFS/DFS over the prereq graph, path finding, cycle detection.
 *
 * Direction convention:
 *   prereqs: prereq_id -> quest_id   (you must complete prereq_id before quest_id)
 *   - "what blocks X?"   = forward traversal from X
 *   - "what does X unlock?" = reverse traversal from X
 *   - "what unlocks X?"   = reverse traversal from X
 *   - "what does X depend on?" = forward traversal from X
 */
import { getDb } from "./db.js";

function* bfs(startIds, neighbors, maxNodes = 5000) {
  const visited = new Set();
  const queue = startIds.map(id => ({ id, depth: 0, parent: null, via: null }));
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    yield cur;
    if (visited.size >= maxNodes) return;
    for (const n of neighbors(cur.id)) {
      if (!visited.has(n.id)) queue.push({ id: n.id, depth: cur.depth + 1, parent: cur.id, via: n.via });
    }
  }
}

function neighborsBackward(db, questId) {
  // "what does X unlock?" -> quests for which X is a prereq
  return db.prepare("SELECT quest_id AS id FROM prereqs WHERE prereq_id = ?").all(questId).map(r => ({ id: r.id, via: "prereq" }));
}
function neighborsForward(db, questId) {
  // "what unlocks X?" -> prereqs of X
  return db.prepare("SELECT prereq_id AS id FROM prereqs WHERE quest_id = ?").all(questId).map(r => ({ id: r.id, via: "prereq" }));
}

export function getUnlocks(questId, maxNodes = 1000) {
  const db = getDb();
  const out = [];
  for (const node of bfs([questId], (id) => neighborsBackward(db, id), maxNodes)) {
    if (node.id !== questId) out.push({ id: node.id, depth: node.depth });
  }
  return out;
}

export function getBlockers(questId, maxNodes = 1000) {
  const db = getDb();
  const out = [];
  for (const node of bfs([questId], (id) => neighborsForward(db, id), maxNodes)) {
    if (node.id !== questId) out.push({ id: node.id, depth: node.depth });
  }
  return out;
}

export function findPath(fromId, toId, maxDepth = 20) {
  // Find a path in the forward direction (prereq chain) from fromId to toId
  // i.e., fromId is a prereq of toId
  const db = getDb();
  if (fromId === toId) return [fromId];
  const visited = new Set();
  const queue = [{ id: toId, path: [toId] }];
  while (queue.length) {
    const { id, path } = queue.shift();
    if (id === fromId) return path.reverse();
    if (path.length > maxDepth) continue;
    if (visited.has(id)) continue;
    visited.add(id);
    const prereqs = db.prepare("SELECT prereq_id FROM prereqs WHERE quest_id = ?").all(id);
    for (const p of prereqs) {
      queue.push({ id: p.prereq_id, path: [...path, p.prereq_id] });
    }
  }
  return null;
}

export function detectCycles(maxNodes = 5000) {
  const db = getDb();
  // Iterative Tarjan-style SCC detection via BFS over all nodes
  const cycles = [];
  const visited = new Set();
  const allIds = db.prepare("SELECT id FROM quests").all().map(r => r.id);
  for (const start of allIds) {
    if (visited.has(start)) continue;
    const stack = [{ id: start, path: [start] }];
    while (stack.length) {
      const { id, path } = stack.pop();
      if (visited.has(id)) continue;
      if (path.length > 50) continue;
      const next = db.prepare("SELECT quest_id FROM prereqs WHERE prereq_id = ?").all(id);
      for (const n of next) {
        if (path.includes(n.quest_id)) {
          const idx = path.indexOf(n.quest_id);
          const cycle = path.slice(idx).concat(n.quest_id);
          cycles.push(cycle);
        } else if (!visited.has(n.quest_id)) {
          stack.push({ id: n.quest_id, path: [...path, n.quest_id] });
        }
      }
      visited.add(id);
    }
    if (cycles.length >= 100) break;
    if (visited.size >= maxNodes) break;
  }
  return cycles;
}

export function prereqDepth(questId) {
  // Longest path of prereqs to a root quest (no prereqs)
  const db = getDb();
  const memo = new Map();
  function depth(id, seen) {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const prereqs = db.prepare("SELECT prereq_id FROM prereqs WHERE quest_id = ?").all(id);
    if (prereqs.length === 0) { memo.set(id, 0); return 0; }
    let best = 0;
    for (const p of prereqs) best = Math.max(best, 1 + depth(p.prereq_id, seen));
    seen.delete(id);
    memo.set(id, best);
    return best;
  }
  return depth(questId, new Set());
}
