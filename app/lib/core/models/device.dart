// A device chip in the left rail. v1 only ever shows "This PC", but the type
// is a list-of-1 so adding macOS/Linux/Android later is free (per VISION.md
// in the OpenClaw vendor + design.md section 5).

enum DeviceConnection { online, offline, paired }

class Device {
  final String id;
  final String name;            // "This PC"
  final DeviceConnection state;
  final List<String> capabilities; // ["desktop", "files", "email"]

  const Device({
    required this.id,
    required this.name,
    required this.state,
    required this.capabilities,
  });
}
