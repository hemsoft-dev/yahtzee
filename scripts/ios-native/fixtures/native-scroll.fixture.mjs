export const metrics = (more = {}) => ({ ox: 0, oy: 0, bx: 0, by: 0, bw: 1032000, bh: 1250000, cw: 1032000, ch: 7000000,
  it: 0, il: 0, ib: 0, ir: 0, at: 10000, al: 0, ab: 20000, ar: 0,
  fx: 0, fy: 106000, fw: 1032000, fh: 1250000, cx: 0, cy: 106000, cwidth: 1032000, cheight: 1250000,
  geometryComplete: true, drag: false, decel: false, tracking: false, enabled: true, clips: true, hidden: false, attached: true,
  zoom: 1000, ww: 1032000, wh: 1376000, scale: 2000, orientation: 1, ...more });
export const record = (seq = 0, more = {}) => ({ v: 1, seq, pid: 20, epoch: 10000000, k: 0, phase: 3, call: 0,
  instance: 0, window: 0, gesture: 0, q: 0, code: 0, u0: 10 + seq / 100, u1: 10.001 + seq / 100, w: 1000 + seq / 100,
  willDecelerate: -1, metrics: null, touch: null, ...more });
export const callback = (seq, phase, more = {}) => record(seq, { k: 6, phase, call: 1, instance: 1, window: 1, gesture: 1, metrics: metrics(), ...more });
export const lines = (...rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
