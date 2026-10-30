using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;

namespace TattyLauncher
{
    // Tatty.exe: what the Desktop and Start menu shortcuts run, so Tatty starts
    // like any program.
    //
    //   Tatty.exe                    start Tatty: runs the plugin's `tatty.sh boot`
    //                                (the server, the tray app, Tatty's own Claude
    //                                session), hidden
    //   Tatty.exe --make-shortcuts   Tatty.lnk on the Desktop and in the Start menu
    //   Tatty.exe --remove-shortcuts
    //
    // It is deliberately thin. Everything that changes with a release lives in the
    // plugin, which is found at run time -- from Claude Code's record of what is
    // installed (the Tatty the marketplace, GitHub, offers), and from boot.json only
    // for a checkout pinned on purpose (`tatty.sh install --pin`) -- so a plugin update
    // never leaves the shortcut pointing at nothing, and this exe never has to be
    // rebuilt for one. The plugin's `boot` looks for a newer Tatty each time it runs.
    //
    // A copy in Claude Code's plugin cache is never trusted over the record: an
    // update leaves the old version's folder there, so a boot.json that named it
    // would be rewritten by every boot from it, and Tatty would stay on that
    // version for good.
    internal static class Program
    {
        // The name the tray app gives itself (Native.NameThisApp in the companion).
        // A shortcut carrying the same one is what makes a taskbar pin and the
        // running window share one button.
        private const string AppId = "TimsAICompanion.Tatty";

        [STAThread]
        private static int Main(string[] args)
        {
            if (Array.IndexOf(args, "--make-shortcuts") >= 0) return MakeShortcuts();
            if (Array.IndexOf(args, "--remove-shortcuts") >= 0) return RemoveShortcuts();
            return Launch();
        }

        // ------------------------------------------------------------ launching

        private static int Launch()
        {
            // Two clicks in a row are one start.
            using var single = new Mutex(true, @"Local\tatty-launcher", out bool first);
            if (!first) return 0;

            var appDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tatty");
            string? bash = null, plugin = null;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(appDir, "boot.json")));
                bash = doc.RootElement.GetProperty("bash").GetString();
                plugin = doc.RootElement.GetProperty("pluginRoot").GetString();
            }
            catch (Exception) { }

            plugin = ChoosePlugin(plugin);
            if (!HasScript(plugin))
                return Fail("Tatty can't find its plugin. Run the Tatty installer again to repair the installation.");
            if (bash == null || !File.Exists(bash)) bash = FindBash();
            if (bash == null)
                return Fail("Tatty needs Git for Windows (it provides Git Bash). Install it, or run the Tatty installer again to have it installed for you.");

            var start = new ProcessStartInfo(bash)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            start.ArgumentList.Add(Path.Combine(plugin!, "scripts", "tatty.sh"));
            start.ArgumentList.Add("boot");
            try
            {
                using var boot = Process.Start(start)!;
                boot.OutputDataReceived += (_, _) => { };
                boot.BeginOutputReadLine();
                string error = boot.StandardError.ReadToEnd();
                boot.WaitForExit();
                // 2 is a part that didn't start; Tatty's window is up regardless.
                if (boot.ExitCode != 0) return Fail(error.Trim().Length > 0 ? error.Trim() : $"Tatty didn't start (exit {boot.ExitCode}).");
            }
            catch (Exception e) { return Fail($"Tatty didn't start: {e.Message}"); }
            return 0;
        }

        // The plugin to run, given the one boot.json names: what Claude Code has
        // installed when that one is gone or is a copy in its plugin cache (an old
        // version's folder stays there after an update), else boot.json's own, which
        // is how a checkout run on purpose stays what it is.
        private static string? ChoosePlugin(string? pinned) =>
            !HasScript(pinned) || InPluginCache(pinned) ? InstalledPlugin() ?? pinned : pinned;

        private static bool HasScript(string? plugin) =>
            !string.IsNullOrEmpty(plugin) && File.Exists(Path.Combine(plugin, "scripts", "tatty.sh"));

        private static string ClaudeConfigDir()
        {
            var config = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
            return string.IsNullOrEmpty(config)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude")
                : config;
        }

        // True for a folder inside Claude Code's plugin cache, where every installed
        // version of a plugin has a folder of its own and the old ones stay.
        private static bool InPluginCache(string? plugin)
        {
            if (string.IsNullOrEmpty(plugin)) return false;
            try
            {
                var cache = Path.GetFullPath(Path.Combine(ClaudeConfigDir(), "plugins", "cache")).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
                return Path.GetFullPath(plugin).StartsWith(cache, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception) { return false; }
        }

        // Claude Code's record of what it has installed: the newest entry for tatty.
        private static string? InstalledPlugin()
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(ClaudeConfigDir(), "plugins", "installed_plugins.json")));
                string? found = null;
                foreach (var plugin in doc.RootElement.GetProperty("plugins").EnumerateObject())
                {
                    if (!plugin.Name.StartsWith("tatty@", StringComparison.Ordinal)) continue;
                    foreach (var install in plugin.Value.EnumerateArray())
                    {
                        var path = install.GetProperty("installPath").GetString();
                        if (HasScript(path)) found = path;
                    }
                }
                return found;
            }
            catch (Exception) { return null; }
        }

        private static string? FindBash()
        {
            var roots = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Git"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Git"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Git"),
            };
            foreach (var root in roots)
                foreach (var sub in new[] { "bin", "usr\\bin" })
                {
                    var candidate = Path.Combine(root, sub, "bash.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            return null;
        }

        // Nothing else is on screen to say what went wrong, so say it.
        private static int Fail(string why)
        {
            MessageBox.Show(why, "Tatty", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }

        // ------------------------------------------------------------ shortcuts

        private static string[] ShortcutPaths() => new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Tatty.lnk"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Tatty.lnk"),
        };

        private static int MakeShortcuts()
        {
            try
            {
                var exe = Environment.ProcessPath!;
                foreach (var path in ShortcutPaths())
                {
                    Shortcut.Create(path, exe, AppId);
                    Console.WriteLine($"made {path}");
                }
                return 0;
            }
            catch (Exception e)
            {
                Console.Error.WriteLine(e.Message);
                return 1;
            }
        }

        private static int RemoveShortcuts()
        {
            foreach (var path in ShortcutPaths())
                try { File.Delete(path); } catch (Exception) { }
            return 0;
        }
    }

    // A .lnk with an AppUserModelID, which WScript.Shell can't set: the shell's
    // IShellLink for the link, and its IPropertyStore for the ID.
    internal static class Shortcut
    {
        public static void Create(string path, string exe, string appId)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var link = (IShellLinkW)new ShellLink();
            link.SetPath(exe);
            link.SetWorkingDirectory(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
            link.SetDescription("Tatty, a companion for Claude Code");
            link.SetIconLocation(exe, 0); // the exe's own icon: assets/tatty.ico, built in

            var store = (IPropertyStore)link;
            var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 }; // System.AppUserModel.ID
            var value = new PropVariant { Type = 31 /* VT_LPWSTR */, Pointer = Marshal.StringToCoTaskMemUni(appId) };
            try
            {
                store.SetValue(ref key, ref value);
                store.Commit();
            }
            finally { Marshal.FreeCoTaskMem(value.Pointer); }

            ((IPersistFile)link).Save(path, true);
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        private struct PropertyKey { public Guid FormatId; public uint PropertyId; }

        [StructLayout(LayoutKind.Explicit)]
        private struct PropVariant
        {
            [FieldOffset(0)] public ushort Type;
            [FieldOffset(8)] public IntPtr Pointer;
            [FieldOffset(16)] private readonly long pad; // a PROPVARIANT is 16 bytes on 32-bit and 24 on 64-bit
        }

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        private class ShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder file, int max, IntPtr data, uint flags);
            void GetIDList(out IntPtr pidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder name, int max);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder dir, int max);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder args, int max);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out ushort hotkey);
            void SetHotkey(ushort hotkey);
            void GetShowCmd(out int show);
            void SetShowCmd(int show);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder path, int max, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
            void Resolve(IntPtr window, uint flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        private interface IPropertyStore
        {
            void GetCount(out uint count);
            void GetAt(uint index, out PropertyKey key);
            void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value);
            void Commit();
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010B-0000-0000-C000-000000000046")]
        private interface IPersistFile
        {
            void GetClassID(out Guid id);
            [PreserveSig] int IsDirty();
            void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
            void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
            void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
            void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
        }
    }
}
