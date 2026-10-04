// Orthogonal schematic router. Automatic routes are computed on a visibility
// graph made from pin stubs and expanded component edges. Dijkstra minimises
// length, then bends, then crossings with existing nets. Manual segment drags
// preserve 90-degree geometry and fixed electrical endpoints.

export const STUB = 22;
const CLEARANCE = 12;
const BEND_COST = 28;
const CROSSING_COST = 45;
const OVERLAP_COST = 120;
const EPS = 0.001;
const DIR_VECTOR = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };
export const axisOf = dir => (dir === 'left' || dir === 'right') ? 'h' : 'v';

export function stubPoint(pin, dir, len = STUB) {
  const vector = DIR_VECTOR[dir] || DIR_VECTOR.right;
  return { x: pin.x + vector.x * len, y: pin.y + vector.y * len };
}

function almostEqual(a, b) { return Math.abs(a - b) < EPS; }
function pointKey(point) { return `${point.x.toFixed(3)},${point.y.toFixed(3)}`; }

function inflatedObstacles(components, exclude = new Set()) {
  return components
    .filter(component => !exclude.has(component.id))
    .map(component => ({
      x1: component.x - CLEARANCE,
      y1: component.y - CLEARANCE,
      x2: component.x + component.w + CLEARANCE,
      y2: component.y + component.h + CLEARANCE
    }));
}

function pointInside(point, rect) {
  return point.x > rect.x1 + EPS && point.x < rect.x2 - EPS && point.y > rect.y1 + EPS && point.y < rect.y2 - EPS;
}

function segmentBlocked(a, b, obstacles) {
  const horizontal = almostEqual(a.y, b.y);
  if (!horizontal && !almostEqual(a.x, b.x)) return true;
  for (const rect of obstacles) {
    if (horizontal) {
      if (a.y > rect.y1 + EPS && a.y < rect.y2 - EPS && Math.max(Math.min(a.x, b.x), rect.x1) < Math.min(Math.max(a.x, b.x), rect.x2) - EPS) return true;
    } else if (a.x > rect.x1 + EPS && a.x < rect.x2 - EPS && Math.max(Math.min(a.y, b.y), rect.y1) < Math.min(Math.max(a.y, b.y), rect.y2) - EPS) return true;
  }
  return false;
}

function wirePenalty(a, b, occupiedPaths) {
  let penalty = 0;
  const horizontal = almostEqual(a.y, b.y);
  for (const path of occupiedPaths || []) {
    for (let index = 0; index < path.length - 1; index += 1) {
      const c = path[index], d = path[index + 1];
      const occupiedHorizontal = almostEqual(c.y, d.y);
      if (horizontal === occupiedHorizontal) {
        const sameLine = horizontal ? almostEqual(a.y, c.y) : almostEqual(a.x, c.x);
        if (!sameLine) continue;
        const a1 = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
        const a2 = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        const b1 = horizontal ? Math.min(c.x, d.x) : Math.min(c.y, d.y);
        const b2 = horizontal ? Math.max(c.x, d.x) : Math.max(c.y, d.y);
        if (Math.max(a1, b1) < Math.min(a2, b2) - EPS) penalty += OVERLAP_COST;
      } else {
        const h1 = horizontal ? a : c, h2 = horizontal ? b : d;
        const v1 = horizontal ? c : a, v2 = horizontal ? d : b;
        const ix = v1.x, iy = h1.y;
        if (ix > Math.min(h1.x, h2.x) + EPS && ix < Math.max(h1.x, h2.x) - EPS && iy > Math.min(v1.y, v2.y) + EPS && iy < Math.max(v1.y, v2.y) - EPS) penalty += CROSSING_COST;
      }
    }
  }
  return penalty;
}

function uniqueSorted(values) {
  return [...new Set(values.map(value => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].cost <= item.cost) break;
      this.items[index] = this.items[parent]; index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const first = this.items[0], last = this.items.pop();
    if (!this.items.length) return first;
    let index = 0;
    while (true) {
      let left = index * 2 + 1, right = left + 1;
      if (left >= this.items.length) break;
      let child = right < this.items.length && this.items[right].cost < this.items[left].cost ? right : left;
      if (this.items[child].cost >= last.cost) break;
      this.items[index] = this.items[child]; index = child;
    }
    this.items[index] = last;
    return first;
  }
}

function buildVisibilityGraph(start, end, obstacles) {
  const xs = uniqueSorted([start.x, end.x, ...obstacles.flatMap(rect => [rect.x1, rect.x2])]);
  const ys = uniqueSorted([start.y, end.y, ...obstacles.flatMap(rect => [rect.y1, rect.y2])]);
  const nodes = [];
  const byKey = new Map();
  for (const x of xs) for (const y of ys) {
    const point = { x, y };
    if (obstacles.some(rect => pointInside(point, rect))) continue;
    byKey.set(pointKey(point), nodes.length);
    nodes.push(point);
  }
  const neighbors = nodes.map(() => []);
  const rows = new Map(), columns = new Map();
  nodes.forEach((point, index) => {
    const row = point.y.toFixed(3), column = point.x.toFixed(3);
    if (!rows.has(row)) rows.set(row, []);
    if (!columns.has(column)) columns.set(column, []);
    rows.get(row).push(index); columns.get(column).push(index);
  });
  const linkVisible = (indices, axis) => {
    indices.sort((ia, ib) => nodes[ia][axis] - nodes[ib][axis]);
    for (let index = 0; index < indices.length - 1; index += 1) {
      const from = indices[index], to = indices[index + 1];
      if (segmentBlocked(nodes[from], nodes[to], obstacles)) continue;
      const distance = Math.abs(nodes[from].x - nodes[to].x) + Math.abs(nodes[from].y - nodes[to].y);
      const direction = axis === 'x' ? 'h' : 'v';
      neighbors[from].push({ to, distance, direction });
      neighbors[to].push({ to: from, distance, direction });
    }
  };
  rows.forEach(indices => linkVisible(indices, 'x'));
  columns.forEach(indices => linkVisible(indices, 'y'));
  return { nodes, neighbors, start: byKey.get(pointKey(start)), end: byKey.get(pointKey(end)) };
}

function shortestOrthogonalPath(start, end, obstacles, occupiedPaths) {
  const graph = buildVisibilityGraph(start, end, obstacles);
  if (graph.start == null || graph.end == null) return null;
  const heap = new MinHeap();
  const distances = new Map(), previous = new Map();
  const startState = `${graph.start}|n`;
  distances.set(startState, 0);
  heap.push({ key: startState, node: graph.start, direction: 'n', cost: 0 });
  let goalState = null;

  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== distances.get(current.key)) continue;
    if (current.node === graph.end) { goalState = current.key; break; }
    for (const edge of graph.neighbors[current.node]) {
      const bend = current.direction !== 'n' && current.direction !== edge.direction ? BEND_COST : 0;
      const crossing = wirePenalty(graph.nodes[current.node], graph.nodes[edge.to], occupiedPaths);
      const nextCost = current.cost + edge.distance + bend + crossing;
      const nextKey = `${edge.to}|${edge.direction}`;
      if (nextCost >= (distances.get(nextKey) ?? Infinity)) continue;
      distances.set(nextKey, nextCost);
      previous.set(nextKey, current.key);
      heap.push({ key: nextKey, node: edge.to, direction: edge.direction, cost: nextCost });
    }
  }
  if (!goalState) return null;
  const reversed = [];
  let key = goalState;
  while (key) {
    reversed.push(graph.nodes[Number(key.split('|')[0])]);
    key = previous.get(key);
  }
  return reversed.reverse();
}

function fallbackRoute(a, aDir, b, bDir, obstacles) {
  const start = stubPoint(a, aDir), end = stubPoint(b, bDir);
  const candidates = [
    [a, start, { x: end.x, y: start.y }, end, b],
    [a, start, { x: start.x, y: end.y }, end, b]
  ];
  const clear = candidates.find(points => points.slice(1, -2).every((point, index) => !segmentBlocked(point, points[index + 2], obstacles)));
  return simplifyPath(clear || candidates[0]);
}

export function autoRoute(a, aDir, b, bDir, components = [], ownerIds = new Set(), occupiedPaths = []) {
  const obstacles = inflatedObstacles(components, ownerIds);
  const start = stubPoint(a, aDir), end = stubPoint(b, bDir);
  const middle = shortestOrthogonalPath(start, end, obstacles, occupiedPaths);
  return middle ? simplifyPath([a, ...middle, b]) : fallbackRoute(a, aDir, b, bDir, obstacles);
}

function dedupe(points) {
  const result = [];
  for (const point of points || []) {
    const previous = result[result.length - 1];
    if (!previous || !almostEqual(previous.x, point.x) || !almostEqual(previous.y, point.y)) result.push({ x: point.x, y: point.y });
  }
  return result;
}

export function simplifyPath(points) {
  const clean = dedupe(points);
  if (clean.length < 3) return clean;
  const result = [clean[0]];
  for (let index = 1; index < clean.length - 1; index += 1) {
    const a = result[result.length - 1], b = clean[index], c = clean[index + 1];
    if ((almostEqual(a.y, b.y) && almostEqual(b.y, c.y)) || (almostEqual(a.x, b.x) && almostEqual(b.x, c.x))) continue;
    result.push(b);
  }
  result.push(clean[clean.length - 1]);
  return result;
}

export function reflowEndpoint(points, side, newPin, dir) {
  if (!points?.length) return [newPin];
  const forward = side === 'from';
  const ordered = forward ? points.map(point => ({ ...point })) : points.slice().reverse().map(point => ({ ...point }));
  const stub = stubPoint(newPin, dir);
  const rest = ordered.slice(Math.min(2, ordered.length));
  let bridge = [newPin, stub];
  if (rest.length) {
    const next = rest[0];
    if (!almostEqual(next.x, stub.x) && !almostEqual(next.y, stub.y)) {
      bridge.push(axisOf(dir) === 'h' ? { x: stub.x, y: next.y } : { x: next.x, y: stub.y });
    }
  }
  const result = simplifyPath([...bridge, ...rest]);
  return forward ? result : result.reverse();
}

export function dragSegment(points, segmentIndex, dx, dy) {
  const result = points.map(point => ({ ...point }));
  const i = segmentIndex, j = segmentIndex + 1;
  if (!result[i] || !result[j]) return result;
  const horizontal = almostEqual(result[i].y, result[j].y);
  const delta = horizontal ? dy : dx;
  const touchesStart = i === 0, touchesEnd = j === result.length - 1;
  const shift = point => horizontal ? { x: point.x, y: point.y + delta } : { x: point.x + delta, y: point.y };

  if (touchesStart && touchesEnd) return simplifyPath([result[0], shift(result[0]), shift(result[1]), result[1]]);
  if (touchesStart) return simplifyPath([result[0], shift(result[0]), shift(result[1]), result[1], ...result.slice(2)]);
  if (touchesEnd) return simplifyPath([...result.slice(0, -2), result[i], shift(result[i]), shift(result[j]), result[j]]);
  if (horizontal) { result[i].y += dy; result[j].y += dy; }
  else { result[i].x += dx; result[j].x += dx; }
  return simplifyPath(result);
}

export function pathToD(points = []) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${Number(point.x.toFixed(2))} ${Number(point.y.toFixed(2))}`).join(' ');
}

export function pathIsOrthogonal(points = []) {
  return points.every((point, index) => index === 0 || almostEqual(point.x, points[index - 1].x) || almostEqual(point.y, points[index - 1].y));
}
