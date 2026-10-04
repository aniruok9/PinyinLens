// Wraps a worker's message handler: every message gets exactly one reply carrying its id, and a
// thrown error becomes { type: 'error', id, message } instead of an unhandled rejection.
export const withReplies = (handle) => async (message) => {
  try {
    return { id: message.id, ...(await handle(message)) };
  } catch (err) {
    return { type: 'error', id: message.id, message: err.message };
  }
};
