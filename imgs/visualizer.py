# 1. PASTE THE SIMULATED 10x10 JSON OUTPUT FROM THE LLM HERE
import json
from PIL import Image, ImageDraw

# Paste the new "Brick" JSON data here
json_data = """
{
  "result_item_name": "Electric Coil",
  "result_item_description": "A tightly wound coil of copper wire, capable of storing and releasing electrical energy.",
  "result_item_pixel_art": {
    "colors": [
      "0x4A4A4A",
      "0x8B5A2B",
      "0xD98B3A",
      "0x694A2F"
    ],
    "drawing": [
      {"color": 3, "rect": [0, 0, 10, 10]},
      {"color": 2, "rect": [0, 0, 6, 10]},
      {"color": 2, "rect": [0, 2, 6, 2]},
      {"color": 2, "rect": [0, 4, 6, 2]},
      {"color": 2, "rect": [0, 6, 6, 2]},
      {"color": 2, "rect": [0, -2, 6, 2]},
      {"color": 2, "rect": [0, -4, 6, 2]},
      {"color": 1, "rect": [0, 8.5, 4, 1]},
      {"color": 0, "rect": [0, -1.5, 4, 3]}
    ]
  }
}
"""

# (The rest of the rendering script remains the same...)
# ...

# The script will now save a file named `brick_10x10.png`

# --- SCRIPT TO RENDER THE PIXEL ART ---

# Game world constants
CANVAS_SIZE = 10  # <-- THE ONLY CHANGE IS HERE!
SCALE = 50        # How large each "pixel" will be in the output image

# (The rest of the script is identical to the previous version)

data = json.loads(json_data)
art_data = data.get("pixelArt", {})
item_name = data.get("newItem", {}).get("name", "untitled")

img_size = CANVAS_SIZE * SCALE
image = Image.new("RGB", (img_size, img_size), "white")
draw = ImageDraw.Draw(image)

colors = art_data.get("colors", [])
drawing_instructions = art_data.get("drawing", [])

print(f"Rendering 10x10 item: {item_name}")

for instruction in drawing_instructions:
    color_index = instruction["color"]
    rect = instruction["rect"]
    hex_color = colors[color_index].replace("0x", "#")
    game_x, game_y, width, height = rect
    
    x1_game = game_x - width / 2
    y1_game = game_y + height / 2
    x2_game = game_x + width / 2
    y2_game = game_y - height / 2

    x1_grid = x1_game + CANVAS_SIZE / 2
    y1_grid = -y1_game + CANVAS_SIZE / 2
    x2_grid = x2_game + CANVAS_SIZE / 2
    y2_grid = -y2_game + CANVAS_SIZE / 2

    draw_x1 = x1_grid * SCALE
    draw_y1 = y1_grid * SCALE
    draw_x2 = x2_grid * SCALE
    draw_y2 = y2_grid * SCALE
    
    draw.rectangle([draw_x1, draw_y1, draw_x2, draw_y2], fill=hex_color)

output_filename = f"{item_name.lower().replace(' ', '_')}_10x10.png"
image.save(output_filename)

print(f"Successfully created image: {output_filename}")