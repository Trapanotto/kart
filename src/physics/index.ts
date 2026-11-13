// Physics module entry. Owner: physics.
export { createPhysics, createPhysicsSync, activePhysics } from './system';
export type { KartPhysicsSystem, PhysicsQueries } from './system';
export { PhysKart } from './kart';
export { PHYS, kartStats } from './tuning';
export { loadRapier } from './rapier';
export { createLineDriver } from './driver';
