import { buildGridPrompt } from '../pixelgen/prompt';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3:mini';
export async function generateWithOllama(req) {
    const body = {
        model: OLLAMA_MODEL,
        prompt: buildGridPrompt(req),
        stream: false,
        format: 'json',
        options: {
            seed: req.seed ?? 42,
            temperature: 0.7,
            num_predict: 700,
            stop: []
        }
    };
    const url = `${OLLAMA_HOST}/api/generate`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${text}`);
    }
    const data = (await res.json());
    // Parse the model JSON output, which should be in data.response
    const parsed = safeParseJsonObject(data.response);
    if (!parsed)
        return null;
    const validated = validateGridJson(parsed);
    return validated ? { ...validated, source: 'ollama' } : null;
}
function safeParseJsonObject(text) {
    // Try direct parse first
    try {
        return JSON.parse(text);
    }
    catch { }
    // Fallback: extract first top-level balanced {...}
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        const candidate = text.slice(start, end + 1);
        try {
            return JSON.parse(candidate);
        }
        catch { }
    }
    return null;
}
function validateGridJson(obj) {
    if (!obj || typeof obj !== 'object')
        return null;
    const { width, height, palette, grid } = obj;
    if (typeof width !== 'number' || typeof height !== 'number')
        return null;
    if (!Array.isArray(palette) || !palette.every((c) => typeof c === 'string' && c.length === 1))
        return null;
    if (!Array.isArray(grid) || grid.length !== height)
        return null;
    for (const row of grid) {
        if (typeof row !== 'string' || row.length !== width)
            return null;
        for (const ch of row) {
            if (!palette.includes(ch))
                return null;
        }
    }
    return { width, height, palette, grid };
}
