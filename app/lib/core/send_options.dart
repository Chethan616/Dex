// Per-turn send options the composer sets before submitting and the
// GatewayClient reads when building the chat.send frame. The gateway's
// ChatSendParamsSchema natively supports `thinking` and `fastMode`
// (dex/core/packages/gateway-protocol/src/schema/logs-chat.ts:76-77),
// so the composer's mode pill maps straight onto real turn behavior:
//
//   Fast         -> fastMode: true, thinking: "off"   (instant replies)
//   Smart        -> defaults (gateway's adaptive thinking)
//   Think deeper -> thinking: "high"
//
// Plain mutable statics on purpose: one process, one composer surface
// active at a time, read exactly once per send.

class SendOptions {
  SendOptions._();

  static String? thinking;
  static bool? fastMode;

  static void clear() {
    thinking = null;
    fastMode = null;
  }
}
