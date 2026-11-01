#ifndef CW_CARD_TABLE_H
#define CW_CARD_TABLE_H
#include <stdint.h>
/* Versioned, bounded rules for shared card tables. Entity names live in data.
 * Holder 0..7 is an avatar, 8..16 is a place, -1 is an unintroduced item. */
#define CT_AVATARS 8
#define CT_PLACES 9
#define CT_ROOM_LIMIT 4
typedef struct {
  int32_t version;
  int32_t claimed[CT_AVATARS];
  int32_t present[CT_AVATARS];
  int32_t places[CT_AVATARS];
  int32_t holders[CT_AVATARS];
  int32_t uses[CT_AVATARS];
  int32_t homes[CT_AVATARS];
  int32_t gates[CT_PLACES];
  uint32_t turn;
} ct_world;
typedef struct { int32_t kind, actor, item, target; } ct_action;
enum { CT_CLAIM=1, CT_RELEASE, CT_ENTER, CT_LEAVE, CT_TRAVEL,
       CT_TAKE, CT_DROP, CT_GIVE, CT_USE, CT_TALK, CT_WAIT };
enum { CT_OK=0, CT_INVALID, CT_CLAIMED, CT_ABSENT, CT_FULL,
       CT_ROUTE, CT_CUSTODY, CT_TARGET };
void ct_init(ct_world *world);
int32_t ct_apply(ct_world *world, ct_action action);
int32_t ct_can_visit(const ct_world *world, int32_t actor, int32_t place);
int32_t ct_item_place(const ct_world *world, int32_t item);

/* Full card-world session admission. The authored rules execute inside the
 * bounded QuickJS C interpreter; this guard owns claim/presence/capacity rules.
 * Room strings are authored IDs, independent of the legacy nine-room table. */
#define CT_ROOM_ID_BYTES 128
#define CT_SHARED_TEXT 12
#define CT_SHARED_RESET 13
typedef struct {
  int32_t claimed[CT_AVATARS];
  int32_t present[CT_AVATARS];
  char rooms[CT_AVATARS][CT_ROOM_ID_BYTES];
} ct_shared_session;
int32_t ct_shared_guard(const ct_shared_session *before,
                        const ct_shared_session *after,
                        int32_t kind, int32_t actor);
#endif
