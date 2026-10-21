using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public sealed class DshRemovalEntry {
  public string RelativePath;
  public string Identity;
  public long Length;
  public bool Directory;
}

// Windows operations use extended Unicode paths and rename the verified file
// handle itself. The portable implementation exists for filesystem regression tests.
public static class DshRemovalNative {
  private static readonly bool Windows = Environment.OSVersion.Platform == PlatformID.Win32NT;
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct FindData {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint SizeHigh, SizeLow, Reserved0, Reserved1;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string Alternate;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct FileInfo {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr FindFirstFileW(string path, out FindData data);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool FindNextFileW(IntPtr handle, out FindData data);
  [DllImport("kernel32.dll")] private static extern bool FindClose(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetLongPathNameW(string path, StringBuilder longPath, uint length);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, IntPtr info, uint length);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateDirectoryW(string path, ref SecurityAttributes attributes);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFileAttributesW(string path);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint length);
  [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SendNotifyMessageW(IntPtr window, uint message, UIntPtr parameter, string value);
  public static void BroadcastEnvironmentChange() {
    if (Windows) SendNotifyMessageW(new IntPtr(0xffff), 0x001a, UIntPtr.Zero, "Environment");
  }
  private static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static string Normalize(string path) {
    if (!Windows) return Path.GetFullPath(path);
    if (String.IsNullOrWhiteSpace(path)) throw new IOException("A local absolute path is required.");
    string value = path.Replace('/', '\\');
    if (value.Length < 3 || !Char.IsLetter(value[0]) || value[1] != ':' || value[2] != '\\' || value.Length > 32760)
      throw new IOException("A fully qualified local drive path is required.");
    string rest = value.Substring(3).TrimEnd('\\');
    if (rest.Length != 0) foreach (string component in rest.Split('\\')) {
      if (component.Length == 0 || component == "." || component == ".." || component.EndsWith(".") || component.EndsWith(" ")) throw new IOException("Ambiguous path components are not supported.");
      foreach (char character in component) if (character < 32 || "<>:\"|?*".IndexOf(character) >= 0) throw new IOException("Invalid path component.");
    }
    return Char.ToUpperInvariant(value[0]) + ":\\" + rest;
  }
  public static string Parent(string path) {
    if (!Windows) return Path.GetDirectoryName(path);
    string value = Normalize(path);
    if (value.Length == 3) return null;
    int last = value.LastIndexOf('\\');
    return last == 2 ? value.Substring(0, 3) : value.Substring(0, last);
  }
  private static string Extended(string path) {
    string full = Normalize(path);
    if (!Windows) return full;
    if (full.StartsWith("\\\\")) throw new IOException("Network and device paths are not supported.");
    return "\\\\?\\" + full;
  }
  // Expands existing 8.3 components without resolving junctions. Comparing this
  // spelling to the opened handle still detects a redirected/reparse ancestor.
  public static string Canonical(string path) {
    string normalized = Normalize(path);
    if (!Windows) return normalized;
    StringBuilder expanded = new StringBuilder(32768);
    uint size = GetLongPathNameW(Extended(normalized), expanded, (uint)expanded.Capacity);
    if (size == 0) { int error = Marshal.GetLastWin32Error(); throw new IOException("Cannot expand existing path: " + path + "; Win32=" + error, new Win32Exception(error)); }
    if (size >= expanded.Capacity) throw new IOException("Expanded path exceeds the supported Unicode length.");
    string value = expanded.ToString();
    if (!value.StartsWith("\\\\?\\", StringComparison.Ordinal)) throw new IOException("Expanded path is not a local extended path.");
    return Normalize(value.Substring(4));
  }
  private static SafeFileHandle Open(string path, bool mutate) {
    SafeFileHandle handle = CreateFileW(Extended(path), (uint)(0x80 | (mutate ? 0x10000 : 0)), 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new IOException("Cannot open removal entry: " + path + "; Win32=" + error, new Win32Exception(error)); }
    try {
      FileInfo info; Check(GetFileInformationByHandle(handle, out info));
      if ((info.Attributes & 0x400) != 0) throw new IOException("Reparse-point entries are not supported.");
      StringBuilder resolved = new StringBuilder(32768);
      uint size = GetFinalPathNameByHandleW(handle, resolved, (uint)resolved.Capacity, 0);
      if (size == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (size >= resolved.Capacity || !String.Equals(resolved.ToString().TrimEnd('\\'), Extended(Canonical(path)).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        throw new IOException("The file path resolves through a different directory: " + path);
      return handle;
    } catch { handle.Dispose(); throw; }
  }
  private static DshRemovalEntry ReadEntry(string path, string relative) {
    if (Windows) {
      using (SafeFileHandle h = Open(path, false)) {
        FileInfo info; Check(GetFileInformationByHandle(h, out info));
        return new DshRemovalEntry { RelativePath = relative, Identity = info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8"), Length = ((long)info.SizeHigh << 32) | info.SizeLow, Directory = (info.Attributes & 16) != 0 };
      }
    }
    FileAttributes attributes = File.GetAttributes(path);
    if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse-point entries are not supported.");
    bool directory = (attributes & FileAttributes.Directory) != 0;
    string identity;
    if (directory) identity = "directory:" + Directory.GetCreationTimeUtc(path).Ticks;
    else using (SHA256 hash = SHA256.Create()) using (FileStream stream = File.OpenRead(path)) identity = BitConverter.ToString(hash.ComputeHash(stream));
    return new DshRemovalEntry { RelativePath = relative, Identity = identity, Length = directory ? 0 : new System.IO.FileInfo(path).Length, Directory = directory };
  }
  public static bool Exists(string path) {
    if (!Windows) return File.Exists(path) || Directory.Exists(path);
    if (GetFileAttributesW(Extended(path)) != UInt32.MaxValue) return true;
    int error = Marshal.GetLastWin32Error(); if (error == 2 || error == 3) return false; throw new Win32Exception(error);
  }
  private static FileStream OpenStream(string path, bool create, bool exclusive) {
    if (!Windows) return new FileStream(path, create ? FileMode.CreateNew : FileMode.Open, FileAccess.ReadWrite, exclusive ? FileShare.None : FileShare.Read);
    SafeFileHandle h = CreateFileW(Extended(path), 0xc0000000, exclusive ? 0u : 1u, IntPtr.Zero, create ? 1u : 3u, 0x00200000, IntPtr.Zero);
    if (h.IsInvalid) { int error = Marshal.GetLastWin32Error(); h.Dispose(); throw new Win32Exception(error); }
    try {
      FileInfo info; Check(GetFileInformationByHandle(h, out info));
      if ((info.Attributes & (0x400 | 16)) != 0) throw new IOException("Removal journal is not an ordinary file.");
      return new FileStream(h, FileAccess.ReadWrite);
    } catch { h.Dispose(); throw; }
  }
  public static FileStream OpenLock(string path) { return OpenStream(path, true, true); }
  public static void WriteJournal(string path, string text, bool create) {
    using (FileStream stream = OpenStream(path, create, false)) {
      if (!create) stream.Seek(0, SeekOrigin.End);
      byte[] bytes = new UTF8Encoding(false).GetBytes(text + "\n"); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
    }
  }
  public static string ReadJournal(string path, int limit) {
    using (FileStream stream = OpenStream(path, false, false)) {
      if (stream.Length > limit) throw new IOException("Removal journal exceeds its size limit.");
      using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true)) return reader.ReadToEnd();
    }
  }
  public static DshRemovalEntry Inspect(string path) { return ReadEntry(path, ""); }
  public static string[] Children(string directory) {
    if (!Windows) return Directory.GetFileSystemEntries(directory);
    List<string> result = new List<string>(); FindData data;
    IntPtr find = FindFirstFileW(Extended(directory) + "\\*", out data);
    if (find == new IntPtr(-1)) { int error = Marshal.GetLastWin32Error(); if (error == 2) return result.ToArray(); throw new Win32Exception(error); }
    try {
      while (true) {
        if (data.Name != "." && data.Name != "..") {
          result.Add(Path.Combine(directory, data.Name));
        }
        if (!FindNextFileW(find, out data)) { int error = Marshal.GetLastWin32Error(); if (error != 18) throw new Win32Exception(error); break; }
      }
    } finally { FindClose(find); }
    return result.ToArray();
  }
  public static DshRemovalEntry[] Inventory(string root) {
    List<DshRemovalEntry> result = new List<DshRemovalEntry>(); Collect(root, "", result); return result.ToArray();
  }
  private static void Collect(string root, string relative, List<DshRemovalEntry> result) {
    string directory = relative.Length == 0 ? root : Path.Combine(root, relative);
    foreach (string child in Children(directory)) {
      string name = relative.Length == 0 ? Path.GetFileName(child) : Path.Combine(relative, Path.GetFileName(child));
      DshRemovalEntry entry = ReadEntry(child, name); result.Add(entry);
      if (entry.Directory) Collect(root, name, result);
    }
  }
  private static void Verify(DshRemovalEntry actual, DshRemovalEntry expected) {
    if (actual.Directory != expected.Directory || actual.Identity != expected.Identity || (!actual.Directory && actual.Length != expected.Length))
      throw new IOException("File identity changed; refusing removal or replacement.");
  }
  public static void Move(string source, string destination, DshRemovalEntry expected) {
    Verify(ReadEntry(source, ""), expected);
    if (!Windows) {
      if (File.Exists(destination) || Directory.Exists(destination)) throw new IOException("Removal destination already exists.");
      if (expected.Directory) Directory.Move(source, destination); else File.Move(source, destination);
      return;
    }
    using (SafeFileHandle h = Open(source, true)) {
      FileInfo info; Check(GetFileInformationByHandle(h, out info));
      DshRemovalEntry current = new DshRemovalEntry { Directory = (info.Attributes & 16) != 0, Identity = info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8"), Length = ((long)info.SizeHigh << 32) | info.SizeLow };
      Verify(current, expected);
      byte[] name = Encoding.Unicode.GetBytes(Extended(destination));
      int rootOffset = IntPtr.Size == 8 ? 8 : 4;
      int lengthOffset = rootOffset + IntPtr.Size;
      int nameOffset = lengthOffset + 4;
      int bufferLength = nameOffset + name.Length + 2;
      IntPtr buffer = Marshal.AllocHGlobal(bufferLength);
      try {
        for (int i = 0; i < nameOffset; i++) Marshal.WriteByte(buffer, i, 0);
        Marshal.WriteIntPtr(buffer, rootOffset, IntPtr.Zero);
        Marshal.WriteInt32(buffer, lengthOffset, name.Length);
        Marshal.Copy(name, 0, IntPtr.Add(buffer, nameOffset), name.Length);
        // FILE_RENAME_INFO.FileName is also documented as NUL-terminated; keep
        // its counted length exclusive of the terminator, and own both bytes.
        Marshal.WriteInt16(buffer, nameOffset + name.Length, 0);
        if (!SetFileInformationByHandle(h, 3, buffer, (uint)bufferLength)) {
          int error = Marshal.GetLastWin32Error();
          throw new IOException("Cannot rename removal entry from '" + source + "' to '" + destination + "'; Win32=" + error, new Win32Exception(error));
        }
      } finally { Marshal.FreeHGlobal(buffer); }
    }
  }
  public static void Delete(string path, DshRemovalEntry expected) {
    Verify(ReadEntry(path, ""), expected);
    if (!Windows) { if (expected.Directory) Directory.Delete(path, false); else File.Delete(path); return; }
    using (SafeFileHandle h = Open(path, true)) {
      FileInfo info; Check(GetFileInformationByHandle(h, out info));
      Verify(new DshRemovalEntry { Directory = (info.Attributes & 16) != 0, Identity = info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8"), Length = ((long)info.SizeHigh << 32) | info.SizeLow }, expected);
      IntPtr buffer = Marshal.AllocHGlobal(1);
      try { Marshal.WriteByte(buffer, 1); Check(SetFileInformationByHandle(h, 4, buffer, 1)); }
      finally { Marshal.FreeHGlobal(buffer); }
    }
  }
  public static void CreatePrivateDirectory(string path) {
    if (!Windows) {
      if (File.Exists(path) || Directory.Exists(path)) throw new IOException("Removal quarantine already exists.");
      Directory.CreateDirectory(path); return;
    }
    string sid = WindowsIdentity.GetCurrent().User.Value;
    IntPtr descriptor; uint length;
    Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;" + sid + ")", 1, out descriptor, out length));
    try {
      SecurityAttributes attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor, Inherit = 0 };
      Check(CreateDirectoryW(Extended(path), ref attributes));
    } finally { LocalFree(descriptor); }
  }
}
