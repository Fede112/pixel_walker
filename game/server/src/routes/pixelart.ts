import { Router } from 'express';
import { generatePixelArt } from '../pixelgen';
import type { PixelGenRequest } from '../pixelgen/types';

export const pixelArtRouter = Router();

pixelArtRouter.post('/', async (req, res) => {
  const body = req.body as PixelGenRequest | undefined;
  if (!body || !body.prompt || typeof body.prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    const result = await generatePixelArt({
      prompt: body.prompt,
      size: (body.size as any) ?? 16,
      seed: body.seed ?? Date.now() % 100000,
      mode: 'grid'
    });
    return res.json(result);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('pixelart error', err);
    return res.status(500).json({ error: 'generation_failed' });
  }
});

