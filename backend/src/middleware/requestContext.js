import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The current request, reachable from deep inside a service without passing
 * `req` down. Used by the Recycle Bin to note who deleted something and from
 * which screen (the `x-client-page` header the ERP pages send on changes).
 */
const storage = new AsyncLocalStorage();

export const requestContext = (req, _res, next) => storage.run({ req }, next);

export const currentRequest = () => storage.getStore()?.req || null;
