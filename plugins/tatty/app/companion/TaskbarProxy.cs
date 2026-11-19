using System;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace TtCompanion
{
    // The window that owns Tatty's taskbar button, and does nothing else.
    //
    // Tatty is a tray app: the bubble and Tatty himself come and go, and a window
    // that has been hidden cannot be woken from a taskbar button -- the shell
    // cannot activate what isn't visible, and ITaskbarList has no callback. So the
    // button belongs to a window that is always there: one pixel, off every
    // screen, minimised for good, and never changing its styles, so there is
    // nothing about it to flicker.
    //
    // Being minimised is what makes it work. A taskbar button and an Alt-Tab
    // entry are the same style bit, and Alt-Tab is the full panel's alone, so
    // this window asks for WS_EX_APPWINDOW (the button, over the top of the hidden
    // owner WPF gives every ShowInTaskbar="False" window) together with
    // WS_EX_NOACTIVATE, which the switcher takes as "no use to you" and leaves
    // out. A window that can never come forward would get nothing useful from a
    // click either -- but a minimised one is asked to restore instead, and that
    // arrives as a message, which is all this needs.
    //
    // All it does with what the button sends it is pass it on: a click asks for
    // Tatty, and Close from the button's own menu tucks him away.
    public class TaskbarProxy : Window
    {
        public event Action? Chosen;     // the button was clicked: Tatty, please
        public event Action? Dismissed;  // Close, from the button's own menu

        private const int WM_CLOSE = 0x0010, WM_SYSCOMMAND = 0x0112;
        private const int SC_RESTORE = 0xF120, SC_CLOSE = 0xF060;

        public TaskbarProxy(ImageSource icon)
        {
            Title = "Tatty"; // the button's label, and the name a screen reader reads
            Icon = icon;
            Width = 1;
            Height = 1;
            Left = -32000;
            Top = -32000;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false; // the button is ours to ask for, not WPF's to give
            ShowActivated = false; // showing it must never take the keyboard
            WindowState = WindowState.Minimized; // it is a button, never a window
            SourceInitialized += (_, _) =>
            {
                var h = Native.Handle(this);
                Native.SetAltTab(this, true);  // for the button, not for Alt-Tab
                Native.NeverActivate(this);
                Native.Unpreviewable(h); // there is nothing here worth a thumbnail
                HwndSource.FromHwnd(h)?.AddHook(OnWindowMessage);
            };
        }

        // Put the button up without ever letting the window itself be seen.
        public void ShowAsButton()
        {
            if (IsVisible) return;
            Show();
            Native.ShowMinimised(this);
        }

        // Stand down: the full panel is out and has a button of its own, and two
        // buttons for one robot is one too many.
        public void HideButton() => Hide();

        private IntPtr OnWindowMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l, ref bool handled)
        {
            switch (msg)
            {
                case WM_SYSCOMMAND:
                    switch ((int)w & 0xFFF0)
                    {
                        // The button was clicked. There is nothing of this window
                        // to restore, so it stays down and Tatty comes up instead.
                        case SC_RESTORE:
                            handled = true;
                            Chosen?.Invoke();
                            break;
                        // Close, from the button's own menu. Never destroy the
                        // button -- a closed button is no way back.
                        case SC_CLOSE:
                            handled = true;
                            Dismissed?.Invoke();
                            break;
                    }
                    break;
                // Never destroy the button either -- unless the app really is
                // leaving, when refusing would strand the process.
                case WM_CLOSE:
                    if (BubbleWindow.Quitting) break;
                    handled = true;
                    Dismissed?.Invoke();
                    break;
            }
            return IntPtr.Zero;
        }
    }
}
