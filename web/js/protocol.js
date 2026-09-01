/**
 * The mesh wire protocol, mirrored from channels/mesh/protocol.ts.
 *
 * Keep the two in step by hand — there is no build step here on purpose. The
 * `type` strings on host events are the Dex core's own event names, so an
 * event is rendered without being translated.
 */
(function (global) {
  'use strict';

  /** Bytes per file chunk before base64 — must equal FILE_CHUNK_BYTES on the PC. */
  const FILE_CHUNK_BYTES = 48 * 1024;

  /** Host event types we give a distinct visual treatment. The rest render plain. */
  const EVENT_TYPES = [
    'thinking', 'routing', 'planning', 'selecting', 'dispatching',
    'executing', 'retrying', 'awaiting', 'done', 'failed', 'cancelled',
  ];

  function helloFrame(meshId, role) {
    return { t: 'hello', meshId: meshId, role: role };
  }

  function promptFrame(text) {
    return { t: 'prompt', id: rid(), text: String(text) };
  }

  function approveFrame(requestId, stepId, stepVersion, verdict) {
    return {
      t: 'approve',
      requestId: requestId,
      stepId: stepId,
      stepVersion: stepVersion, // echoed EXACTLY as received — a hash of the step
      verdict: verdict,
    };
  }

  function handoffFrame(requestId, stepId, stepVersion, done) {
    return { t: 'handoff', requestId: requestId, stepId: stepId, stepVersion: stepVersion, done: !!done };
  }

  function cancelFrame(requestId) {
    return { t: 'cancel', requestId: requestId };
  }

  function rid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  global.MeshProtocol = {
    FILE_CHUNK_BYTES: FILE_CHUNK_BYTES,
    EVENT_TYPES: EVENT_TYPES,
    helloFrame: helloFrame,
    promptFrame: promptFrame,
    approveFrame: approveFrame,
    handoffFrame: handoffFrame,
    cancelFrame: cancelFrame,
    rid: rid,
  };
})(self);
