import * as fs from 'fs';
import * as path from 'path';
import type { Item, Recipe, ItemCategory } from 'shared/types';

class ItemDatabase {
  private items: Map<string, Item> = new Map();
  private recipes: Map<string, Recipe> = new Map();
  private dataPath: string;

  constructor(dataPath: string) {
    this.dataPath = dataPath;
    this.loadDatabase();
  }

  private loadDatabase() {
    // Load items from all category files
    const categories: ItemCategory[] = ['terrain', 'transport', 'construction', 'food', 'weapon', 'tool', 'fauna'];
    
    for (const category of categories) {
      const filePath = path.join(this.dataPath, `${category}.json`);
      try {
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          for (const [id, item] of Object.entries(data)) {
            this.items.set(id, item as Item);
          }
        }
      } catch (error) {
        console.error(`Failed to load ${category} items:`, error);
      }
    }

    // Load recipes
    const recipesPath = path.join(this.dataPath, 'recipes.json');
    try {
      if (fs.existsSync(recipesPath)) {
        const data = JSON.parse(fs.readFileSync(recipesPath, 'utf-8'));
        for (const [id, recipe] of Object.entries(data)) {
          this.recipes.set(id, recipe as Recipe);
        }
      }
    } catch (error) {
      console.error('Failed to load recipes:', error);
    }

    console.log(`Loaded ${this.items.size} items and ${this.recipes.size} recipes`);
  }

  // Get all items as a record for client sync
  getAllItems(): Record<string, Item> {
    const result: Record<string, Item> = {};
    for (const [id, item] of this.items.entries()) {
      result[id] = item;
    }
    return result;
  }

  // Get item by ID
  getItem(id: string): Item | undefined {
    return this.items.get(id);
  }

  // Get all recipes
  getAllRecipes(): Record<string, Recipe> {
    const result: Record<string, Recipe> = {};
    for (const [id, recipe] of this.recipes.entries()) {
      result[id] = recipe;
    }
    return result;
  }

  // Find recipe by inputs
  findRecipeByInputs(inputs: { item_id: string; quantity: number }[]): Recipe | null {
    // Create a normalized key from inputs
    const inputKey = inputs
      .map(input => `${input.item_id}:${input.quantity}`)
      .sort()
      .join('+');

    for (const recipe of this.recipes.values()) {
      const recipeKey = recipe.inputs
        .map(input => `${input.item_id}:${input.quantity}`)
        .sort()
        .join('+');
      
      if (inputKey === recipeKey) {
        return recipe;
      }
    }
    
    return null;
  }

  // Add new item dynamically (for future AI generation)
  addItem(item: Item, saveToFile = true): void {
    this.items.set(item.id, item);
    
    if (saveToFile) {
      this.saveItemToFile(item);
    }
  }

  // Add new recipe dynamically
  addRecipe(recipe: Recipe, saveToFile = true): void {
    this.recipes.set(recipe.id, recipe);
    
    if (saveToFile) {
      this.saveRecipeToFile(recipe);
    }
  }

  private saveItemToFile(item: Item): void {
    const filePath = path.join(this.dataPath, `${item.category}.json`);
    try {
      let data: Record<string, Item> = {};
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
      data[item.id] = item;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Failed to save item ${item.id}:`, error);
    }
  }

  private saveRecipeToFile(recipe: Recipe): void {
    const filePath = path.join(this.dataPath, 'recipes.json');
    try {
      let data: Record<string, Recipe> = {};
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
      data[recipe.id] = recipe;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Failed to save recipe ${recipe.id}:`, error);
    }
  }

  // Validate if inputs exist and have sufficient quantities
  validateCraftingInputs(inputs: { item_id: string; quantity: number }[]): boolean {
    for (const input of inputs) {
      const item = this.getItem(input.item_id);
      if (!item) {
        console.log(`Item ${input.item_id} not found in database`);
        return false;
      }
      if (input.quantity <= 0) {
        console.log(`Invalid quantity ${input.quantity} for item ${input.item_id}`);
        return false;
      }
    }
    return true;
  }
}

// Singleton instance
let dbInstance: ItemDatabase | null = null;

export function initializeDatabase(dataPath: string): ItemDatabase {
  if (!dbInstance) {
    dbInstance = new ItemDatabase(dataPath);
  }
  return dbInstance;
}

export function getDatabase(): ItemDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return dbInstance;
}

export { ItemDatabase };
