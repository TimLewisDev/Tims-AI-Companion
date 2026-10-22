using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Forms = System.Windows.Forms;

namespace TtCompanion
{
    // The few Win32 calls WPF doesn't wrap: keeping the windows out of Alt-Tab
    // and from taking focus, Windows 11's rounded corners, and placing windows in
    // physical pixels on the monitor the pointer is on.
    internal static class Native
    {
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int WS_EX_APPWINDOW = 0x00040000;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int DWMWA_FORCE_ICONIC_REPRESENTATION = 7;
        private const int DWMWA_DISALLOW_PEEK = 12;
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWA_BORDER_COLOR = 34;
        private const int DWMWCP_ROUND = 2;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private const uint SWP_NOSIZE = 0x0001, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040;

        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int value);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        private const int WM_NCLBUTTONDOWN = 0x00A1, HTCAPTION = 2;
        private const uint SWP_NOZORDER = 0x0004;

        // Physical pixels per WPF unit for the monitor the window is on.
        public static double Scale(Window w) => GetDpiForWindow(Handle(w)) / 96.0;

        // Move and size a window (physical pixels) without activating it.
        public static void SetBounds(Window w, int x, int y, int width, int height) =>
            SetWindowPos(Handle(w), IntPtr.Zero, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE);

        // Hand the mouse to Windows' own move loop, as a title bar would; returns
        // when the person lets go.
        public static void StartDrag(Window w)
        {
            ReleaseCapture();
            SendMessage(Handle(w), WM_NCLBUTTONDOWN, new IntPtr(HTCAPTION), IntPtr.Zero);
        }

        public static System.Drawing.Point Pointer() => Forms.Cursor.Position;

        [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int processId);

        // Let the next window any process opens take the foreground (ours to give
        // while we have it), so a new session's terminal opens in front.
        public static void AllowAnyForeground() => AllowSetForegroundWindow(-1); // ASFW_ANY

        public static bool OnSomeScreen(System.Drawing.Rectangle r)
        {
            foreach (var s in Forms.Screen.AllScreens)
                if (s.WorkingArea.IntersectsWith(r) && System.Drawing.Rectangle.Intersect(s.WorkingArea, r).Width > 100) return true;
            return false;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; public int Width => Right - Left; public int Height => Bottom - Top; }

        public static IntPtr Handle(Window w) => new WindowInteropHelper(w).EnsureHandle();

        // Off the taskbar and out of Alt-Tab; noActivate also keeps a click from
        // taking the keyboard away from whatever the person is typing in.
        public static void MakeToolWindow(Window w, bool noActivate)
        {
            SetAltTab(w, false);
            if (!noActivate) return;
            var h = Handle(w);
            SetWindowLong(h, GWL_EXSTYLE, GetWindowLong(h, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
        }

        // ------------------------------------------- where a window belongs

        // Alt-Tab membership, both ways round, on the window we already have: the
        // panel changes its mind every time it expands, and recreating it would
        // take the page and its WebView2 down with it.
        //
        // WS_EX_APPWINDOW is what gets us in. WPF parks every ShowInTaskbar="False"
        // window on a hidden owner window of its own, and an owned window is left
        // out of both lists -- but a window with WS_EX_APPWINDOW is treated as if
        // it had no owner, even when it has one. WS_EX_TOOLWINDOW is what keeps us
        // out, and it wins over everything.
        public static void SetAltTab(Window w, bool inAltTab)
        {
            var h = Handle(w);
            int ex = GetWindowLong(h, GWL_EXSTYLE);
            ex = inAltTab ? (ex & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW
                          : (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
            SetWindowLong(h, GWL_EXSTYLE, ex);
        }

        // Never the foreground window: a click on it leaves the keyboard where it
        // was. The taskbar reads this too, and leaves such a window out unless it
        // also asks for WS_EX_APPWINDOW.
        public static void NeverActivate(Window w)
        {
            var h = Handle(w);
            SetWindowLong(h, GWL_EXSTYLE, GetWindowLong(h, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
        }

        // Straight down into the taskbar, without taking the foreground on the
        // way: how a window that is only ever a button is put up.
        public static void ShowMinimised(Window w) => ShowWindow(Handle(w), SW_SHOWMINNOACTIVE);

        // Above all the other windows, or back among them, without moving it or
        // taking the focus: the compact bubble floats, the full panel takes its
        // turn like anything else.
        public static void KeepOnTop(Window w, bool on) =>
            SetWindowPos(Handle(w), on ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,
                         SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

        // Down in the taskbar and back. A minimised window's rectangle is the
        // icon's, not the panel's, so nothing may be saved or placed from it.
        public static bool IsMinimised(Window w) => IsIconic(Handle(w));
        public static void Minimise(Window w) => ShowWindow(Handle(w), SW_MINIMIZE);
        public static void Restore(Window w) => ShowWindow(Handle(w), SW_RESTORE);

        // Tell us when another window takes the foreground, so the ones that are
        // meant to be seen can say so again -- rather than a timer asking the
        // desktop every second for the rest of the day. The delegate is held here
        // because the hook keeps no reference of its own and the collector would
        // take it mid-flight.
        private static WinEventProc? watching;
        private static IntPtr foregroundHook;

        public static void OnForegroundChanged(Action<IntPtr> handler)
        {
            watching = (_, ev, h, idObject, _, _, _) =>
            {
                if (ev == EVENT_SYSTEM_FOREGROUND && idObject == OBJID_WINDOW && h != IntPtr.Zero) handler(h);
            };
            foregroundHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                                             IntPtr.Zero, watching, 0, 0, WINEVENT_OUTOFCONTEXT);
        }

        public static void StopForegroundHook()
        {
            if (foregroundHook != IntPtr.Zero) UnhookWinEvent(foregroundHook);
            foregroundHook = IntPtr.Zero;
            watching = null;
        }

        public static bool IsOurs(IntPtr hwnd)
        {
            GetWindowThreadProcessId(hwnd, out uint pid);
            return pid == GetCurrentProcessId();
        }

        // The desktop itself, or the shell: Show desktop, the Start menu, the
        // taskbar. Tatty has no business climbing over any of them.
        public static bool IsShellOrDesktop(IntPtr hwnd)
        {
            var name = new System.Text.StringBuilder(64);
            GetClassName(hwnd, name, name.Capacity);
            switch (name.ToString())
            {
                case "WorkerW":
                case "Progman":
                case "Shell_TrayWnd":
                case "Shell_SecondaryTrayWnd":
                case "Windows.UI.Core.CoreWindow":
                case "XamlExplorerHostIslandWindow":
                    return true;
                default: return false;
            }
        }

        // A window with a whole monitor to itself: a game, a video, an editor in
        // full screen. Tatty stays out of its way rather than flickering over it.
        public static bool CoversItsMonitor(IntPtr hwnd)
        {
            GetWindowRect(hwnd, out var r);
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref mi)) return false;
            return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top
                && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
        }

        // This process is "Tatty", whichever versioned folder it was built into,
        // so the taskbar groups and names it the same after every plugin update.
        public static void NameThisApp(string id)
        {
            try { SetCurrentProcessExplicitAppUserModelID(id); } catch (Exception) { }
        }

        // ---------------------------------------------------------- imports

        private const int SW_MINIMIZE = 6, SW_SHOWMINNOACTIVE = 7, SW_RESTORE = 9;
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003, WINEVENT_OUTOFCONTEXT = 0;
        private const int OBJID_WINDOW = 0;
        private const int MONITOR_DEFAULTTONEAREST = 2;

        private delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; }

        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint process, uint thread, uint flags);
        [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder name, int max);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hWnd, int flags);
        [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
        [DllImport("shell32.dll")] private static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string id);
        [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);

        // No thumbnail and no peek for a window there is nothing to see of: the
        // taskbar proxy is one pixel off the side of the desktop, and hovering its
        // button should not show that, nor flash the desktop looking for it.
        public static void Unpreviewable(IntPtr h)
        {
            int yes = 1;
            DwmSetWindowAttribute(h, DWMWA_FORCE_ICONIC_REPRESENTATION, ref yes, sizeof(int));
            DwmSetWindowAttribute(h, DWMWA_DISALLOW_PEEK, ref yes, sizeof(int));
        }

        // Rounded corners and an accent border from the window manager itself, so
        // the window needs no transparency (WebView2 can't draw in a transparent one).
        public static void RoundCorners(Window w, int borderRgb)
        {
            var h = Handle(w);
            int round = DWMWCP_ROUND, colour = ((borderRgb & 0xFF) << 16) | (borderRgb & 0xFF00) | ((borderRgb >> 16) & 0xFF);
            DwmSetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));
            DwmSetWindowAttribute(h, DWMWA_BORDER_COLOR, ref colour, sizeof(int));
        }

        public static RECT Rect(Window w)
        {
            GetWindowRect(Handle(w), out var r);
            return r;
        }

        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        private static readonly IntPtr HWND_TOP = IntPtr.Zero;
        private const uint SWP_NOMOVE = 0x0002;

        // Raise a window above the other ordinary windows and give it the focus.
        public static void BringToFront(Window w)
        {
            var h = Handle(w);
            SetWindowPos(h, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
            SetForegroundWindow(h);
        }

        // Move a window (physical pixels) without activating it and without
        // touching its place in the stack: what floats and what doesn't is
        // decided in one place (the bubble's Apply), not wherever it was put.
        public static void MoveTo(Window w, int x, int y) =>
            SetWindowPos(Handle(w), IntPtr.Zero, x, y, 0, 0,
                         SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);

        // The work area (screen minus taskbar) of the monitor the pointer is on.
        public static System.Drawing.Rectangle WorkAreaUnderPointer() =>
            Forms.Screen.FromPoint(Forms.Cursor.Position).WorkingArea;

        public static System.Drawing.Rectangle WorkAreaOf(Window w)
        {
            var r = Rect(w);
            return Forms.Screen.FromPoint(new System.Drawing.Point(r.Left + r.Width / 2, r.Top + r.Height / 2)).WorkingArea;
        }
    }
}
