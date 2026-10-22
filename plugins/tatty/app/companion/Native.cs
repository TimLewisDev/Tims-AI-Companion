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
        private const int WS_EX_NOACTIVATE = 0x08000000;
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
            var h = Handle(w);
            int ex = GetWindowLong(h, GWL_EXSTYLE) | WS_EX_TOOLWINDOW;
            if (noActivate) ex |= WS_EX_NOACTIVATE;
            SetWindowLong(h, GWL_EXSTYLE, ex);
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

        // Move a window (physical pixels), on top, without activating it.
        public static void MoveTo(Window w, int x, int y) =>
            SetWindowPos(Handle(w), HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);

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
