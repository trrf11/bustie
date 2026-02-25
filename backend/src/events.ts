import { EventEmitter } from 'events';

export const vehicleEventBus = new EventEmitter();
vehicleEventBus.setMaxListeners(100);
