#include "card_table.h"
#include <string.h>
static int avatar(int n) { return n >= 0 && n < CT_AVATARS; }
static int place(int n) { return n >= 0 && n < CT_PLACES; }
static int count(const ct_world *w, int p) {
  int n=0;
  for(int i=0;i<CT_AVATARS;i++) n += w->present[i] && w->places[i]==p;
  return n;
}
void ct_init(ct_world *w) {
  memset(w, 0, sizeof(*w)); w->version=1; w->gates[0]=-1;
  for(int i=0;i<CT_AVATARS;i++) {
    w->places[i]=i+1; w->homes[i]=i+1; w->holders[i]=-1; w->gates[i+1]=i;
  }
}
int32_t ct_item_place(const ct_world *w,int32_t item) {
  if(!avatar(item)) return -1;
  int h=w->holders[item];
  if(avatar(h)) return w->present[h] ? w->places[h] : -1;
  return place(h-CT_AVATARS) ? h-CT_AVATARS : -1;
}
int32_t ct_can_visit(const ct_world *w,int32_t a,int32_t p) {
  if(!avatar(a)||!place(p)||!w->present[a]||w->places[a]==p) return 0;
  if(count(w,p)>=CT_ROOM_LIMIT) return 0;
  if(p==0) return 1;
  return w->places[a]==0 && ct_item_place(w,w->gates[p])==0;
}
int32_t ct_apply(ct_world *w,ct_action c) {
  int a=c.actor, t=c.target, i=c.item;
  if(w->version!=1||!avatar(a)) return CT_INVALID;
  if(c.kind==CT_CLAIM) {
    if(w->claimed[a]) return CT_CLAIMED;
    w->claimed[a]=1;
    if(w->holders[a]==-1) w->holders[a]=a;
    return CT_OK;
  }
  if(!w->claimed[a]) return CT_ABSENT;
  if(c.kind==CT_LEAVE) { w->present[a]=0; return CT_OK; }
  if(c.kind==CT_RELEASE) {
    for(int n=0;n<CT_AVATARS;n++) if(w->holders[n]==a) w->holders[n]=CT_AVATARS+w->places[a];
    w->claimed[a]=0; w->present[a]=0; return CT_OK;
  }
  if(c.kind==CT_ENTER) {
    if(w->present[a]) return CT_OK;
    if(count(w,w->places[a])>=CT_ROOM_LIMIT) return CT_FULL;
    w->present[a]=1; return CT_OK;
  }
  if(!w->present[a]) return CT_ABSENT;
  switch(c.kind) {
    case CT_TRAVEL:
      if(!place(t)) return CT_INVALID;
      if(count(w,t)>=CT_ROOM_LIMIT) return CT_FULL;
      if(!ct_can_visit(w,a,t)) return CT_ROUTE;
      w->places[a]=t; break;
    case CT_TAKE:
      if(!avatar(i)||w->holders[i]!=CT_AVATARS+w->places[a]) return CT_CUSTODY;
      w->holders[i]=a; break;
    case CT_DROP:
      if(!avatar(i)||w->holders[i]!=a) return CT_CUSTODY;
      w->holders[i]=CT_AVATARS+w->places[a]; break;
    case CT_GIVE:
      if(!avatar(i)||w->holders[i]!=a) return CT_CUSTODY;
      if(!avatar(t)||t==a||!w->present[t]||w->places[t]!=w->places[a]) return CT_TARGET;
      w->holders[i]=t; break;
    case CT_USE:
      if(!avatar(i)||(w->holders[i]!=a&&w->holders[i]!=CT_AVATARS+w->places[a])) return CT_CUSTODY;
      if(w->uses[i]<INT32_MAX) w->uses[i]++;
      break;
    case CT_TALK:
      if(!avatar(t)||t==a||!w->present[t]||w->places[t]!=w->places[a]) return CT_TARGET;
      break;
    case CT_WAIT: break;
    default: return CT_INVALID;
  }
  w->turn++; return CT_OK;
}
