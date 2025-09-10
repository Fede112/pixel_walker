// Simple seeded RNG
function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const DEFAULT_PALETTE = [' ', '.', ':', '-', '+', '*', '#', '@'];
export function generateMock(req) {
    const size = req.size ?? 16;
    const rand = mulberry32((req.seed ?? 42) >>> 0);
    const palette = DEFAULT_PALETTE.slice(0);
    const grid = [];
    const p = req.prompt.toLowerCase();
    const isSteel = /(steel|metal|iron|plate)/.test(p);
    const isCar = /(car|vehicle|auto)/.test(p);
    // Base noise field
    const noise = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            // Smoothed value using neighboring randoms
            const n = (rand() + rand() + rand()) / 3;
            row.push(n);
        }
        noise.push(row);
    }
    // Optional motif overlays
    const canvas = noise.map((r) => r.slice());
    if (isSteel) {
        // Horizontal brushed lines
        for (let y = 0; y < size; y++) {
            const stripe = (y % 4) / 4;
            for (let x = 0; x < size; x++) {
                canvas[y][x] = Math.min(1, Math.max(0, canvas[y][x] * 0.5 + stripe * 0.5));
            }
        }
        // Rivets grid
        for (let y = 2; y < size; y += 6) {
            for (let x = 2; x < size; x += 6) {
                canvas[y][x] = 1;
                if (y + 1 < size)
                    canvas[y + 1][x] = 0.9;
                if (x + 1 < size)
                    canvas[y][x + 1] = 0.9;
            }
        }
    }
    if (isCar) {
        // Simple car silhouette: body + wheels
        const bodyY = Math.floor(size * 0.5);
        const bodyH = Math.max(2, Math.floor(size * 0.25));
        const bodyX0 = Math.floor(size * 0.2);
        const bodyX1 = Math.floor(size * 0.8);
        for (let y = bodyY - bodyH; y <= bodyY; y++) {
            for (let x = bodyX0; x <= bodyX1; x++) {
                canvas[y][x] = Math.max(canvas[y][x], 0.8);
            }
        }
        // Cabin
        for (let y = bodyY - bodyH - 2; y <= bodyY - 1; y++) {
            for (let x = bodyX0 + 2; x <= bodyX0 + Math.floor((bodyX1 - bodyX0) * 0.5); x++) {
                if (y >= 0 && x >= 0 && y < size && x < size)
                    canvas[y][x] = Math.max(canvas[y][x], 0.6);
            }
        }
        // Wheels
        const wy = bodyY + 1;
        const w0 = Math.floor(size * 0.3);
        const w1 = Math.floor(size * 0.7);
        if (wy < size) {
            canvas[wy][w0] = 1;
            if (w0 + 1 < size)
                canvas[wy][w0 + 1] = 0.9;
            canvas[wy][w1] = 1;
            if (w1 - 1 >= 0)
                canvas[wy][w1 - 1] = 0.9;
        }
    }
    // Map 0..1 to palette
    for (let y = 0; y < size; y++) {
        let line = '';
        for (let x = 0; x < size; x++) {
            const v = canvas[y][x];
            const idx = Math.min(palette.length - 1, Math.max(0, Math.floor(v * palette.length)));
            line += palette[idx];
        }
        grid.push(line);
    }
    return { width: size, height: size, palette, grid, source: 'mock' };
}
