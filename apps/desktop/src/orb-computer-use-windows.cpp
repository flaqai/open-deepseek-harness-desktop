// Restricted foreground Computer Use helper. No clipboard, shell, or arbitrary window activation.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <cwchar>
#include <string>
#include <vector>

static void fail(const char* message) {
  fprintf(stderr, "orb computer use: %s\n", message);
  exit(1);
}

static std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
    static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) fail("invalid native text");
  std::string result(size, '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
    static_cast<int>(value.size()), result.data(), size, nullptr, nullptr) != size) fail("invalid native text");
  return result;
}

static std::string json(const std::wstring& value) {
  std::string result = "\"";
  for (unsigned char ch : utf8(value)) {
    if (ch == '"' || ch == '\\') { result += '\\'; result += ch; }
    else if (ch < 0x20) {
      char escaped[7];
      snprintf(escaped, sizeof escaped, "\\u%04x", ch);
      result += escaped;
    } else result += ch;
  }
  return result + '"';
}

static std::string base64(const BYTE* data, size_t size) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string result;
  result.reserve((size + 2) / 3 * 4);
  for (size_t i = 0; i < size; i += 3) {
    const unsigned a = data[i], b = i + 1 < size ? data[i + 1] : 0;
    const unsigned c = i + 2 < size ? data[i + 2] : 0;
    result += alphabet[a >> 2];
    result += alphabet[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < size ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < size ? alphabet[c & 63] : '=';
  }
  return result;
}

static std::vector<BYTE> decode64(const std::wstring& input) {
  std::vector<BYTE> result;
  if (input.empty() || input.size() > 180000 || input.size() % 4) fail("invalid encoded text");
  result.reserve(input.size() / 4 * 3);
  unsigned bits = 0, count = 0;
  bool padded = false;
  for (wchar_t ch : input) {
    if (ch == L'=') { padded = true; continue; }
    if (padded) fail("invalid encoded text");
    unsigned value;
    if (ch >= L'A' && ch <= L'Z') value = ch - L'A';
    else if (ch >= L'a' && ch <= L'z') value = ch - L'a' + 26;
    else if (ch >= L'0' && ch <= L'9') value = ch - L'0' + 52;
    else if (ch == L'+') value = 62;
    else if (ch == L'/') value = 63;
    else fail("invalid encoded text");
    bits = (bits << 6) | value;
    count += 6;
    if (count >= 8) { count -= 8; result.push_back(static_cast<BYTE>((bits >> count) & 255)); }
  }
  if (result.empty() || result.size() > 131072) fail("invalid input text length");
  return result;
}

static std::wstring decodedText(const std::wstring& encoded) {
  const auto bytes = decode64(encoded);
  const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
    reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
  if (length <= 0 || length > 32768) fail("invalid input text length");
  std::wstring result(length, L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
    reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), result.data(), length) != length)
    fail("invalid input text");
  return result;
}

struct Foreground {
  HWND hwnd;
  RECT bounds;
  std::wstring id;
  std::wstring app;
  std::wstring title;
  DWORD pid;
};

static Foreground foreground() {
  HWND hwnd = GetForegroundWindow();
  if (!hwnd || !IsWindowVisible(hwnd) || IsIconic(hwnd)) fail("no eligible foreground window");
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (!pid) fail("no eligible foreground process");
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) fail("cannot inspect foreground process");
  FILETIME created, exited, kernel, user;
  wchar_t path[32768];
  DWORD pathLength = 32768;
  const bool valid = GetProcessTimes(process, &created, &exited, &kernel, &user)
    && QueryFullProcessImageNameW(process, 0, path, &pathLength);
  CloseHandle(process);
  if (!valid) fail("cannot identify foreground process");
  RECT bounds;
  if (!GetWindowRect(hwnd, &bounds)) fail("cannot read foreground bounds");
  const int width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  if (width < 2 || height < 2 || width > 16384 || height > 16384) fail("invalid foreground bounds");
  wchar_t identity[100];
  swprintf_s(identity, L"%llx:%lu:%08lx%08lx", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)),
    static_cast<unsigned long>(pid), created.dwHighDateTime, created.dwLowDateTime);
  std::wstring executable(path, pathLength);
  const size_t slash = executable.find_last_of(L"\\/");
  std::wstring app = executable.substr(slash == std::wstring::npos ? 0 : slash + 1);
  wchar_t title[257] = {};
  GetWindowTextW(hwnd, title, 257);
  return {hwnd, bounds, identity, app, title, pid};
}

static Foreground required(const std::wstring& expected) {
  Foreground current = foreground();
  if (current.id != expected) fail("frontmost window changed; observe again before input");
  return current;
}

static bool availableDesktop() {
  HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS);
  if (!desktop) return false;
  wchar_t name[256] = {};
  DWORD size = 0;
  const bool available = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof name, &size)
    && wcscmp(name, L"Default") == 0;
  CloseDesktop(desktop);
  return available;
}

static DWORD integrity(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) fail("cannot inspect foreground input authority");
  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) { CloseHandle(process); fail("cannot inspect foreground input authority"); }
  DWORD needed = 0;
  GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &needed);
  std::vector<BYTE> buffer(needed);
  if (!needed || !GetTokenInformation(token, TokenIntegrityLevel, buffer.data(), needed, &needed)) {
    CloseHandle(token); CloseHandle(process); fail("cannot inspect foreground input authority");
  }
  auto label = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(buffer.data());
  const DWORD count = *GetSidSubAuthorityCount(label->Label.Sid);
  if (!count) { CloseHandle(token); CloseHandle(process); fail("invalid foreground input authority"); }
  const DWORD level = *GetSidSubAuthority(label->Label.Sid, count - 1);
  CloseHandle(token); CloseHandle(process);
  return level;
}

static void requireInput(const Foreground& target) {
  if (!availableDesktop()) fail("interactive desktop permission is required");
  if (integrity(target.pid) > integrity(GetCurrentProcessId())) fail("foreground window blocks input control");
}

static void send(const INPUT& input) {
  INPUT copy = input;
  if (SendInput(1, &copy, sizeof copy) != 1) fail("native input was blocked");
}

static INPUT mouse(DWORD flags, LONG x, LONG y, DWORD data = 0) {
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dx = x; input.mi.dy = y; input.mi.dwFlags = flags; input.mi.mouseData = data;
  return input;
}

static INPUT key(WORD vk, WORD scan, DWORD flags) {
  INPUT input = {};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = vk; input.ki.wScan = scan; input.ki.dwFlags = flags;
  return input;
}

static void keyPair(const std::wstring& expected, WORD vk, WORD scan = 0, DWORD extra = 0) {
  required(expected);
  send(key(vk, scan, extra));
  send(key(vk, scan, extra | KEYEVENTF_KEYUP));
}

static int coordinate(const wchar_t* text) {
  wchar_t* end = nullptr;
  long value = wcstol(text, &end, 10);
  if (!end || *end || value < -100000 || value > 100000) fail("invalid input coordinate");
  return static_cast<int>(value);
}

static void point(const Foreground& target, int x, int y) {
  if (x < target.bounds.left || x >= target.bounds.right || y < target.bounds.top || y >= target.bounds.bottom)
    fail("input point is outside captured window");
  const int left = GetSystemMetrics(SM_XVIRTUALSCREEN), top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN), height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (width < 2 || height < 2 || x < left || y < top || x >= left + width || y >= top + height)
    fail("input point is outside virtual desktop");
  const LONG nx = static_cast<LONG>((static_cast<int64_t>(x - left) * 65535) / (width - 1));
  const LONG ny = static_cast<LONG>((static_cast<int64_t>(y - top) * 65535) / (height - 1));
  send(mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny));
  required(target.id);
}

static std::string pixels(const Foreground& target) {
  const int width = target.bounds.right - target.bounds.left;
  const int height = target.bounds.bottom - target.bounds.top;
  const uint64_t bytes = static_cast<uint64_t>(width) * height * 4;
  if (bytes > 64ull * 1024 * 1024) fail("captured image exceeds supported size");
  HDC screen = GetDC(nullptr);
  if (!screen) fail("screen capture permission is required");
  HDC memory = CreateCompatibleDC(screen);
  HBITMAP bitmap = memory ? CreateCompatibleBitmap(screen, width, height) : nullptr;
  if (!memory || !bitmap) fail("could not allocate capture bitmap");
  HGDIOBJ previous = SelectObject(memory, bitmap);
  if (!previous || !BitBlt(memory, 0, 0, width, height, screen,
      target.bounds.left, target.bounds.top, SRCCOPY | CAPTUREBLT)) fail("could not capture foreground window");
  BITMAPINFO info = {};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  std::vector<BYTE> buffer(static_cast<size_t>(bytes));
  SelectObject(memory, previous);
  if (GetDIBits(memory, bitmap, 0, height, buffer.data(), &info, DIB_RGB_COLORS) != static_cast<int>(height))
    fail("could not read captured pixels");
  DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(nullptr, screen);
  required(target.id);
  return base64(buffer.data(), buffer.size());
}

int wmain(int argc, wchar_t** argv) {
  // Keep GetWindowRect, BitBlt, and SendInput in the same physical pixel space.
  if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
    fail("per-monitor DPI awareness is required");
  if (argc < 2) fail("missing command");
  const std::wstring command = argv[1];
  if (command == L"permissions" && argc == 2) {
    const bool desktop = availableDesktop();
    HDC screen = desktop ? GetDC(nullptr) : nullptr;
    const bool capture = screen != nullptr;
    if (screen) ReleaseDC(nullptr, screen);
    printf("{\"screenCapture\":%s,\"inputControl\":%s}\n", capture ? "true" : "false", desktop ? "true" : "false");
    return 0;
  }
  if (!availableDesktop()) fail("interactive desktop permission is required");
  if (command == L"focus" && argc == 2) {
    printf("{\"windowId\":%s}\n", json(foreground().id).c_str());
    return 0;
  }
  if (command == L"capture" && argc == 2) {
    const Foreground target = foreground();
    const int width = target.bounds.right - target.bounds.left;
    const int height = target.bounds.bottom - target.bounds.top;
    const std::string data = pixels(target);
    printf("{\"windowId\":%s,\"appName\":%s,\"windowTitle\":%s,\"x\":%ld,\"y\":%ld,\"width\":%d,\"height\":%d,\"bgra\":\"%s\"}\n",
      json(target.id).c_str(), json(target.app).c_str(), json(target.title).c_str(),
      target.bounds.left, target.bounds.top, width, height, data.c_str());
    return 0;
  }
  if (command == L"click" && argc == 7) {
    const Foreground target = required(argv[2]);
    requireInput(target);
    const int x = coordinate(argv[3]), y = coordinate(argv[4]);
    const bool left = wcscmp(argv[5], L"left") == 0;
    if (!left && wcscmp(argv[5], L"right") != 0) fail("invalid mouse button");
    const int count = coordinate(argv[6]);
    if (count != 1 && count != 2) fail("invalid click count");
    point(target, x, y);
    const DWORD down = left ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_RIGHTDOWN;
    const DWORD up = left ? MOUSEEVENTF_LEFTUP : MOUSEEVENTF_RIGHTUP;
    for (int i = 0; i < count; ++i) { required(target.id); send(mouse(down, 0, 0)); send(mouse(up, 0, 0)); }
    puts("{\"ok\":true}");
    return 0;
  }
  if (command == L"type" && argc == 8) {
    const Foreground target = required(argv[2]);
    requireInput(target);
    const int x = coordinate(argv[3]), y = coordinate(argv[4]);
    const std::wstring content = decodedText(argv[5]);
    if (wcscmp(argv[6], L"0") && wcscmp(argv[6], L"1")) fail("invalid replace option");
    if (wcscmp(argv[7], L"0") && wcscmp(argv[7], L"1")) fail("invalid submit option");
    point(target, x, y);
    required(target.id);
    send(mouse(MOUSEEVENTF_LEFTDOWN, 0, 0)); send(mouse(MOUSEEVENTF_LEFTUP, 0, 0));
    if (wcscmp(argv[6], L"1") == 0) {
      required(target.id);
      send(key(VK_CONTROL, 0, 0));
      send(key('A', 0, 0)); send(key('A', 0, KEYEVENTF_KEYUP));
      send(key(VK_CONTROL, 0, KEYEVENTF_KEYUP));
    }
    for (wchar_t unit : content) keyPair(target.id, 0, unit, KEYEVENTF_UNICODE);
    if (wcscmp(argv[7], L"1") == 0) keyPair(target.id, VK_RETURN);
    puts("{\"ok\":true}");
    return 0;
  }
  fail("unsupported native command");
}
