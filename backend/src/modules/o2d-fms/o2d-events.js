import { EventEmitter } from 'events';

/**
 * In-process signal: "an O2D order's flow changed". The Delegation task sync
 * (o2d-delegation.js) listens, so a step that just became due reaches the
 * Suite within seconds. Nothing depends on it for correctness — that sync also
 * runs every minute on its own.
 */
export const o2dEvents = new EventEmitter();

export const signalO2dChange = () => {
  o2dEvents.emit('changed');
};
