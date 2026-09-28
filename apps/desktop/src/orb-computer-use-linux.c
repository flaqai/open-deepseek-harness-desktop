#define _POSIX_C_SOURCE 200809L
#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <png.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_EDGE 4096
#define MAX_PIXELS 16777216U
#define MAX_PNG (32U * 1024U * 1024U)
#define MAX_TEXT 32768U

typedef struct {
  Window id;
  int x, y, width, height;
} Target;

typedef struct {
  unsigned char *data;
  size_t size, capacity;
} Bytes;

typedef struct {
  KeyCode code;
  bool shift;
} Key;

static void fail(const char *reason) {
  fprintf(stderr, "orb computer use: %s\n", reason);
  exit(1);
}

static void json_string(const unsigned char *value, size_t length) {
  putchar('"');
  for (size_t i = 0; i < length; i++) {
    unsigned char c = value[i];
    if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
    else if (c < 0x20) printf("\\u%04x", c);
    else putchar(c);
  }
  putchar('"');
}

static bool property_window(Display *display, Window root, Atom property, Window *value) {
  Atom type = None;
  int format = 0;
  unsigned long count = 0, remaining = 0;
  unsigned char *data = NULL;
  int status = XGetWindowProperty(display, root, property, 0, 1, False, XA_WINDOW,
    &type, &format, &count, &remaining, &data);
  bool valid = status == Success && type == XA_WINDOW && format == 32 && count == 1 && data != NULL;
  if (valid) *value = *(Window *)data;
  if (data != NULL) XFree(data);
  return valid && *value != None;
}

static bool focus_descends_from(Display *display, Window focused, Window target) {
  if (focused == None || focused == PointerRoot) return false;
  for (int depth = 0; depth < 64; depth++) {
    if (focused == target) return true;
    Window root, parent, *children = NULL;
    unsigned int count = 0;
    if (!XQueryTree(display, focused, &root, &parent, &children, &count)) return false;
    if (children != NULL) XFree(children);
    if (parent == None || parent == focused) return false;
    focused = parent;
  }
  return false;
}

static Target foreground(Display *display) {
  Window active = None, focused = None;
  int revert = 0;
  Window root = DefaultRootWindow(display);
  Atom atom = XInternAtom(display, "_NET_ACTIVE_WINDOW", True);
  if (atom == None || !property_window(display, root, atom, &active)) fail("no EWMH active window");
  XGetInputFocus(display, &focused, &revert);
  if (!focus_descends_from(display, focused, active)) fail("active window and keyboard focus disagree");
  XWindowAttributes attributes;
  if (!XGetWindowAttributes(display, active, &attributes) || attributes.map_state != IsViewable)
    fail("no viewable foreground window");
  if (attributes.width < 2 || attributes.height < 2 || attributes.width > MAX_EDGE
    || attributes.height > MAX_EDGE || (uint64_t)attributes.width * attributes.height > MAX_PIXELS)
    fail("foreground window exceeds supported size");
  int x = 0, y = 0;
  Window child = None;
  if (!XTranslateCoordinates(display, active, root, 0, 0, &x, &y, &child))
    fail("could not locate foreground window");
  int screen_width = DisplayWidth(display, DefaultScreen(display));
  int screen_height = DisplayHeight(display, DefaultScreen(display));
  if (x < 0 || y < 0 || x + attributes.width > screen_width || y + attributes.height > screen_height)
    fail("foreground window is partly outside the display");
  return (Target){ active, x, y, attributes.width, attributes.height };
}

static void target_token(Target target, char output[80]) {
  snprintf(output, 80, "%lu:%d:%d:%d:%d", target.id, target.x, target.y, target.width, target.height);
}

static Target required_target(Display *display, const char *expected) {
  Target target = foreground(display);
  if (expected != NULL) {
    char actual[80];
    target_token(target, actual);
    if (strcmp(actual, expected) != 0) fail("frontmost window changed; observe again before input");
  }
  return target;
}

static void png_write(png_structp png, png_bytep data, png_size_t length) {
  Bytes *bytes = png_get_io_ptr(png);
  if (length > MAX_PNG - bytes->size) png_error(png, "image exceeds supported size");
  size_t next = bytes->size + length;
  if (next > bytes->capacity) {
    size_t capacity = bytes->capacity == 0 ? 4096 : bytes->capacity;
    while (capacity < next) capacity *= 2;
    if (capacity > MAX_PNG) capacity = MAX_PNG;
    unsigned char *grown = realloc(bytes->data, capacity);
    if (grown == NULL) png_error(png, "out of memory");
    bytes->data = grown;
    bytes->capacity = capacity;
  }
  memcpy(bytes->data + bytes->size, data, length);
  bytes->size = next;
}

static void png_flush(png_structp png) { (void)png; }

static Bytes capture_png(Display *display, Target target) {
  XImage *image = XGetImage(display, target.id, 0, 0, (unsigned int)target.width,
    (unsigned int)target.height, AllPlanes, ZPixmap);
  if (image == NULL) fail("could not capture foreground window");
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
  if (png == NULL) fail("could not initialize PNG encoder");
  png_infop info = png_create_info_struct(png);
  if (info == NULL) fail("could not initialize PNG metadata");
  Bytes output = {0};
  if (setjmp(png_jmpbuf(png))) fail("could not encode bounded PNG screenshot");
  png_set_write_fn(png, &output, png_write, png_flush);
  png_set_IHDR(png, info, (png_uint_32)target.width, (png_uint_32)target.height,
    8, PNG_COLOR_TYPE_RGB, PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT,
    PNG_FILTER_TYPE_DEFAULT);
  png_write_info(png, info);
  png_bytep row = malloc((size_t)target.width * 3);
  if (row == NULL) fail("out of memory");
  for (int y = 0; y < target.height; y++) {
    for (int x = 0; x < target.width; x++) {
      unsigned long pixel = XGetPixel(image, x, y);
      unsigned long masks[3] = { image->red_mask, image->green_mask, image->blue_mask };
      for (int channel = 0; channel < 3; channel++) {
        unsigned long mask = masks[channel];
        if (mask == 0) { row[x * 3 + channel] = 0; continue; }
        unsigned int shift = 0;
        while (((mask >> shift) & 1UL) == 0) shift++;
        unsigned long component = (pixel & mask) >> shift;
        unsigned long maximum = mask >> shift;
        row[x * 3 + channel] = (png_byte)((component * 255UL + maximum / 2UL) / maximum);
      }
    }
    png_write_row(png, row);
  }
  png_write_end(png, NULL);
  free(row);
  png_destroy_write_struct(&png, &info);
  XDestroyImage(image);
  return output;
}

static void base64_print(const unsigned char *data, size_t length) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (size_t i = 0; i < length; i += 3) {
    uint32_t bits = (uint32_t)data[i] << 16;
    if (i + 1 < length) bits |= (uint32_t)data[i + 1] << 8;
    if (i + 2 < length) bits |= data[i + 2];
    putchar(alphabet[(bits >> 18) & 63]);
    putchar(alphabet[(bits >> 12) & 63]);
    putchar(i + 1 < length ? alphabet[(bits >> 6) & 63] : '=');
    putchar(i + 2 < length ? alphabet[bits & 63] : '=');
  }
}

static unsigned char *base64_decode(const char *source, size_t *length) {
  size_t count = strlen(source);
  if (count == 0 || count % 4 != 0 || count > ((MAX_TEXT + 2U) / 3U) * 4U) fail("invalid text input");
  unsigned char *output = malloc(count / 4 * 3 + 1);
  if (output == NULL) fail("out of memory");
  size_t at = 0;
  for (size_t i = 0; i < count; i += 4) {
    uint32_t bits = 0;
    int padding = 0;
    for (size_t j = 0; j < 4; j++) {
      char c = source[i + j];
      int digit;
      if (c >= 'A' && c <= 'Z') digit = c - 'A';
      else if (c >= 'a' && c <= 'z') digit = c - 'a' + 26;
      else if (c >= '0' && c <= '9') digit = c - '0' + 52;
      else if (c == '+') digit = 62;
      else if (c == '/') digit = 63;
      else if (c == '=' && i + 4 == count && j >= 2) { digit = 0; padding++; }
      else fail("invalid text input");
      if (padding != 0 && c != '=') fail("invalid text input");
      bits = (bits << 6) | (uint32_t)digit;
    }
    if ((padding == 1 && (bits & 0xffU) != 0) || (padding == 2 && (bits & 0xffffU) != 0))
      fail("invalid text input");
    output[at++] = (unsigned char)(bits >> 16);
    if (padding < 2) output[at++] = (unsigned char)(bits >> 8);
    if (padding == 0) output[at++] = (unsigned char)bits;
  }
  if (at == 0 || at > MAX_TEXT) fail("invalid text input");
  output[at] = 0;
  *length = at;
  return output;
}

static int integer(const char *source) {
  char *end = NULL;
  errno = 0;
  long value = strtol(source, &end, 10);
  if (errno != 0 || end == source || *end != 0 || value < INT_MIN || value > INT_MAX)
    fail("invalid input position");
  return (int)value;
}

static void required_point(Target target, int x, int y) {
  if (x < target.x || y < target.y || x >= target.x + target.width || y >= target.y + target.height)
    fail("input position left captured window");
}

static void fake_key(Display *display, KeyCode code, bool press) {
  if (code == 0 || !XTestFakeKeyEvent(display, code, press, CurrentTime)) fail("could not post key event");
}

static void key_pair(Display *display, Key key, KeyCode shift) {
  if (key.shift) fake_key(display, shift, true);
  fake_key(display, key.code, true);
  fake_key(display, key.code, false);
  if (key.shift) fake_key(display, shift, false);
}

static Key mapped_key(Display *display, KeySym symbol) {
  KeyCode code = XKeysymToKeycode(display, symbol);
  if (code == 0) fail("text contains a character unsupported by the active X11 keyboard layout");
  if (XkbKeycodeToKeysym(display, code, 0, 0) == symbol) return (Key){code, false};
  if (XkbKeycodeToKeysym(display, code, 0, 1) == symbol) return (Key){code, true};
  fail("text contains a character unsupported by the active X11 keyboard layout");
}

static void require_focus_and_post_mouse(Display *display, const char *expected,
  int x, int y, unsigned int button, int count) {
  XGrabServer(display);
  Target target = required_target(display, expected);
  required_point(target, x, y);
  if (!XTestFakeMotionEvent(display, -1, x, y, CurrentTime)) fail("could not post pointer movement");
  for (int i = 0; i < count; i++) {
    if (!XTestFakeButtonEvent(display, button, True, CurrentTime)
      || !XTestFakeButtonEvent(display, button, False, CurrentTime)) fail("could not post mouse click");
  }
  XSync(display, False);
  XUngrabServer(display);
  XFlush(display);
}

int main(int argc, char **argv) {
  if (argc < 2) fail("missing command");
  Display *display = XOpenDisplay(NULL);
  if (argc == 2 && strcmp(argv[1], "permissions") == 0) {
    int event, error, major, minor;
    bool available = display != NULL;
    bool input = available && XTestQueryExtension(display, &event, &error, &major, &minor);
    printf("{\"screenCapture\":%s,\"inputControl\":%s}\n", available ? "true" : "false", input ? "true" : "false");
    if (display != NULL) XCloseDisplay(display);
    return 0;
  }
  if (display == NULL) fail("X11 display is unavailable");
  int event, error, major, minor;
  if (!XTestQueryExtension(display, &event, &error, &major, &minor)) fail("XTEST input control is unavailable");
  if (argc == 2 && strcmp(argv[1], "focus") == 0) {
    Target target = required_target(display, NULL);
    char token[80];
    target_token(target, token);
    printf("{\"windowId\":\"%s\"}\n", token);
  } else if (argc == 2 && strcmp(argv[1], "capture") == 0) {
    Target target = required_target(display, NULL);
    Bytes image = capture_png(display, target);
    Target after = required_target(display, NULL);
    if (after.id != target.id || after.x != target.x || after.y != target.y
      || after.width != target.width || after.height != target.height)
      fail("frontmost window changed during capture");
    XClassHint class_hint;
    memset(&class_hint, 0, sizeof class_hint);
    if (!XGetClassHint(display, target.id, &class_hint) || class_hint.res_class == NULL
      || class_hint.res_class[0] == 0) fail("foreground application identity is unavailable");
    char *title = NULL;
    XFetchName(display, target.id, &title);
    char token[80];
    target_token(target, token);
    printf("{\"windowId\":\"%s\",\"appName\":", token);
    json_string((const unsigned char *)class_hint.res_class, strlen(class_hint.res_class));
    printf(",\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"png\":\"",
      target.x, target.y, target.width, target.height);
    base64_print(image.data, image.size);
    putchar('"');
    if (title != NULL) { fputs(",\"windowTitle\":", stdout); json_string((const unsigned char *)title, strlen(title)); }
    puts("}");
    free(image.data);
    if (title != NULL) XFree(title);
    if (class_hint.res_name != NULL) XFree(class_hint.res_name);
    XFree(class_hint.res_class);
  } else if (argc == 7 && strcmp(argv[1], "click") == 0) {
    int x = integer(argv[3]), y = integer(argv[4]);
    unsigned int button = strcmp(argv[5], "left") == 0 ? 1 : strcmp(argv[5], "right") == 0 ? 3 : 0;
    int count = integer(argv[6]);
    if (button == 0 || (count != 1 && count != 2)) fail("invalid click");
    require_focus_and_post_mouse(display, argv[2], x, y, button, count);
    puts("{\"ok\":true}");
  } else if (argc == 8 && strcmp(argv[1], "type") == 0) {
    int x = integer(argv[3]), y = integer(argv[4]);
    if ((strcmp(argv[6], "0") != 0 && strcmp(argv[6], "1") != 0)
      || (strcmp(argv[7], "0") != 0 && strcmp(argv[7], "1") != 0)) fail("invalid text input");
    size_t length = 0;
    unsigned char *text = base64_decode(argv[5], &length);
    Key *keys = calloc(length, sizeof *keys);
    if (keys == NULL) fail("out of memory");
    for (size_t i = 0; i < length; i++) {
      if (text[i] < 0x20 || text[i] > 0x7e) fail("text contains a character unsupported by X11 keyboard input");
      keys[i] = mapped_key(display, (KeySym)text[i]);
    }
    KeyCode shift = XKeysymToKeycode(display, XK_Shift_L);
    KeyCode control = XKeysymToKeycode(display, XK_Control_L);
    KeyCode a = XKeysymToKeycode(display, XK_a);
    KeyCode enter = XKeysymToKeycode(display, XK_Return);
    if (shift == 0 || control == 0 || a == 0 || enter == 0) fail("required X11 keyboard keys are unavailable");
    require_focus_and_post_mouse(display, argv[2], x, y, 1, 1);
    for (size_t i = 0; i < length; i++) {
      XGrabServer(display);
      required_target(display, argv[2]);
      if (i == 0 && strcmp(argv[6], "1") == 0) {
        fake_key(display, control, true);
        fake_key(display, a, true);
        fake_key(display, a, false);
        fake_key(display, control, false);
      }
      key_pair(display, keys[i], shift);
      XSync(display, False);
      XUngrabServer(display);
      XFlush(display);
    }
    if (strcmp(argv[7], "1") == 0) {
      XGrabServer(display);
      required_target(display, argv[2]);
      fake_key(display, enter, true);
      fake_key(display, enter, false);
      XSync(display, False);
      XUngrabServer(display);
      XFlush(display);
    }
    free(keys);
    free(text);
    puts("{\"ok\":true}");
  } else fail("unsupported command");
  XCloseDisplay(display);
  return 0;
}
