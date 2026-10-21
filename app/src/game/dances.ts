/** Every dance, by number (the wire sends `dance<n>`). Pure, no imports: the canvas and the app share it. */
export const DANCES = ['DISCO', 'POGO', 'WIGGLE', 'FLOSS', 'GRIDDY', 'ROBOT', 'MOONWALK', 'SPIN', 'WORM', 'SPRINKLER', 'AURA FARM', 'SIX SEVEN'] as const;
export const DANCE_COUNT = DANCES.length;
export const isDance = (p: string) => /^dance([1-9]|1[0-2])$/.test(p);
