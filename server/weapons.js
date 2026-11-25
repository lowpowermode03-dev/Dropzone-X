// Weapon definitions shared by server logic (client mirrors these)
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const RARITY_COLORS = ['#b1b1b1', '#60aa3c', '#4d8fd1', '#b04dd1', '#e8a33d'];
const RARITY_MULT = [1, 1.08, 1.17, 1.27, 1.38];

const WEAPONS = {
  pickaxe: { id: 'pickaxe', name: 'Harvesting Tool', type: 'melee', damage: 20, range: 4, fireRate: 350, mag: Infinity, reload: 0, spread: 0, pellets: 1, auto: false, rarity: 0 },
  pistol: { id: 'pistol', name: 'Pistol', type: 'hitscan', damage: 23, range: 120, fireRate: 220, mag: 12, reload: 1100, spread: 0.02, pellets: 1, auto: false },
  smg: { id: 'smg', name: 'Submachine Gun', type: 'hitscan', damage: 17, range: 110, fireRate: 90, mag: 30, reload: 1500, spread: 0.045, pellets: 1, auto: true },
  ar: { id: 'ar', name: 'Assault Rifle', type: 'hitscan', damage: 30, range: 200, fireRate: 140, mag: 30, reload: 1800, spread: 0.03, pellets: 1, auto: true },
  shotgun: { id: 'shotgun', name: 'Shotgun', type: 'hitscan', damage: 11, range: 45, fireRate: 850, mag: 5, reload: 2400, spread: 0.09, pellets: 8, auto: false },
  sniper: { id: 'sniper', name: 'Sniper Rifle', type: 'hitscan', damage: 105, range: 400, fireRate: 1400, mag: 1, reload: 2600, spread: 0.002, pellets: 1, auto: false },
  lmg: { id: 'lmg', name: 'Light Machine Gun', type: 'hitscan', damage: 26, range: 180, fireRate: 120, mag: 75, reload: 3200, spread: 0.05, pellets: 1, auto: true },
  burst: { id: 'burst', name: 'Burst Assault Rifle', type: 'hitscan', damage: 27, range: 210, fireRate: 230, mag: 30, reload: 1900, spread: 0.022, pellets: 1, auto: true },
  revolver: { id: 'revolver', name: 'Hand Cannon', type: 'hitscan', damage: 52, range: 150, fireRate: 520, mag: 6, reload: 1700, spread: 0.012, pellets: 1, auto: false },
  pump: { id: 'pump', name: 'Pump Shotgun', type: 'hitscan', damage: 12, range: 42, fireRate: 980, mag: 6, reload: 2600, spread: 0.1, pellets: 7, auto: false },
  dmr: { id: 'dmr', name: 'Marksman Rifle', type: 'hitscan', damage: 58, range: 330, fireRate: 470, mag: 10, reload: 2200, spread: 0.004, pellets: 1, auto: false },
};

const GUN_IDS = ['pistol', 'smg', 'ar', 'shotgun', 'sniper', 'lmg', 'burst', 'revolver', 'pump', 'dmr'];

const ITEMS = {
  shield_small: { id: 'shield_small', name: 'Small Shield Potion', type: 'shield', amount: 25, useTime: 2000 },
  shield_big: { id: 'shield_big', name: 'Shield Potion', type: 'shield', amount: 50, useTime: 4000 },
  medkit: { id: 'medkit', name: 'Med Kit', type: 'heal', amount: 100, useTime: 5000 },
  bandage: { id: 'bandage', name: 'Bandage', type: 'heal', amount: 15, useTime: 1500 },
  ammo_light: { id: 'ammo_light', name: 'Light Ammo', type: 'ammo', amount: 30 },
  ammo_medium: { id: 'ammo_medium', name: 'Medium Ammo', type: 'ammo', amount: 30 },
  ammo_heavy: { id: 'ammo_heavy', name: 'Heavy Ammo', type: 'ammo', amount: 10 },
  ammo_shells: { id: 'ammo_shells', name: 'Shells', type: 'ammo', amount: 8 },
  wood: { id: 'wood', name: 'Wood', type: 'mat', amount: 30 },
  stone: { id: 'stone', name: 'Stone', type: 'mat', amount: 30 },
  metal: { id: 'metal', name: 'Metal', type: 'mat', amount: 30 },
};

function rollWeapon(rng) {
  const id = GUN_IDS[Math.floor(rng() * GUN_IDS.length)];
  // rarity weighted: common most likely
  const r = rng();
  let rarity = 0;
  if (r > 0.97) rarity = 4;
  else if (r > 0.90) rarity = 3;
  else if (r > 0.75) rarity = 2;
  else if (r > 0.5) rarity = 1;
  return { kind: 'weapon', weaponId: id, rarity };
}

function rollLoot(rng) {
  const r = rng();
  if (r < 0.45) return rollWeapon(rng);
  if (r < 0.60) return { kind: 'item', itemId: ['shield_small', 'shield_big', 'medkit', 'bandage'][Math.floor(rng() * 4)] };
  if (r < 0.75) return { kind: 'item', itemId: ['ammo_light', 'ammo_medium', 'ammo_heavy', 'ammo_shells'][Math.floor(rng() * 4)] };
  return { kind: 'item', itemId: ['wood', 'stone', 'metal'][Math.floor(rng() * 3)] };
}

module.exports = { WEAPONS, GUN_IDS, ITEMS, RARITIES, RARITY_COLORS, RARITY_MULT, rollLoot };
