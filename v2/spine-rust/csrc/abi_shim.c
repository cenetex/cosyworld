/* ABI drift guard: exports the C-side sizes and version so Rust tests can
 * assert the hand-mirrored layouts in kernel_ffi.rs have not drifted from
 * cosy_kernel.h. The header already static_asserts cw_item's layout; this
 * shim extends the same discipline across the FFI boundary. */
#include "cosy_kernel.h"

#include <stdint.h>

uint32_t cw_spine_kernel_version(void) { return CW_KERNEL_VERSION; }
size_t cw_spine_sizeof_world(void) { return sizeof(cw_world); }
size_t cw_spine_sizeof_action(void) { return sizeof(cw_action); }
size_t cw_spine_sizeof_event(void) { return sizeof(cw_event); }
size_t cw_spine_sizeof_event_buffer(void) { return sizeof(cw_event_buffer); }
size_t cw_spine_sizeof_actor(void) { return sizeof(cw_actor); }
size_t cw_spine_sizeof_item(void) { return sizeof(cw_item); }
size_t cw_spine_sizeof_location(void) { return sizeof(cw_location); }
size_t cw_spine_sizeof_exit(void) { return sizeof(cw_exit); }
size_t cw_spine_sizeof_gate(void) { return sizeof(cw_gate); }
size_t cw_spine_sizeof_evolution_track(void) { return sizeof(cw_evolution_track); }
size_t cw_spine_sizeof_combat_encounter(void) { return sizeof(cw_combat_encounter); }
