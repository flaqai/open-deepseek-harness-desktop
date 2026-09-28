/** ABI-stable Node-API bridge for the AX-only macOS selection monitor. */

#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef void (*dsh_orb_selection_emit)(const char *line, void *context);

extern int32_t dsh_orb_selection_start(dsh_orb_selection_emit emit, void *context);
extern void dsh_orb_selection_stop(void);
extern void dsh_orb_selection_exclude_pids(const char *pids);

static napi_threadsafe_function selection_tsfn;

static void deliver_line(napi_env env, napi_value callback, void *context, void *data) {
  (void)context;
  char *line = data;
  if (env != NULL && callback != NULL) {
    napi_value value;
    napi_value receiver;
    napi_value result;
    if (napi_create_string_utf8(env, line, NAPI_AUTO_LENGTH, &value) == napi_ok
        && napi_get_undefined(env, &receiver) == napi_ok) {
      napi_call_function(env, receiver, callback, 1, &value, &result);
    }
  }
  free(line);
}

static void emit_line(const char *line, void *context) {
  (void)context;
  if (selection_tsfn == NULL || line == NULL) return;
  const size_t length = strnlen(line, 131073);
  if (length == 0 || length > 131072) return;
  char *copy = malloc(length + 1);
  if (copy == NULL) return;
  memcpy(copy, line, length + 1);
  if (napi_call_threadsafe_function(selection_tsfn, copy, napi_tsfn_nonblocking) != napi_ok) {
    free(copy);
  }
}

static void release_callback(void) {
  if (selection_tsfn == NULL) return;
  napi_release_threadsafe_function(selection_tsfn, napi_tsfn_release);
  selection_tsfn = NULL;
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 1
      || napi_typeof(env, args[0], &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, NULL, "orb selection start expects one callback");
    return NULL;
  }
  dsh_orb_selection_stop();
  release_callback();
  napi_value name;
  if (napi_create_string_utf8(env, "dsh-orb-selection", NAPI_AUTO_LENGTH, &name) != napi_ok
      || napi_create_threadsafe_function(env, args[0], NULL, name, 16, 1, NULL, NULL,
          NULL, deliver_line, &selection_tsfn) != napi_ok) {
    napi_throw_error(env, NULL, "orb selection callback could not be registered");
    return NULL;
  }
  if (dsh_orb_selection_start(emit_line, NULL) != 0) {
    release_callback();
    napi_throw_error(env, NULL, "orb selection monitor could not start");
    return NULL;
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value stop(napi_env env, napi_callback_info info) {
  (void)info;
  dsh_orb_selection_stop();
  release_callback();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value exclude_pids(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  size_t length = 0;
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 1
      || napi_get_value_string_utf8(env, args[0], NULL, 0, &length) != napi_ok
      || length > 4096) {
    napi_throw_type_error(env, NULL, "orb selection excludePids expects a short string");
    return NULL;
  }
  char *pids = malloc(length + 1);
  if (pids == NULL) {
    napi_throw_error(env, NULL, "orb selection excludePids allocation failed");
    return NULL;
  }
  if (napi_get_value_string_utf8(env, args[0], pids, length + 1, &length) != napi_ok) {
    free(pids);
    napi_throw_type_error(env, NULL, "orb selection excludePids expects a string");
    return NULL;
  }
  dsh_orb_selection_exclude_pids(pids);
  free(pids);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value start_fn;
  napi_value stop_fn;
  napi_value exclude_fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &start_fn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, stop, NULL, &stop_fn);
  napi_create_function(env, "excludePids", NAPI_AUTO_LENGTH, exclude_pids, NULL, &exclude_fn);
  napi_set_named_property(env, exports, "start", start_fn);
  napi_set_named_property(env, exports, "stop", stop_fn);
  napi_set_named_property(env, exports, "excludePids", exclude_fn);
  return exports;
}
