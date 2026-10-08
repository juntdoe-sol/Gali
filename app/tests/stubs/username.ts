import { create } from 'zustand';
export const useName = create<{ name: string }>(() => ({ name: (globalThis as any).__name }));
