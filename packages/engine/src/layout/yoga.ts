import { loadYoga as load, type Yoga } from 'yoga-layout/load';

let instance: Promise<Yoga> | null = null;

/** Yoga is a WebAssembly module; it is loaded once per realm and shared. */
export function loadYoga(): Promise<Yoga> {
  instance ??= load();
  return instance;
}
