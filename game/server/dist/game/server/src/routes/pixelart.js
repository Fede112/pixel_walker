import { Router } from 'express';
import { generatePixelArt } from '../pixelgen';
export const pixelArtRouter = Router();
pixelArtRouter.post('/', async (req, res) => {
    const body = req.body;
    if (!body || !body.prompt || typeof body.prompt !== 'string') {
        return res.status(400).json({ error: 'Missing prompt' });
    }
    try {
        const result = await generatePixelArt({
            prompt: body.prompt,
            size: body.size ?? 16,
            seed: body.seed ?? Date.now() % 100000,
            mode: 'grid'
        });
        return res.json(result);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('pixelart error', err);
        return res.status(500).json({ error: 'generation_failed' });
    }
});
