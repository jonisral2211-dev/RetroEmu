#import "JLAchievements.h"

#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "LibretroHost.hpp"
#include "libretro.h"

extern "C" {
#include "rc_hash.h"
#include "rc_libretro.h"
#include "rc_runtime.h"
}

namespace {

struct Pending {
  uint32_t id;
  std::string memaddr;
};

struct Event {
  uint32_t id;
  bool unlock;
  unsigned value;
  unsigned target;
};

std::mutex g_mutex;  // protege todo lo de abajo (hilo de emulación frente a JS)
rc_runtime_t g_runtime;
bool g_runtimeReady = false;
rc_libretro_memory_regions_t g_regions;
bool g_regionsReady = false;
uint32_t g_console = 0;
std::vector<Pending> g_pending;
bool g_hasPending = false;
std::vector<uint32_t> g_triggered;  // se desactivan tras rc_runtime_do_frame
std::vector<Event> g_events;
std::string g_hashError;

void RC_CCONV coreMemoryInfo(uint32_t id, rc_libretro_core_memory_info_t *info) {
  info->data = host::memoryData(id);
  info->size = host::memorySize(id);
}

uint32_t RC_CCONV peek(uint32_t address, uint32_t numBytes, void *) {
  uint8_t b[4] = {0, 0, 0, 0};
  if (numBytes == 0 || numBytes > 4) return 0;
  if (rc_libretro_memory_read(&g_regions, address, b, numBytes) < numBytes) return 0;
  uint32_t v = 0;
  for (uint32_t i = 0; i < numBytes; ++i) v |= uint32_t(b[i]) << (8 * i);
  return v;
}

void RC_CCONV onEvent(const rc_runtime_event_t *e) {
  if (e->type == RC_RUNTIME_EVENT_ACHIEVEMENT_TRIGGERED) {
    g_triggered.push_back(e->id);
    g_events.push_back({e->id, true, 0, 0});
  } else if (e->type == RC_RUNTIME_EVENT_ACHIEVEMENT_PROGRESS_UPDATED) {
    unsigned value = 0, target = 0;
    if (rc_runtime_get_achievement_measured(&g_runtime, e->id, &value, &target) && target > 0) {
      g_events.push_back({e->id, false, value, target});
    }
  }
}

void destroyLocked() {
  if (g_runtimeReady) rc_runtime_destroy(&g_runtime);
  if (g_regionsReady) rc_libretro_memory_destroy(&g_regions);
  g_runtimeReady = false;
  g_regionsReady = false;
  g_triggered.clear();
}

// Hilo de emulación, con el núcleo bloqueado: aquí la memoria del núcleo es estable
void frameHook() {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_hasPending) {
    g_hasPending = false;
    destroyLocked();
    std::memset(&g_regions, 0, sizeof(g_regions));
    if (!rc_libretro_memory_init(&g_regions, host::memoryMap(), coreMemoryInfo, g_console)) return;
    g_regionsReady = true;
    rc_runtime_init(&g_runtime);
    g_runtimeReady = true;
    for (const auto &p : g_pending) {
      rc_runtime_activate_achievement(&g_runtime, p.id, p.memaddr.c_str(), nullptr, 0);
    }
    g_pending.clear();
  }
  if (!g_runtimeReady || !g_regionsReady) return;
  rc_runtime_do_frame(&g_runtime, onEvent, peek, nullptr, nullptr);
  for (uint32_t id : g_triggered) rc_runtime_deactivate_achievement(&g_runtime, id);
  g_triggered.clear();
}

void RC_CCONV hashError(const char *message) { g_hashError = message ? message : ""; }

}  // namespace

@implementation JLAchievements

+ (NSString *)hashForPath:(NSString *)path console:(int)consoleId error:(NSString **)error {
  static std::mutex hashMutex;  // rc_hash usa estado global (lector de CD, mensajes)
  std::lock_guard<std::mutex> lock(hashMutex);
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    rc_hash_init_default_cdreader();
    rc_hash_init_error_message_callback(hashError);
  });
  g_hashError.clear();
  char hash[33] = {0};
  if (!rc_hash_generate_from_file(hash, uint32_t(consoleId), path.fileSystemRepresentation)) {
    if (error) *error = [NSString stringWithUTF8String:g_hashError.empty() ? "No se pudo calcular el hash" : g_hashError.c_str()];
    return @"";
  }
  return [NSString stringWithUTF8String:hash];
}

+ (BOOL)activate:(NSArray<NSDictionary *> *)achievements console:(int)consoleId {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_pending.clear();
    for (NSDictionary *a in achievements) {
      NSNumber *ident = a[@"id"];
      NSString *memaddr = a[@"memaddr"];
      if (![ident isKindOfClass:NSNumber.class] || ![memaddr isKindOfClass:NSString.class] || memaddr.length == 0) continue;
      g_pending.push_back({ident.unsignedIntValue, memaddr.UTF8String});
    }
    g_console = uint32_t(consoleId);
    g_hasPending = true;
    g_events.clear();
  }
  host::setFrameHook(frameHook);
  return YES;
}

+ (void)reset {
  host::setFrameHook(nullptr);
  std::lock_guard<std::mutex> lock(g_mutex);
  destroyLocked();
  g_pending.clear();
  g_hasPending = false;
  g_events.clear();
}

+ (NSString *)poll {
  std::vector<Event> events;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    events.swap(g_events);
  }
  NSMutableArray *out = [NSMutableArray arrayWithCapacity:events.size()];
  for (const auto &e : events) {
    [out addObject:@{
      @"id" : @(e.id),
      @"type" : e.unlock ? @"unlock" : @"progress",
      @"value" : @(e.value),
      @"target" : @(e.target),
    }];
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"[]";
}

@end
