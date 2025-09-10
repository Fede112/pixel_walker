import { generateMock } from './mock';
import { generateWithOllama } from '../llm/ollama';
const BACKEND = process.env.PIXELGEN_BACKEND || 'mock';
export async function generatePixelArt(req) {
    if (BACKEND === 'ollama') {
        try {
            const fromLlm = await generateWithOllama(req);
            if (fromLlm)
                return fromLlm;
        }
        catch (err) {
            // Fall through to mock on any error
            // eslint-disable-next-line no-console
            console.warn('[pixelgen] Ollama error; falling back to mock:', err);
        }
    }
    return generateMock(req);
}
