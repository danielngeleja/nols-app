/**
 * Express 4 does not forward rejected handler promises to error middleware.
 *
 * This process-wide bridge is intentionally installed before any route module is
 * imported. It preserves Express' normal synchronous behavior and adds the one
 * missing operation: if a handler or middleware returns a promise, forward a
 * rejection to `next(error)`.
 *
 * Keep this until Express 5 is adopted. Per-route wrappers remain valid, but
 * correctness no longer depends on every current and future handler remembering
 * to use one.
 */

type ExpressLayer = {
  handle: (...args: any[]) => unknown;
};

type LayerConstructor = {
  prototype: ExpressLayer & Record<PropertyKey, unknown>;
};

const Layer = require("express/lib/router/layer") as LayerConstructor;
const installed = Symbol.for("nolsaf.express.asyncRouteContainment");

if (!Layer.prototype[installed]) {
  const originalHandleRequest = (Layer.prototype as any).handle_request as (
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void,
  ) => void;

  (Layer.prototype as any).handle_request = function containedHandleRequest(
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void,
  ): void {
    const handler = this.handle;

    // Express error middleware is dispatched by handle_error, not here.
    if (handler.length > 3) {
      next();
      return;
    }

    try {
      const result = handler(request, response, next);
      if (
        result !== null
        && (typeof result === "object" || typeof result === "function")
        && typeof (result as PromiseLike<unknown>).then === "function"
      ) {
        Promise.resolve(result).catch(next);
      }
    } catch (error) {
      next(error);
    }
  };

  Object.defineProperty(Layer.prototype, installed, {
    value: { originalHandleRequest },
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export {};
