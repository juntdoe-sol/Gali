/** Swing trails: the colour of the arc a pickaxe draws. Pure data, safe for the canvas. */
export interface Trail {
  id: string;
  name: string;
  /** a CSS colour, or 'rainbow' */
  color: string;
  /** fight points needed */
  need: number;
}
export const TRAILS: Trail[] = [
  { id: 'plain', name: 'Steel', color: '#9fd6ee', need: 0 },
  { id: 'gold', name: 'Gold', color: '#ffd84a', need: 10 },
  { id: 'ember', name: 'Ember', color: '#ff6a3d', need: 30 },
  { id: 'amethyst', name: 'Amethyst', color: '#b86bff', need: 60 },
  { id: 'rainbow', name: 'Rainbow', color: 'rainbow', need: 120 },
];
export const trailColor = (id: string | undefined) => TRAILS.find((t) => t.id === id)?.color ?? TRAILS[0].color;
