// MediaPipe FACE_OVAL as an ordered closed loop (36 vertices, starting at forehead-top 10 and
// running towards image-right first). Derived by chaining FaceLandmarker.FACE_LANDMARKS_FACE_OVAL
// from @mediapipe/tasks-vision 0.10.35; faceOval.test.ts re-derives it from the package so a
// version bump that changes the topology fails loudly. Hard-coded so the adapter does not pull in
// the tasks-vision bundle.
export const FACE_OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
  136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export interface Edge {
  start: number;
  end: number;
}

/**
 * Chain an undirected edge list that forms one simple closed loop into its vertex order,
 * starting at `first` and following the edge listed with `first` as its start.
 */
export function chainLoop(edges: readonly Edge[], first: number): number[] {
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (const { start, end } of edges) {
    link(start, end);
    link(end, start);
  }
  for (const [v, n] of adj) if (n.length !== 2) throw new Error(`chainLoop: vertex ${v} has degree ${n.length}`);
  const firstEdge = edges.find((e) => e.start === first);
  if (!firstEdge) throw new Error(`chainLoop: no edge starts at ${first}`);
  const order = [first];
  let prev = first;
  let cur = firstEdge.end;
  while (cur !== first) {
    order.push(cur);
    const [a, b] = adj.get(cur)!;
    const next = a === prev ? b : a;
    prev = cur;
    cur = next;
  }
  if (order.length !== adj.size) throw new Error(`chainLoop: edges form more than one loop`);
  return order;
}
