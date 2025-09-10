export function buildGridPrompt(req) {
    const size = req.size ?? 16;
    // Few-shot example to constrain output
    const fewShotSteel = `Task: Generate pixel art for: "steel" as a ${size}x${size} ASCII grid.
Output strictly JSON with keys: width, height, palette, grid.
Example:
{
  "width": 8,
  "height": 8,
  "palette": [" ", ".", ":", "-", "+", "*", "#", "@"],
  "grid": [
    "--::..  ",
    "@@##++..",
    "##**++..",
    "+-::..  ",
    "+-::..  ",
    "##**++..",
    "@@##++..",
    "--::..  "
  ]
}`;
    // Instruction for target prompt
    const instruction = `You generate small pixel art as fixed-size ASCII grids.
- Only output a single JSON object with keys: width, height, palette, grid.
- width=${size}, height=${size}.
- palette: ordered light-to-dark characters that appear in grid only.
- grid: exactly ${size} strings of length ${size} each.
- No commentary, no backticks.`;
    return [instruction, fewShotSteel, `Task: ${req.prompt}`].join('\n\n');
}
