
// Runtime self-check for the split agent. This catches packaging/order/scope
// regressions immediately after the Frida script loads instead of waiting for
// the first game response to fail.
setImmediate(function () {
  const ready = typeof shouldCaptureCommand === 'function';
  try {
    log(ready ? 'info' : 'error', `Capture selector ready: ${ready ? 'yes' : 'no'}`, {
      selectorType: typeof shouldCaptureCommand
    });
  } catch (_) {
    send({
      kind: 'diagnostic',
      level: ready ? 'info' : 'error',
      message: `Capture selector ready: ${ready ? 'yes' : 'no'}`,
      extra: { selectorType: typeof shouldCaptureCommand }
    });
  }
});
