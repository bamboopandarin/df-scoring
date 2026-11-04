import worker from "../../static/_worker.js";

export function onRequest({ request, env, waitUntil }) {
  return worker.fetch(request, env, { waitUntil });
}
