#include "card_table.h"
#include <stdio.h>
/* Line protocol used by the browser/C parity test. */
int main(void) {
  ct_world w;
  ct_action a;
  ct_init(&w);
  while (scanf("%d %d %d %d", &a.kind, &a.actor, &a.item, &a.target) == 4) {
    printf("%d %d", ct_apply(&w, a), w.version);
    const int32_t *arrays[] = {w.claimed,w.present,w.places,w.holders,w.uses,w.homes,w.gates};
    for(int n=0;n<7;n++) for(int j=0;j<(n==6?9:8);j++) printf(" %d",arrays[n][j]);
    printf(" %u",w.turn);
    for(int actor=0;actor<8;actor++) for(int p=0;p<9;p++) printf(" %d",ct_can_visit(&w,actor,p));
    puts("");
  }
  return 0;
}
